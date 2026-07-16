// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: ai-lost-match (Deno runtime)
// -----------------------------------------------------------------------------
// AI-M4 #5 — Lost-cat reunification matching engine. Given EITHER a lost-cat
// post id (mode 'lost_cat') OR a sighting id (mode 'sighting'), ensures the
// target's `*_photo` embedding exists, then runs the combined PostGIS geo +
// time + pgvector cosine nearest-neighbour query (migration 0025):
//
//   mode 'lost_cat'  → find_lost_cat_matches(lost_cat_id): open sightings that
//                      look like the lost cat, near where it went missing.
//   mode 'sighting'  → find_lost_cats_for_sighting(sighting_id): open lost-cat
//                      posts that look like this sighting, near where it was
//                      spotted.
//
// For every NEW (not already suggested) candidate pair, the function inserts a
// `lost_cat_matches` row (status='suggested') via the service role and pushes
// the lost-cat owner's devices via Expo ("🐾 Possible match for <title> …
// spotted ~<distance>m away"). The owner confirms or rejects from the app;
// this function NEVER auto-confirms and NEVER auto-closes a lost-cat post.
// Match rows are never deleted — confirm/reject only flips status (reversible).
//
// Embedding strategy reuses ai-embed/ai-reid's caption-then-embed pipe: the
// target photo is captioned with a Haiku vision call (factual visual
// description — coat, marks, build, scene), then the caption text is embedded
// with Voyage voyage-3 (1024-dim) and stored via the service-role-only
// `store_embedding` RPC (migration 0021). If a `*_photo` embedding already
// exists, the model call is SKIPPED (idempotent re-run).
//
// Auth mirrors ai-moderate-text/ai-reid exactly: POST-only; 401 without an
// Authorization header; an anon-key client scoped to the caller's JWT
// identifies the user AND runs the usage/rate-limit RPCs so auth.uid() is the
// caller. A SEPARATE service-role client does the privileged reads (lost_cat /
// sighting / photo / embedding / push tokens), privileged writes
// (store_embedding, lost_cat_matches), and the find_* RPCs are called via the
// caller client (granted to authenticated; body requires the caller to be the
// owner / reporter / guardian — defense in depth).
//
// Pushes are BEST-EFFORT: a push failure is logged and never fails the match
// insertion (the owner can still see the suggestion in the app). Dead Expo
// tokens (DeviceNotRegistered) are reaped inline so the token table doesn't
// accumulate cruft — mirrors send-push's pattern but inlined here (send-push is
// not modified).
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-lost-match
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... VOYAGE_API_KEY=pa-...
//   (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / SUPABASE_URL as for send-push)
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude, imageBlock, isAnthropicConfigured } from '../_shared/anthropic.ts';
import { embedTexts, isVoyageConfigured, VOYAGE_3, VOYAGE_USD_PER_TOKEN } from '../_shared/voyage.ts';
import { downloadCatPhoto } from '../_shared/storage.ts';

const FEATURE = 'lost_cat_match';
// Lost-cat matching is user-initiated (post a lost cat, or open a sighting the
// system hasn't matched yet), not per-photo-upload, so 30/hr is generous for a
// solo-founder app while still capping an abusive caller.
const MAX_PER_HOUR = 30;

// Rough Haiku pricing (USD per token) for the vision caption leg. Display only.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

const EXPECTED_DIM = 1024;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// FIXED captioning prompt — identical contract to ai-embed/ai-reid: a factual,
// identity-focused visual description so a lost-cat photo and a sighting photo
// of the SAME cat produce similar captions (and thus similar embeddings). No
// health/temperament/breed guesses (AI_ROADMAP principle 3).
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

// Candidate row from find_lost_cat_matches (mode 'lost_cat').
interface LostCatMatchCandidate {
  sighting_id: string;
  title: string | null;
  thumbnail_url: string | null;
  status: string;
  created_at: string;
  distance_m: number;
  confidence: number;
  // Non-null when a suggested lost_cat_matches row already exists for this pair
  // (refresh its confidence; do NOT re-push). Null when the pair is brand new.
  match_id: string | null;
}

// Candidate row from find_lost_cats_for_sighting (mode 'sighting').
interface LostCatForSighting {
  lost_cat_id: string;
  owner_id: string;
  title: string | null;
  confidence: number;
  distance_m: number;
  match_id: string | null;
}

