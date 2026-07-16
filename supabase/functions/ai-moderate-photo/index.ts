// Supabase Edge Function: ai-moderate-photo (Deno runtime)
// -----------------------------------------------------------------------------
// AI-M2 #9 — Photo moderation. Takes one base64 image that the caller just
// uploaded for their OWN sighting and asks a Haiku-class vision model for a
// structured safety classification: NSFW / gore-for-shock / graphic animal
// cruelty / clearly-off-topic (not a cat). The result feeds the EXISTING
// moderation system (migration 0012) via the service-role-only
// ai_moderate_content RPC (migration 0020):
//
//   verdict 'violation'  (confident) → auto-HIDE the sighting (never delete)
//                                      + enqueue an AI-attributed abuse_report
//   verdict 'borderline'             → enqueue ONLY — nothing is hidden
//   verdict 'ok'                     → nothing happens at all
//
// THE ONE HARD RULE (ai-safety-agent charter): this function never bans,
// deletes, or suspends anyone. The strongest action it can take is hiding
// content pending human review; the founder makes every real decision from
// app/moderation.tsx and can restore hidden content with one click.
//
// IMPORTANT domain nuance: Guardians is a cat-RESCUE app. Photos of injured,
// sick, dirty, or distressed cats are the app's core, legitimate content and
// must classify as 'ok' — only gratuitous shock content is a violation.
//
// Abuse resistance: the caller must be the sighting's reporter (checked via the
// service role). A stranger cannot post an NSFW image against someone else's
// sighting id to get innocent content auto-hidden.
//
// Auth mirrors ai-report-autofill/ai-adoption-copy exactly: POST-only; 401
// without an Authorization header; an anon-key client scoped to the caller's
// JWT identifies the user AND runs the usage/rate-limit RPCs so auth.uid() is
// the caller. A SEPARATE service-role client does the privileged ownership read
// and calls ai_moderate_content (service_role-only grant).
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-moderate-photo
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude, imageBlock, isAnthropicConfigured } from '../_shared/anthropic.ts';

const FEATURE = 'photo_moderation';
const MAX_PER_HOUR = 30; // a report can attach up to 4 photos; leave headroom

// Rough Haiku pricing (USD per token) for the usage ledger's est_cost. Display
// only — accounting, not billing — so an approximate figure is fine.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

const VERDICTS = ['ok', 'borderline', 'violation'] as const;
const CATEGORIES = ['nsfw', 'gore', 'graphic-cruelty', 'off-topic'] as const;

const MODERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: {
      type: 'string',
      enum: VERDICTS,
      description:
        "'violation' ONLY when you are confident the image clearly violates a category; " +
        "'borderline' when something seems off but you are not sure; 'ok' otherwise.",
    },
    categories: {
      type: 'array',
      items: { type: 'string', enum: CATEGORIES },
      description: 'Which categories apply. Empty when the verdict is ok.',
    },
    reason: {
      type: 'string',
      description:
        'One short, factual sentence a human moderator will read in their queue. ' +
        'Empty string when the verdict is ok.',
    },
  },
  required: ['verdict', 'categories', 'reason'],
} as const;

const SYSTEM = [
  'You are the photo-safety classifier for Guardians, a community cat-RESCUE app where people photograph stray, feral, lost, and often injured cats so volunteers can help them.',
  'Classify the image into exactly one verdict: ok, borderline, or violation.',
  'Categories: "nsfw" (sexual/explicit imagery), "gore" (gratuitous human gore or shock content), "graphic-cruelty" (deliberate animal abuse or torture depicted for shock), "off-topic" (clearly not a cat and clearly unrelated to a cat rescue scene).',
  'CRITICAL: photos of injured, sick, bleeding, thin, dirty, or distressed cats are this app\'s NORMAL, legitimate content — they exist so the cat gets help. They are "ok", never gore or cruelty.',
  'A cat\'s surroundings (streets, bins, gardens, people\'s hands helping a cat, carriers, vet tables) are on-topic. Use "off-topic" only when there is clearly no cat and no plausible rescue context (e.g. a meme, a selfie, a car).',
  'Use "violation" ONLY when you are genuinely confident — a confident violation temporarily hides the content pending human review, so a wrong call hides a real cat that needs help. When unsure, say "borderline"; a human moderator will look at it either way.',
  'You never make final decisions; every non-ok result is reviewed by a human moderator. Keep the reason short, neutral, and factual.',
].join(' ');

