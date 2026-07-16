// Supabase Edge Function: ai-embed (Deno runtime)
// -----------------------------------------------------------------------------
// Shared embedding pipe for AI-M3 (cat re-ID), AI-M4 (lost-cat matching), and
// AI-M5#7 (RAG knowledge base). Computes ONE 1024-dim embedding for a single
// image OR a single piece of text and **returns it to the caller**. The caller
// (a feature-specific edge function) verifies ownership of the target and then
// stores the vector via the service-role-only `store_embedding` RPC (migration
// 0021). This function does NOT write to `embeddings` itself — it owns no
// privileged write path, so it has no service-role client. Per the
// ai-infra-agent charter: pipes, not feature logic — no prompts here except
// the fixed captioning prompt needed to make images embeddable.
//
// Embedding strategy:
//   Text  → embed directly with `voyage.embedTexts([text], 'document')` → 1024-dim.
//   Image → FIRST generate a concise, factual visual caption with Claude vision
//           (Haiku, fixed system prompt: dominant coat color, pattern,
//           distinguishing marks like torn ear / collar / notch / missing fur,
//           approximate build, and the scene/context — no speculation about
//           health or temperament), THEN embed that caption text with
//           `voyage.embedTexts([caption], 'document')`. This guarantees a single
//           1024-dim model for both modalities and reuses the existing Claude
//           vision capability rather than introducing a second model.
//
// Why caption-then-embed is acceptable here (per ai-embeddings-agent charter):
// every match this supports is surfaced as a *candidate for human
// confirmation* — never auto-merged, never auto-acted-on — so a false negative
// (a cat the captioner described differently) is at worst a missed suggestion,
// not a wrong action. A future swap to a true multimodal embedding model
// (e.g. voyage-multimodal-3, IF its output dims match 1024) is a one-function
// change inside this file: replace the caption+embed branch with a direct
// multimodal call. Until then, the text-only Voyage path keeps one model and
// one vector space for everything.
//
// Auth mirrors ai-report-autofill/ai-moderate-text exactly: POST-only; 401
// without an Authorization header; an anon-key client scoped to the caller's
// JWT identifies the user AND runs the usage/rate-limit RPCs so auth.uid() is
// the caller (log_ai_usage / check_ai_rate_limit are SECURITY DEFINER, granted
// to `authenticated`). No service-role client — this endpoint performs no
// privileged DB writes.
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-embed
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... VOYAGE_API_KEY=pa-...
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude, imageBlock, isAnthropicConfigured } from '../_shared/anthropic.ts';
import { embedTexts, isVoyageConfigured, VOYAGE_3, VOYAGE_USD_PER_TOKEN } from '../_shared/voyage.ts';

const FEATURE = 'embed';
// Embedding is cheap and is a prerequisite for several features (re-ID,
// matching, RAG), so the cap is generous — but a cap still exists so a single
// abusive caller can't run an unbounded bill.
const MAX_PER_HOUR = 120;

// Rough Haiku pricing (USD per token) for the image-caption leg, added to the
// Voyage cost in the usage ledger. Display only — accounting, not billing.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

const EXPECTED_DIM = 1024;

