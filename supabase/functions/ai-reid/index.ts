// Supabase Edge Function: ai-reid (Deno runtime)
// -----------------------------------------------------------------------------
// AI-M3 #4 — Duplicate-sighting detection / cat re-identification. Given a
// sighting id, computes (or reuses) a `sighting_photo` embedding for the
// sighting's first photo, then calls `find_sighting_duplicates` — the combined
// PostGIS geo + time + pgvector cosine nearest-neighbour query (migration 0023)
// — to surface "this might be the same cat as [X]" candidates. The reporter/
// guardian confirms or rejects a suggestion; the function NEVER auto-merges.
// Links are created as `suggested` and are reversible (confirm → reject later).
//
// Embedding strategy reuses ai-embed's caption-then-embed pipe: the first
// sighting photo is captioned with a Haiku vision call (factual visual
// description — coat, marks, build, scene), then the caption text is embedded
// with Voyage voyage-3 (1024-dim). The vector is stored via the service-role-
// only `store_embedding` RPC (migration 0021) so it persists for future calls
// and for AI-M4 (lost-cat matching). If a `sighting_photo` embedding already
// exists for this sighting, the model call is SKIPPED (idempotent re-run).
//
// Auth mirrors ai-moderate-photo/ai-moderate-text exactly: POST-only; 401
// without an Authorization header; an anon-key client scoped to the caller's
// JWT identifies the user AND runs the usage/rate-limit RPCs so auth.uid() is
// the caller. A SEPARATE service-role client does the privileged reads (sighting,
// photo, embedding), the privileged writes (store_embedding, sighting_links
// upsert), and calls find_sighting_duplicates via the caller client.
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-reid
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... VOYAGE_API_KEY=pa-...
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude, imageBlock, isAnthropicConfigured } from '../_shared/anthropic.ts';
import {
  embedTexts,
  isVoyageConfigured,
  VOYAGE_3,
  VOYAGE_USD_PER_TOKEN,
} from '../_shared/voyage.ts';
import { downloadCatPhoto } from '../_shared/storage.ts';

const FEATURE = 'reid';
// Re-ID is user-initiated (open a sighting), not per-photo-upload, so 30/hr is
// generous for a solo-founder app while still capping an abusive caller.
const MAX_PER_HOUR = 30;

// Rough Haiku pricing (USD per token) for the vision caption leg. Display only.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

const EXPECTED_DIM = 1024;

// FIXED captioning prompt — identical contract to ai-embed: a factual, identity-
// focused visual description so two sightings of the SAME cat produce similar
// captions (and thus similar embeddings). No health/temperament/breed guesses.
const CAPTION_SYSTEM = [
  'You describe cats for a community cat-rescue app that needs to recognize the SAME cat across different sighting photos.',
  'Write one concise factual paragraph (max ~80 words) describing only what is VISIBLE in the photo:',
  'dominant coat color and pattern (e.g. orange tabby, black & white, dilute calico),',
  'distinguishing marks (torn/notched ear, collar color, scar, missing fur patch, eye color if clear),',
  'approximate build (small/lean/sturdy/large), and',
  'the scene/context (street, bush, carrier, porch, day/night).',
  'Do NOT speculate about health, temperament, age, sex, or breed. Do NOT give advice. Do NOT mention that you are an AI.',
  'If a mark is unclear, omit it rather than guess.',
].join(' ');