interface EmbedResult {
  embedding: number[];
  voyageTokens: number;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeModel: string;
  latencyMs: number;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from their session JWT. This same client runs the usage
  // RPCs so auth.uid() attributes the call to the user, and calls the find_*
  // RPCs (granted to authenticated; body re-checks ownership).
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body: { mode?: string; lost_cat_id?: string; sighting_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const mode = body.mode === 'lost_cat' || body.mode === 'sighting' ? body.mode : '';
  if (!mode) return json({ error: 'mode must be lost_cat or sighting' }, 400);

  const lostCatId = typeof body.lost_cat_id === 'string' ? body.lost_cat_id : '';
  const sightingId = typeof body.sighting_id === 'string' ? body.sighting_id : '';
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (mode === 'lost_cat') {
    if (!uuidRe.test(lostCatId)) return json({ error: 'lost_cat_id must be a uuid' }, 400);
  } else {
    if (!uuidRe.test(sightingId)) return json({ error: 'sighting_id must be a uuid' }, 400);
  }

  // Privileged reads (lost_cat / sighting / photo / embedding / push tokens) +
  // privileged writes (store_embedding, lost_cat_matches) use the service role,
  // which is never exposed to clients.
  const admin = createClient(url, serviceKey);

  let embedResult: EmbedResult | null = null;
  let modelCalled = false;

  try {
    if (mode === 'lost_cat') {
      // Load the lost-cat post + verify the caller is its owner. owner_id is a
      // client-readable column, but we read via admin to also fetch photo_url
      // (and lat/lng if ever needed) in one round trip.
      const { data: lc, error: lcErr } = await admin
        .from('lost_cats')
        .select('id, owner_id, title, photo_url')
        .eq('id', lostCatId)
        .maybeSingle();
      if (lcErr || !lc) return json({ error: 'Lost cat not found' }, 404);
      if (lc.owner_id !== user.id) return json({ error: 'Forbidden' }, 403);

      // Ensure a lost_cat_photo embedding exists (compute + store if missing).
      const needEmbed = await needsEmbedding(admin, 'lost_cat', lostCatId, 'lost_cat_photo');
      if (needEmbed) {
        if (!isVoyageConfigured() || !isAnthropicConfigured()) {
          return json({ error: 'Embeddings are not configured on the server.' }, 503);
        }
        const allowed = await checkRateLimit(caller);
        if (!allowed) {
          return json(
            { error: 'rate_limited', message: 'Too many lost-cat match checks this hour.' },
            429,
          );
        }
        try {
          embedResult = await computeEmbeddingForPhoto(admin, lc.photo_url);
        } catch (e) {
          console.error('[ai-lost-match] lost_cat embed failed:', e instanceof Error ? e.message : e);
          return json({ error: 'Could not compute the lost-cat photo embedding.' }, 502);
        }
        await storeEmbedding(admin, 'lost_cat', lostCatId, 'lost_cat_photo', embedResult.embedding);
        modelCalled = true;
      }

      // Query nearest sightings via the combined geo+time+vector window. Called
      // via the caller client so auth.uid() is the owner (body re-checks).
      const { data: matches, error: mErr } = await caller.rpc('find_lost_cat_matches', {
        p_lost_cat: lostCatId,
      });
      if (mErr) {
        console.error('[ai-lost-match] find_lost_cat_matches failed:', mErr.message);
        return json({ error: 'Could not search for lost-cat matches.' }, 502);
      }
      const candidates = (matches ?? []) as LostCatMatchCandidate[];

      // Insert+push only for NEW pairs (match_id null). Existing suggested pairs
      // get a confidence refresh but no re-push. Service role bypasses the
      // no-client-write RLS on lost_cat_matches.
      let pushed = 0;
      for (const c of candidates) {
        const newId = await ensureSuggestedMatch(
          admin,
          lostCatId,
          c.sighting_id,
          c.confidence,
          c.match_id,
        );
        if (newId) {
          // Best-effort push to the owner (the caller). Never fail the match on
          // a push error — the owner still sees the suggestion in the app.
          const ok = await pushToOwner(admin, user.id, {
            lostCatId,
            sightingId: c.sighting_id,
            title: lc.title,
            distanceM: c.distance_m,
          });
          if (ok) pushed += 1;
        }
      }

      if (modelCalled && embedResult) await logUsage(caller, embedResult);
      return json({ matches: candidates.length, pushed });
    }

    // mode === 'sighting'
    // Load the sighting + verify the caller is its reporter or assigned guardian.
    const { data: s, error: sErr } = await admin
      .from('sightings')
      .select('id, reporter_id, claimed_by')
      .eq('id', sightingId)
      .maybeSingle();
    if (sErr || !s) return json({ error: 'Sighting not found' }, 404);
    if (s.reporter_id !== user.id && s.claimed_by !== user.id) {
      return json({ error: 'Forbidden' }, 403);
    }

    // Ensure a sighting_photo embedding exists. ai-reid normally computes this
    // on a sighting, but if it hasn't run yet we compute it here so a freshly
    // reported sighting can still match open lost-cat posts.
    const needEmbed = await needsEmbedding(admin, 'sighting', sightingId, 'sighting_photo');
    if (needEmbed) {
      const photoUrl = await firstSightingPhotoUrl(admin, sightingId);
      if (photoUrl) {
        if (!isVoyageConfigured() || !isAnthropicConfigured()) {
          return json({ error: 'Embeddings are not configured on the server.' }, 503);
        }
        const allowed = await checkRateLimit(caller);
        if (!allowed) {
          return json(
            { error: 'rate_limited', message: 'Too many lost-cat match checks this hour.' },
            429,
          );
        }
        try {
          embedResult = await computeEmbeddingForPhoto(admin, photoUrl);
        } catch (e) {
          console.error('[ai-lost-match] sighting embed failed:', e instanceof Error ? e.message : e);
          return json({ error: 'Could not compute the sighting photo embedding.' }, 502);
        }
        await storeEmbedding(admin, 'sighting', sightingId, 'sighting_photo', embedResult.embedding);
        modelCalled = true;
      }
      // No photo → no embedding → find_lost_cats_for_sighting returns nothing,
      // so we still proceed (returns matches:0, pushed:0).
    }

    // Query open lost-cat posts that match this sighting. Called via the caller
    // client so auth.uid() is the reporter/guardian (body re-checks).
    const { data: lostCats, error: lErr } = await caller.rpc('find_lost_cats_for_sighting', {
      p_sighting: sightingId,
    });
    if (lErr) {
      console.error('[ai-lost-match] find_lost_cats_for_sighting failed:', lErr.message);
      return json({ error: 'Could not search for lost-cat matches.' }, 502);
    }
    const candidates = (lostCats ?? []) as LostCatForSighting[];

    // Insert+push only for NEW pairs (match_id null). Push each lost-cat's
    // owner (owner_id comes from the RPC so we know whose device to ping).
    let pushed = 0;
    for (const c of candidates) {
      const newId = await ensureSuggestedMatch(
        admin,
        c.lost_cat_id,
        sightingId,
        c.confidence,
        c.match_id,
      );
      if (newId) {
        const ok = await pushToOwner(admin, c.owner_id, {
          lostCatId: c.lost_cat_id,
          sightingId,
          title: c.title,
          distanceM: c.distance_m,
        });
        if (ok) pushed += 1;
      }
    }

    if (modelCalled && embedResult) await logUsage(caller, embedResult);
    return json({ matches: candidates.length, pushed });
  } catch (e) {
    console.error('[ai-lost-match] unhandled:', e instanceof Error ? e.message : e);
    return json({ error: 'Lost-cat match failed.' }, 500);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
// The supabase-js clients below are created without a Database generic (the
// edge runtime has no generated schema types), so their query-builder types
// resolve loosely. Helper params are typed as `any` for the client to keep
// `deno check` clean — the app's tsc excludes this dir and eslint ignores
// supabase/functions (Deno lints it separately, and its recommended rules do
// not flag `any`). This mirrors how ai-reid/ai-moderate-text handle the same
// untyped-client reality.

/**
 * True when no embedding row exists for (ownerType, ownerId, kind) yet.
 * Throws on RPC failure — a transient DB error must NOT read as "missing",
 * or the caller re-pays the Claude+Voyage legs (or wrongly 503s when the AI
 * keys are unset) for an embedding that already exists.
 */
async function needsEmbedding(
  admin: any,
  ownerType: string,
  ownerId: string,
  kind: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc('get_embedding', {
    p_owner_type: ownerType,
    p_owner_id: ownerId,
    p_kind: kind,
  });
  if (error) throw new Error(`get_embedding failed: ${error.message}`);
  // PostgREST serializes vector(1024) as a string like "[...]" or null.
  return data === null || data === undefined;
}

/** Caption + embed one photo URL. Throws on any model/download failure. */
async function computeEmbeddingForPhoto(admin: any, photoUrl: string): Promise<EmbedResult> {
  // Load bytes via the storage API — never fetch() the client-written URL
  // directly (SSRF/size guard, see _shared/storage.ts).
  let imageBytes: ArrayBuffer;
  try {
    imageBytes = await downloadCatPhoto(admin, photoUrl);
  } catch (e) {
    throw new Error(`Could not load photo: ${e instanceof Error ? e.message : e}`);
  }
  const mediaType = inferMediaType(photoUrl);
  const imageBase64 = base64(imageBytes);

  const startedAt = Date.now();
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
  const caption = captionResult.output.trim();
  if (!caption) throw new Error('Empty caption.');

  const { embeddings, usage } = await embedTexts([caption], 'document');
  const embedding = embeddings[0];
  if (!Array.isArray(embedding) || embedding.length !== EXPECTED_DIM) {
    throw new Error(
      `Expected ${EXPECTED_DIM}-dim, got ${Array.isArray(embedding) ? embedding.length : 'non-array'}`,
    );
  }
  return {
    embedding,
    voyageTokens: usage.total_tokens,
    claudeInputTokens: captionResult.usage.input_tokens,
    claudeOutputTokens: captionResult.usage.output_tokens,
    claudeModel: captionResult.model,
    latencyMs: Date.now() - startedAt,
  };
}

/** Store a 1024-dim vector via the service-role-only store_embedding RPC. */
async function storeEmbedding(
  admin: any,
  ownerType: string,
  ownerId: string,
  kind: string,
  embedding: number[],
): Promise<void> {
  const { error } = await admin.rpc('store_embedding', {
    p_owner_type: ownerType,
    p_owner_id: ownerId,
    p_kind: kind,
    p_embedding: `[${embedding.join(',')}]`,
  });
  if (error) {
    console.error('[ai-lost-match] store_embedding failed:', error.message);
    throw new Error('Could not store the embedding.');
  }
}

/** First sighting photo URL (oldest first), or null when the sighting has none. */
async function firstSightingPhotoUrl(
  admin: any,
  sightingId: string,
): Promise<string | null> {
  const { data: photo } = await admin
    .from('sighting_photos')
    .select('url')
    .eq('sighting_id', sightingId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return typeof photo?.url === 'string' ? photo.url : null;
}

/** Rate-limit check (per-user, per-feature/hour). True when under the cap. */
async function checkRateLimit(
  caller: any,
): Promise<boolean> {
  const { data: allowed, error } = await caller.rpc('check_ai_rate_limit', {
    p_feature: FEATURE,
    p_max_per_hour: MAX_PER_HOUR,
  });
  if (error) {
    console.error('[ai-lost-match] rate-limit check failed:', error.message);
    return false;
  }
  return Boolean(allowed);
}

/**
 * Ensure a `suggested` lost_cat_matches row exists for the (lostCatId,
 * sightingId) pair and return its id when it is NEW (caller should push). If
 * `existingMatchId` is non-null the pair already has a suggested row — refresh
 * its confidence and return null (no push). On a rare insert race (concurrent
 * call created the pair between the find and the insert), look up the existing
 * row and return null. The unique (lost_cat_id, sighting_id) index enforces
 * idempotency at the DB layer; this helper makes the upsert graceful.
 */
async function ensureSuggestedMatch(
  admin: any,
  lostCatId: string,
  sightingId: string,
  confidence: number,
  existingMatchId: string | null,
): Promise<string | null> {
  // Existing suggested match — refresh confidence + updated_at. No push.
  if (existingMatchId) {
    await admin
      .from('lost_cat_matches')
      .update({ confidence, updated_at: new Date().toISOString() })
      .eq('id', existingMatchId)
      .eq('status', 'suggested');
    return null;
  }

  // Insert a new suggested match. Service role bypasses the no-client-write RLS.
  const { data: inserted, error } = await admin
    .from('lost_cat_matches')
    .insert({
      lost_cat_id: lostCatId,
      sighting_id: sightingId,
      confidence,
      status: 'suggested',
    })
    .select('id')
    .maybeSingle();

  if (inserted) return inserted.id;

  // Race: a concurrent call created the pair between find and insert. Look it
  // up so we don't double-push — it is no longer new from this call's view.
  if (error) {
    const { data: row } = await admin
      .from('lost_cat_matches')
      .select('id')
      .eq('lost_cat_id', lostCatId)
      .eq('sighting_id', sightingId)
      .maybeSingle();
    if (row) return null;
  }
  console.error('[ai-lost-match] insert match failed:', error?.message);
  return null;
}

/**
 * Best-effort Expo push to one user's devices. Reads device_push_tokens via the
 * service role (never exposed to clients), POSTs to Expo, inspects per-message
 * tickets, and reaps DeviceNotRegistered tokens so the table stays clean. A
 * push failure is logged and returns false — it must never fail a match
 * insertion. Returns true when at least one ticket was 'ok'. Mirrors
 * send-push's pattern but inlined (send-push is not modified).
 */
async function pushToOwner(
  admin: any,
  ownerId: string,
  payload: { lostCatId: string; sightingId: string; title: string | null; distanceM: number },
): Promise<boolean> {
  const { data: tokenRows, error: tErr } = await admin
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', ownerId);
  if (tErr) {
    console.error('[ai-lost-match] load push tokens failed:', tErr.message);
    return false;
  }
  const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token);
  if (tokens.length === 0) return false;

  const titleStr = (payload.title ?? '').trim() || 'your lost cat';
  const distanceM = Math.max(1, Math.round(payload.distanceM));
  const messages = tokens.map((to: string) => ({
    to,
    title: `🐾 Possible match for ${titleStr}`,
    body: `A cat matching your lost cat was spotted ~${distanceM}m away. Tap to review.`,
    sound: 'default',
    priority: 'high',
    channelId: 'urgent',
    data: {
      lost_cat_id: payload.lostCatId,
      sighting_id: payload.sightingId,
      type: 'lost_cat_match',
    },
  }));

  let resp: Response;
  try {
    resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    console.error('[ai-lost-match] Expo request threw:', e instanceof Error ? e.message : e);
    return false;
  }

  if (!resp.ok) {
    console.error('[ai-lost-match] Expo responded', resp.status, await resp.text().catch(() => ''));
    return false;
  }

  const payloadJson = (await resp.json().catch(() => null)) as {
    data?: { status: string; message?: string; details?: { error?: string } }[];
  } | null;
  const tickets = payloadJson?.data ?? [];
  if (tickets.length === 0) return true; // no ticket detail (older response shape)

  let sent = 0;
  const deadTokens: string[] = [];
  tickets.forEach((ticket, j) => {
    if (ticket.status === 'ok') {
      sent += 1;
      return;
    }
    console.error('[ai-lost-match] ticket error:', ticket.message ?? ticket.details?.error);
    if (ticket.details?.error === 'DeviceNotRegistered' && tokens[j]) deadTokens.push(tokens[j]);
  });

  // Reap dead tokens so device_push_tokens doesn't accumulate cruft.
  if (deadTokens.length > 0) {
    const { error: delErr } = await admin
      .from('device_push_tokens')
      .delete()
      .in('token', deadTokens);
    if (delErr) console.error('[ai-lost-match] failed to reap dead tokens:', delErr.message);
  }

  return sent > 0;
}

/** Record the model call in the usage ledger (best-effort — never fail). */
async function logUsage(
  caller: any,
  r: EmbedResult,
): Promise<void> {
  const estCost =
    r.voyageTokens * VOYAGE_USD_PER_TOKEN +
    r.claudeInputTokens * HAIKU_INPUT_USD_PER_TOKEN +
    r.claudeOutputTokens * HAIKU_OUTPUT_USD_PER_TOKEN;
  const ledgerModel = r.claudeModel ? `${VOYAGE_3}+${r.claudeModel}` : VOYAGE_3;
  const { error } = await caller.rpc('log_ai_usage', {
    p_feature: FEATURE,
    p_model: ledgerModel,
    p_input: r.voyageTokens + r.claudeInputTokens,
    p_output: r.claudeOutputTokens,
    p_cost: estCost,
    p_latency: r.latencyMs,
  });
  if (error) console.error('[ai-lost-match] log_ai_usage failed:', error.message);
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