// FIXED captioning prompt — no feature logic here, just the visual description
// contract that turns a photo into text the embedding model can handle. Kept
// factual and identity-focused: a torn ear or a collar is what makes two
// sightings of the same cat recognizable; health/temperament guesses are
// explicitly out of scope (and would be a soft "diagnosis" violation of
// AI_ROADMAP principle 3).
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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Identify the caller from their session JWT. This same client runs the usage
  // RPCs so auth.uid() attributes the call to the user.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!isVoyageConfigured()) {
    return json({ error: 'Embeddings are not configured on the server.' }, 503);
  }

  let body: { imageBase64?: string; mediaType?: string; text?: string; kind?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType : 'image/jpeg';
  const text = typeof body.text === 'string' ? body.text : '';
  // `kind` tags the embedding's purpose so the caller's store_embedding /
  // match_embeddings calls can scope by it. Loose validation only — the
  // feature-specific caller enforces its own kind vocabulary.
  const kind = typeof body.kind === 'string' ? body.kind.trim() : '';

  const hasImage = imageBase64.length > 0;
  const hasText = text.trim().length > 0;
  if (!hasImage && !hasText) {
    return json({ error: 'Either imageBase64 or text is required' }, 400);
  }
  if (hasImage && hasText) {
    return json({ error: 'Pass exactly one of imageBase64 or text' }, 400);
  }
  if (!kind) {
    return json({ error: 'kind is required (e.g. sighting_photo, kb_chunk)' }, 400);
  }
  if (hasImage && !/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return json({ error: 'Unsupported media type' }, 400);
  }

  // Rate limit BEFORE spending money on the model (per-user, per-feature/hour).
  const { data: allowed, error: rlErr } = await caller.rpc('check_ai_rate_limit', {
    p_feature: FEATURE,
    p_max_per_hour: MAX_PER_HOUR,
  });
  if (rlErr) {
    console.error('[ai-embed] rate-limit check failed:', rlErr.message);
    return json({ error: 'Could not verify rate limit' }, 500);
  }
  if (!allowed) {
    return json(
      {
        error: 'rate_limited',
        message: 'You have generated too many embeddings this hour. Please try again later.',
      },
      429,
    );
  }

  const startedAt = Date.now();

  let embedding: number[];
  let voyageTokens = 0;
  let claudeInputTokens = 0;
  let claudeOutputTokens = 0;
  let claudeModel = '';

  // Record the call in the usage ledger (best-effort — never fail the response).
  // Called on the success path AND on post-spend failure paths: a paid Claude
  // caption whose Voyage leg then fails must still land in the ledger and count
  // toward check_ai_rate_limit's cap (which counts ai_usage rows) — otherwise a
  // retry loop during a Voyage outage burns a Haiku vision call per attempt
  // with the limiter permanently reading "under cap".
  const logUsage = async () => {
    if (voyageTokens === 0 && claudeInputTokens === 0 && claudeOutputTokens === 0) return;
    // Cost = Voyage tokens + (if captioned) Claude input/output tokens. For the
    // ledger's `model` field we record the Voyage model id (the dominant cost);
    // when a Claude caption was used, we annotate it in the model tag so the
    // founder can see "this embed call also spent Haiku tokens" without a
    // separate ledger row.
    const estCost =
      voyageTokens * VOYAGE_USD_PER_TOKEN +
      claudeInputTokens * HAIKU_INPUT_USD_PER_TOKEN +
      claudeOutputTokens * HAIKU_OUTPUT_USD_PER_TOKEN;
    const ledgerModel = claudeModel ? `${VOYAGE_3}+${claudeModel}` : VOYAGE_3;
    const { error: logErr } = await caller.rpc('log_ai_usage', {
      p_feature: FEATURE,
      p_model: ledgerModel,
      // Input tokens = Voyage total + Claude input (the Claude caption is also
      // paid input; summing keeps the ledger's per-call token total honest).
      p_input: voyageTokens + claudeInputTokens,
      p_output: claudeOutputTokens,
      p_cost: estCost,
      p_latency: Date.now() - startedAt,
    });
    if (logErr) console.error('[ai-embed] log_ai_usage failed:', logErr.message);
  };

  if (hasText) {
    // Text → embed directly with Voyage.
    try {
      const { embeddings, usage } = await embedTexts([text], 'document');
      embedding = embeddings[0];
      voyageTokens = usage.total_tokens;
    } catch (e) {
      console.error('[ai-embed] voyage text call failed:', e instanceof Error ? e.message : e);
      return json({ error: 'Embedding failed.' }, 502);
    }
  } else {
    // Image → caption with Claude vision, then embed the caption.
    if (!isAnthropicConfigured()) {
      return json({ error: 'AI vision is not configured on the server.' }, 503);
    }
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
      console.error('[ai-embed] caption call failed:', e instanceof Error ? e.message : e);
      return json({ error: 'Embedding failed.' }, 502);
    }
    if (!caption) {
      await logUsage(); // the caption call was already paid for
      return json({ error: 'Could not generate a caption for this image.' }, 502);
    }
    try {
      const { embeddings, usage } = await embedTexts([caption], 'document');
      embedding = embeddings[0];
      voyageTokens = usage.total_tokens;
    } catch (e) {
      console.error('[ai-embed] voyage image-caption call failed:', e instanceof Error ? e.message : e);
      await logUsage(); // the caption call was already paid for
      return json({ error: 'Embedding failed.' }, 502);
    }
  }

  // Validate the model returned the expected width before handing it back — a
  // wrong-dim vector would explode store_embedding's vector(1024) cast.
  if (!Array.isArray(embedding) || embedding.length !== EXPECTED_DIM) {
    console.error(
      `[ai-embed] expected ${EXPECTED_DIM}-dim, got ${Array.isArray(embedding) ? embedding.length : 'non-array'}`,
    );
    await logUsage(); // both model legs were already paid for
    return json({ error: 'Embedding had unexpected dimensionality.' }, 500);
  }

  await logUsage();

  return json({ embedding });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