interface ModerationResult {
  verdict: (typeof VERDICTS)[number];
  categories: string[];
  reason: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from their session JWT. This same client runs the usage
  // RPCs so auth.uid() attributes the call to the user.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!isAnthropicConfigured()) {
    return json({ error: 'AI is not configured on the server.' }, 503);
  }

  let body: {
    imageBase64?: string;
    mediaType?: string;
    target?: { type?: string; id?: string };
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType : 'image/jpeg';
  const targetType = body.target?.type ?? '';
  const targetId = typeof body.target?.id === 'string' ? body.target.id : '';
  if (!imageBase64) return json({ error: 'imageBase64 required' }, 400);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return json({ error: 'Unsupported media type' }, 400);
  }
  // Both accepted target spellings resolve to the parent sighting: hide/enqueue
  // operates on the sighting row (ai_moderate_content supports sighting|comment).
  if (targetType !== 'sighting_photo' && targetType !== 'sighting') {
    return json({ error: 'target.type must be sighting_photo or sighting' }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
    return json({ error: 'target.id must be a uuid' }, 400);
  }

  // Privileged ownership read + the moderation RPC use the service role, which
  // is never exposed to clients (ai_moderate_content is service_role-only).
  const admin = createClient(url, serviceKey);

  // Only the sighting's own reporter may trigger moderation of its photos —
  // otherwise anyone could feed an NSFW image with a victim's sighting id and
  // get innocent content auto-hidden.
  const { data: sighting, error: sErr } = await admin
    .from('sightings')
    .select('id, reporter_id')
    .eq('id', targetId)
    .single();
  if (sErr || !sighting) return json({ error: 'Sighting not found' }, 404);
  if (sighting.reporter_id !== user.id) return json({ error: 'Forbidden' }, 403);

  // Rate limit BEFORE spending money on the model (per-user, per-feature/hour).
  const { data: allowed, error: rlErr } = await caller.rpc('check_ai_rate_limit', {
    p_feature: FEATURE,
    p_max_per_hour: MAX_PER_HOUR,
  });
  if (rlErr) {
    console.error('[ai-moderate-photo] rate-limit check failed:', rlErr.message);
    return json({ error: 'Could not verify rate limit' }, 500);
  }
  if (!allowed) {
    return json({ error: 'rate_limited', message: 'Too many moderation checks this hour.' }, 429);
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await callClaude<ModerationResult>({
      system: SYSTEM,
      maxTokens: 256,
      jsonSchema: MODERATION_SCHEMA as unknown as Record<string, unknown>,
      messages: [
        {
          role: 'user',
          content: [
            imageBlock(mediaType, imageBase64),
            {
              type: 'text',
              text: 'Classify this photo for the cat-rescue app. Return only the structured object.',
            },
          ],
        },
      ],
    });
  } catch (e) {
    console.error('[ai-moderate-photo] model call failed:', e instanceof Error ? e.message : e);
    return json({ error: 'AI moderation failed.' }, 502);
  }
  const latencyMs = Date.now() - startedAt;

  // Defensive normalisation: never trust the model to have stayed in the enums.
  const raw = result.output;
  const verdict: ModerationResult['verdict'] = (VERDICTS as readonly string[]).includes(
    raw?.verdict,
  )
    ? raw.verdict
    : 'ok';
  const categories = Array.isArray(raw?.categories)
    ? raw.categories.filter((c): c is string => (CATEGORIES as readonly string[]).includes(c))
    : [];
  const reason = typeof raw?.reason === 'string' ? raw.reason.trim() : '';

  // Hide+enqueue (violation) / enqueue-only (borderline) via the SECURITY
  // DEFINER, service_role-only RPC. 'ok' never touches the database. The RPC
  // itself enforces "never delete, never ban" (migration 0020).
  let applied = false;
  if (verdict !== 'ok') {
    // Retry once: the client call is fire-and-forget, so a transient DB blip
    // here would otherwise silently drop a confident violation verdict.
    for (let attempt = 0; attempt < 2 && !applied; attempt++) {
      const { error: modErr } = await admin.rpc('ai_moderate_content', {
        p_type: 'sighting',
        p_id: targetId,
        p_verdict: verdict,
        p_categories: categories,
        p_reason: reason || 'photo flagged by automated moderation',
      });
      if (modErr) {
        console.error('[ai-moderate-photo] ai_moderate_content failed:', modErr.message);
      } else {
        applied = true;
      }
    }
  }

  // Record the call in the usage ledger (best-effort — never fail the response).
  const estCost =
    result.usage.input_tokens * HAIKU_INPUT_USD_PER_TOKEN +
    result.usage.output_tokens * HAIKU_OUTPUT_USD_PER_TOKEN;
  const { error: logErr } = await caller.rpc('log_ai_usage', {
    p_feature: FEATURE,
    p_model: result.model,
    p_input: result.usage.input_tokens,
    p_output: result.usage.output_tokens,
    p_cost: estCost,
    p_latency: latencyMs,
  });
  if (logErr) console.error('[ai-moderate-photo] log_ai_usage failed:', logErr.message);

  // A flagged verdict that could not be written is a dropped moderation action:
  // return 5xx (after logging usage) so it is visible in function metrics
  // instead of a 200 that reads as success.
  return json({ verdict, categories, reason, applied }, verdict !== 'ok' && !applied ? 502 : 200);
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
