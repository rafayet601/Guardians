// Supabase Edge Function: ai-report-autofill (Deno runtime)
// -----------------------------------------------------------------------------
// AI-M1 #1 — Photo → report autofill. Takes a single base64 cat photo and asks
// a Haiku-class vision model to suggest a title, description, coat color,
// distinguishing marks, temperament (from the closed cat_temperament enum), and
// a SOFT is_injured flag. Returns those as an editable *suggestion* — the client
// prefills the report form with them and the human still reviews & submits
// (AI_ROADMAP principle 2). This endpoint NEVER creates a sighting and NEVER
// returns a diagnosis: is_injured is a "consider marking this" hint only
// (principle 3).
//
// Auth mirrors send-push/delete-account/ai-health exactly: POST-only; 401 if
// there is no Authorization header; an anon-key client scoped to the caller's
// JWT identifies the user AND runs the usage/rate-limit RPCs so auth.uid() is
// the caller (log_ai_usage / check_ai_rate_limit are SECURITY DEFINER, granted
// to `authenticated`). No service-role client is needed — this reads no
// privileged data.
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-report-autofill
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude, imageBlock, isAnthropicConfigured } from '../_shared/anthropic.ts';

const FEATURE = 'report_autofill';
const MAX_PER_HOUR = 20;

// Closed set the model must choose from — kept in sync with the cat_temperament
// enum (migration 0001) and src/types/models.ts CatTemperament. If the enum ever
// changes, update all three.
const TEMPERAMENTS = ['friendly', 'shy', 'feral', 'unknown'] as const;

// Rough Haiku pricing (USD per token) for the usage ledger's est_cost. Display
// only — accounting, not billing — so an approximate figure is fine.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

const AUTOFILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description:
        'Short friendly nickname for the cat, e.g. "Orange tabby by the park". Max ~60 chars.',
    },
    description: {
      type: 'string',
      description:
        'One or two neutral sentences describing the cat and anything visible that helps identify it.',
    },
    color: {
      type: 'string',
      description: 'Dominant coat color(s), e.g. "black & white", "orange tabby".',
    },
    marks: {
      type: 'string',
      description:
        'Distinguishing marks (torn ear, collar, unusual patches). Empty string if none are visible.',
    },
    temperament: {
      type: 'string',
      enum: TEMPERAMENTS,
      description:
        'Best guess of temperament from the closed set. Use "unknown" when the photo does not make it clear.',
    },
    is_injured: {
      type: 'boolean',
      description:
        'A SOFT hint only: true if the cat visibly *might* be hurt and the reporter should consider marking it as needing care. This is NOT a diagnosis.',
    },
  },
  required: ['title', 'description', 'color', 'marks', 'temperament', 'is_injured'],
} as const;

const SYSTEM = [
  'You help a community cat-rescue app pre-fill a "report a cat" form from a photo.',
  'You are drafting *editable suggestions* for a human who will review and correct them before submitting — never the final record.',
  'Describe only what is visible. Do not invent details you cannot see; prefer "unknown" and empty strings over guesses.',
  `Temperament MUST be exactly one of: ${TEMPERAMENTS.join(', ')}.`,
  'You are NOT a veterinarian. For is_injured, only flag a soft "the reporter should consider that this cat may need care" hint when something looks visibly wrong. Never diagnose, never assess severity.',
  'Keep all text neutral, brief, and kind.',
].join(' ');

interface AutofillSuggestion {
  title: string;
  description: string;
  color: string;
  marks: string;
  temperament: (typeof TEMPERAMENTS)[number];
  is_injured: boolean;
}

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

  if (!isAnthropicConfigured()) {
    return json({ error: 'AI is not configured on the server.' }, 503);
  }

  let body: { imageBase64?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType : 'image/jpeg';
  if (!imageBase64) return json({ error: 'imageBase64 required' }, 400);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return json({ error: 'Unsupported media type' }, 400);
  }

  // Rate limit BEFORE spending money on the model (per-user, per-feature/hour).
  const { data: allowed, error: rlErr } = await caller.rpc('check_ai_rate_limit', {
    p_feature: FEATURE,
    p_max_per_hour: MAX_PER_HOUR,
  });
  if (rlErr) {
    console.error('[ai-report-autofill] rate-limit check failed:', rlErr.message);
    return json({ error: 'Could not verify rate limit' }, 500);
  }
  if (!allowed) {
    return json(
      {
        error: 'rate_limited',
        message: 'You have used photo autofill too many times this hour. Please try again later.',
      },
      429,
    );
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await callClaude<AutofillSuggestion>({
      system: SYSTEM,
      maxTokens: 512,
      jsonSchema: AUTOFILL_SCHEMA as unknown as Record<string, unknown>,
      messages: [
        {
          role: 'user',
          content: [
            imageBlock(mediaType, imageBase64),
            {
              type: 'text',
              text: 'Suggest report fields for this cat photo. Return only the structured object.',
            },
          ],
        },
      ],
    });
  } catch (e) {
    console.error('[ai-report-autofill] model call failed:', e instanceof Error ? e.message : e);
    return json({ error: 'AI request failed. Please fill the form in manually.' }, 502);
  }
  const latencyMs = Date.now() - startedAt;

  // Defensive normalisation: never trust the model to have stayed in the enum.
  const raw = result.output;
  const temperament = (TEMPERAMENTS as readonly string[]).includes(raw?.temperament)
    ? raw.temperament
    : 'unknown';
  const suggestion: AutofillSuggestion = {
    title: str(raw?.title),
    description: str(raw?.description),
    color: str(raw?.color),
    marks: str(raw?.marks),
    temperament: temperament as AutofillSuggestion['temperament'],
    is_injured: raw?.is_injured === true,
  };

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
  if (logErr) console.error('[ai-report-autofill] log_ai_usage failed:', logErr.message);

  return json({ suggestion });
});

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