interface DuplicateCandidate {
  linked_sighting_id: string;
  title: string | null;
  thumbnail_url: string | null;
  status: string;
  created_at: string;
  distance_m: number;
  confidence: number;
  link_id: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from their session JWT. This same client runs the usage
  // RPCs so auth.uid() attributes the call to the user, and calls
  // find_sighting_duplicates (granted to authenticated).
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body: { sighting_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const sightingId = typeof body.sighting_id === 'string' ? body.sighting_id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sightingId)) {
    return json({ error: 'sighting_id must be a uuid' }, 400);
  }

  // Privileged reads (sighting, photo, embedding) + privileged writes
  // (store_embedding, sighting_links) use the service role, which is never
  // exposed to clients.
  const admin = createClient(url, serviceKey);

  // Load the sighting + verify the caller is its reporter or assigned guardian.
  const { data: sighting, error: sErr } = await admin
    .from('sightings')
    .select('id, reporter_id, claimed_by')
    .eq('id', sightingId)
    .single();
  if (sErr || !sighting) return json({ error: 'Sighting not found' }, 404);
  if (sighting.reporter_id !== user.id && sighting.claimed_by !== user.id) {
    return json({ error: 'Forbidden' }, 403);
  }

  // Load the first photo. No photo → no embedding → no candidates.
  const { data: photo } = await admin
    .from('sighting_photos')
    .select('url')
    .eq('sighting_id', sightingId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const photoUrl = photo?.url;
  if (!photoUrl) {
    return json({ candidates: [] });
  }

  // Reuse an existing sighting_photo embedding if one exists (idempotent re-run
  // — the expensive model call is skipped). get_embedding is service_role-only.
  const { data: existingEmbedding, error: embeddingErr } = await admin.rpc('get_embedding', {
    p_owner_type: 'sighting',
    p_owner_id: sightingId,
    p_kind: 'sighting_photo',
  });
  if (embeddingErr) {
    // A transient DB error must not read as "missing" — that would re-pay the
    // Claude+Voyage legs (and a rate-limit unit) for work already done.
    console.error('[ai-reid] get_embedding failed:', embeddingErr.message);
    return json({ error: 'Could not check for an existing embedding.' }, 500);
  }

  let modelCalled = false;
  let claudeInputTokens = 0;
  let claudeOutputTokens = 0;
  let claudeModel = '';
  let voyageTokens = 0;
  let latencyMs = 0;

  // PostgREST serializes the vector(1024) return as a string like "[0.1,...]"
  // (or null when no row exists). A non-null value means the embedding exists
  // and find_sighting_duplicates reads it from the DB directly, so we only need
  // to know whether to skip the model call — not the vector's shape here.
  if (existingEmbedding !== null && existingEmbedding !== undefined) {
    // Embedding already stored — skip the model call entirely.
  } else {
    // Need to caption + embed. Both providers must be configured.
    if (!isVoyageConfigured()) {
      return json({ error: 'Embeddings are not configured on the server.' }, 503);
    }
    if (!isAnthropicConfigured()) {
      return json({ error: 'AI vision is not configured on the server.' }, 503);
    }

    // Rate limit BEFORE spending money on the model (per-user, per-feature/hour).
    const { data: allowed, error: rlErr } = await caller.rpc('check_ai_rate_limit', {
      p_feature: FEATURE,
      p_max_per_hour: MAX_PER_HOUR,
    });
    if (rlErr) {
      console.error('[ai-reid] rate-limit check failed:', rlErr.message);
      return json({ error: 'Could not verify rate limit' }, 500);
    }
    if (!allowed) {
      return json(
        {
          error: 'rate_limited',
          message: 'Too many re-ID checks this hour. Please try again later.',
        },
        429,
      );
    }

    // Load the photo bytes via the storage API — never fetch() the client-
    // written URL directly (SSRF/size guard, see _shared/storage.ts).
    let imageBytes: ArrayBuffer;
    try {
      imageBytes = await downloadCatPhoto(admin, photoUrl);
    } catch (e) {
      console.error('[ai-reid] photo download failed:', e instanceof Error ? e.message : e);
      return json({ error: 'Could not load the sighting photo.' }, 502);
    }
    const mediaType = inferMediaType(photoUrl);
    const imageBase64 = base64(imageBytes);

    const startedAt = Date.now();

    // Caption the photo with Claude vision (factual visual description).
    let caption: string;
    try {
      const captionResult = await callClaude<string>({
        system: CAPTION_SYSTEM,
        maxTokens: 256,
        messages: [
          {
            role: 'user',
            content: [
              imageBlock(mediaType, imageBase64),
              {
                type: 'text',
                text: 'Describe this cat photo for re-identification. Return only the description paragraph.',
              },
            ],
          },
        ],
      });
      caption = captionResult.output.trim();
      claudeInputTokens = captionResult.usage.input_tokens;
      claudeOutputTokens = captionResult.usage.output_tokens;
      claudeModel = captionResult.model;
    } catch (e) {
      console.error('[ai-reid] caption call failed:', e instanceof Error ? e.message : e);
      return json({ error: 'Re-ID failed.' }, 502);
    }
    if (!caption) {
      return json({ error: 'Could not generate a caption for this photo.' }, 502);
    }

    // Embed the caption text with Voyage (1024-dim).
    let embedding: number[];
    try {
      const { embeddings, usage } = await embedTexts([caption], 'document');
      embedding = embeddings[0];
      voyageTokens = usage.total_tokens;
    } catch (e) {
      console.error('[ai-reid] voyage embed failed:', e instanceof Error ? e.message : e);
      return json({ error: 'Re-ID failed.' }, 502);
    }

    latencyMs = Date.now() - startedAt;

    if (!Array.isArray(embedding) || embedding.length !== EXPECTED_DIM) {
      console.error(
        `[ai-reid] expected ${EXPECTED_DIM}-dim, got ${Array.isArray(embedding) ? embedding.length : 'non-array'}`,
      );
      return json({ error: 'Embedding had unexpected dimensionality.' }, 500);
    }

    // Store the embedding (service_role-only RPC) so it persists for future
    // calls and for AI-M4 (lost-cat matching). pgvector's text format is
    // "[v1,v2,...]" — PostgREST casts that string to vector(1024) cleanly.
    const { error: storeErr } = await admin.rpc('store_embedding', {
      p_owner_type: 'sighting',
      p_owner_id: sightingId,
      p_kind: 'sighting_photo',
      p_embedding: `[${embedding.join(',')}]`,
    });
    if (storeErr) {
      console.error('[ai-reid] store_embedding failed:', storeErr.message);
      return json({ error: 'Could not store the embedding.' }, 500);
    }

    modelCalled = true;
  }

  // Query nearest neighbours via the combined geo+time+vector window. Called via
  // the caller client so auth.uid() is the user (granted to authenticated).
  const { data: duplicates, error: dErr } = await caller.rpc('find_sighting_duplicates', {
    p_sighting: sightingId,
  });
  if (dErr) {
    console.error('[ai-reid] find_sighting_duplicates failed:', dErr.message);
    return json({ error: 'Could not search for duplicates.' }, 502);
  }

  const candidates = (duplicates ?? []) as DuplicateCandidate[];

  // Upsert `suggested` sighting_links for each candidate. Idempotent: if a
  // suggested link already exists (link_id is non-null), refresh its confidence;
  // if not, insert a new one. Service role bypasses the no-client-write RLS.
  // Never touches confirmed/rejected links — find_sighting_duplicates already
  // excluded those pairs.
  const result: DuplicateCandidate[] = [];
  for (const c of candidates) {
    const linkId = await ensureSuggestedLink(admin, sightingId, c);
    result.push({ ...c, link_id: linkId });
  }

  // Record the model call in the usage ledger (best-effort — never fail the
  // response). Only logged when the model was actually called (embedding was
  // freshly computed); a cache-hit re-run costs nothing.
  if (modelCalled) {
    const estCost =
      voyageTokens * VOYAGE_USD_PER_TOKEN +
      claudeInputTokens * HAIKU_INPUT_USD_PER_TOKEN +
      claudeOutputTokens * HAIKU_OUTPUT_USD_PER_TOKEN;
    const ledgerModel = claudeModel ? `${VOYAGE_3}+${claudeModel}` : VOYAGE_3;
    const { error: logErr } = await caller.rpc('log_ai_usage', {
      p_feature: FEATURE,
      p_model: ledgerModel,
      p_input: voyageTokens + claudeInputTokens,
      p_output: claudeOutputTokens,
      p_cost: estCost,
      p_latency: latencyMs,
    });
    if (logErr) console.error('[ai-reid] log_ai_usage failed:', logErr.message);
  }

  return json({ candidates: result });
});

