// Supabase Edge Function: ai-moderate-text (Deno runtime)
// -----------------------------------------------------------------------------
// AI-M2 #10 — Text screening. Classifies a just-posted piece of user text (a
// comment, or a sighting's title/description) for toxicity / harassment / hate,
// and feeds the EXISTING moderation system (migration 0012) via the
// service-role-only ai_moderate_content RPC (migration 0020):
//
//   verdict 'violation'  (confident) → auto-HIDE the target (never delete)
//                                      + enqueue an AI-attributed abuse_report
//   verdict 'borderline'             → enqueue ONLY — nothing is hidden
//   verdict 'ok'                     → nothing happens at all
//
// THE ONE HARD RULE (ai-safety-agent charter): this function never bans,
// deletes, or suspends anyone. The strongest action it can take is hiding
// content pending human review; the founder makes every real decision from
// app/moderation.tsx and can restore hidden content with one click.
//
// Abuse resistance: the classified text is ALWAYS re-read from the database by
// id (service role) — the client-supplied `text` is accepted for API-shape
// compatibility but never trusted, so a malicious caller cannot fabricate
// "toxic" text against someone else's innocent comment to get it auto-hidden.
// The caller must also be the content's own author.
//
// Auth mirrors ai-report-autofill/ai-adoption-copy exactly: POST-only; 401
// without an Authorization header; an anon-key client scoped to the caller's
// JWT identifies the user AND runs the usage/rate-limit RPCs so auth.uid() is
// the caller. A SEPARATE service-role client does the privileged reads and
// calls ai_moderate_content (service_role-only grant).
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-moderate-text
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude, isAnthropicConfigured } from '../_shared/anthropic.ts';

const FEATURE = 'text_moderation';
const MAX_PER_HOUR = 60; // comments are chatty; screening must never feel rationed

// Rough Haiku pricing (USD per token) for the usage ledger's est_cost. Display
// only — accounting, not billing — so an approximate figure is fine.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

const MAX_TEXT_CHARS = 4_000;

const VERDICTS = ['ok', 'borderline', 'violation'] as const;
const CATEGORIES = ['toxicity', 'harassment', 'hate', 'sexual', 'spam'] as const;

const MODERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: {
      type: 'string',
      enum: VERDICTS,
      description:
        "'violation' ONLY when you are confident the text clearly violates a category; " +
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
  'You are the text-safety classifier for Guardians, a community cat-rescue app where neighbours coordinate helping stray and lost cats.',
  'Classify the text into exactly one verdict: ok, borderline, or violation.',
  'Categories: "toxicity" (insults, aggression, threats), "harassment" (targeting or bullying a person), "hate" (attacks on a protected group), "sexual" (explicit sexual content), "spam" (scams, ads, link-farming).',
  'Context matters: rescue talk is often emotional and blunt. Frustration about a cat\'s situation, urgent all-caps pleas, sad or graphic descriptions of an injured cat, and criticism of neglect are NORMAL here — they are "ok".',
  'Use "violation" ONLY when you are genuinely confident — a confident violation temporarily hides the content pending human review, so a wrong call silences a neighbour trying to help a cat. When unsure, say "borderline"; a human moderator will look at it either way.',
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

  let body: { type?: string; id?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const type = body.type === 'sighting' || body.type === 'comment' ? body.type : '';
  const id = typeof body.id === 'string' ? body.id : '';
  if (!type) return json({ error: 'type must be sighting or comment' }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return json({ error: 'id must be a uuid' }, 400);
  }

  // Privileged canonical-text read + the moderation RPC use the service role,
  // which is never exposed to clients (ai_moderate_content is service_role-only).
  const admin = createClient(url, serviceKey);

  // ALWAYS classify the text as stored in the database — never the client's
  // copy — and only for the content's own author (see header comment).
  let text = '';
  if (type === 'comment') {
    const { data: row, error } = await admin
      .from('sighting_updates')
      .select('id, author_id, body')
      .eq('id', id)
      .single();
    if (error || !row) return json({ error: 'Comment not found' }, 404);
    if (row.author_id !== user.id) return json({ error: 'Forbidden' }, 403);
    text = (row.body ?? '').trim();
  } else {
    const { data: row, error } = await admin
      .from('sightings')
      .select('id, reporter_id, title, description')
      .eq('id', id)
      .single();
    if (error || !row) return json({ error: 'Sighting not found' }, 404);
    if (row.reporter_id !== user.id) return json({ error: 'Forbidden' }, 403);
    text = [row.title, row.description]
      .map((v: string | null) => (v ?? '').trim())
      .filter(Boolean)
      .join('\n\n');
  }
  if (!text) {
    // Nothing to screen — treat as a clean no-op rather than an error.
    return json({ verdict: 'ok', categories: [], reason: '', applied: false });
  }
  text = text.slice(0, MAX_TEXT_CHARS);

  // Rate limit BEFORE spending money on the model (per-user, per-feature/hour).
  const { data: allowed, error: rlErr } = await caller.rpc('check_ai_rate_limit', {
    p_feature: FEATURE,
    p_max_per_hour: MAX_PER_HOUR,
  });
  if (rlErr) {
    console.error('[ai-moderate-text] rate-limit check failed:', rlErr.message);
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
            {
              type: 'text',
              text:
                'Classify this user-written text from the cat-rescue app. ' +
                'Return only the structured object.\n\n---\n' +
                text,
            },
          ],
        },
      ],
    });
  } catch (e) {
    console.error('[ai-moderate-text] model call failed:', e instanceof Error ? e.message : e);
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
        p_type: type,
        p_id: id,
        p_verdict: verdict,
        p_categories: categories,
        p_reason: reason || 'text flagged by automated moderation',
      });
      if (modErr) {
        console.error('[ai-moderate-text] ai_moderate_content failed:', modErr.message);
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
  if (logErr) console.error('[ai-moderate-text] log_ai_usage failed:', logErr.message);

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