/**
 * Ensure a `suggested` sighting_link exists for the (sightingId, candidate) pair
 * and return its id. If the candidate already carries a link_id (an existing
 * suggested link found by find_sighting_duplicates), refresh its confidence.
 * Otherwise insert a new suggested link. Handles the rare race where a
 * concurrent call created the pair between the find and the insert by falling
 * back to a lookup in both directions (the unique-pair index is unordered).
 */
async function ensureSuggestedLink(
  // supabase-js generics don't survive `ReturnType<typeof createClient>` under
  // deno check; ai-lost-match does the same. The directive must sit on the line
  // immediately above the annotation — a multi-line form does not attach.
  // deno-lint-ignore no-explicit-any
  admin: any,
  sightingId: string,
  candidate: DuplicateCandidate,
): Promise<string | null> {
  // Existing suggested link — refresh confidence + updated_at.
  if (candidate.link_id) {
    await admin
      .from('sighting_links')
      .update({ confidence: candidate.confidence, updated_at: new Date().toISOString() })
      .eq('id', candidate.link_id)
      .eq('status', 'suggested');
    return candidate.link_id;
  }

  // Insert a new suggested link.
  const { data: inserted, error } = await admin
    .from('sighting_links')
    .insert({
      sighting_id: sightingId,
      linked_sighting_id: candidate.linked_sighting_id,
      confidence: candidate.confidence,
      status: 'suggested',
    })
    .select('id')
    .maybeSingle();

  if (inserted) return inserted.id;

  // Race: a concurrent call created the pair. Look it up (either direction).
  if (error) {
    const { data: r1 } = await admin
      .from('sighting_links')
      .select('id')
      .eq('sighting_id', sightingId)
      .eq('linked_sighting_id', candidate.linked_sighting_id)
      .maybeSingle();
    if (r1) return r1.id;

    const { data: r2 } = await admin
      .from('sighting_links')
      .select('id')
      .eq('sighting_id', candidate.linked_sighting_id)
      .eq('linked_sighting_id', sightingId)
      .maybeSingle();
    if (r2) return r2.id;
  }
  return null;
}

/** Infer the photo media type from the URL extension (defaults to jpeg). */
function inferMediaType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/** Encode an ArrayBuffer to a base64 string without external deps. */
function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
