// Supabase Edge Function: ai-adoption-copy (Deno runtime)
// -----------------------------------------------------------------------------
// AI-M1 #13 — Adoption profile writer. Given a single sighting id, drafts a warm,
// community-voiced adoption listing DERIVED ONLY FROM THAT SIGHTING'S REAL DATA:
// its reporter note (title/description), its sighting_updates timeline, its
// temperament/injury fields, and the reporter's / assigned guardian's usernames.
// The model is told, hard, to never invent traits or backstory not present in
// that data. The output is a *draft* — the reporter reviews, edits, and saves it
// via the existing profile-update path; this endpoint NEVER writes the listing
// and NEVER auto-publishes (AI_ROADMAP principle 2).
//
// Auth mirrors send-push/delete-account/ai-report-autofill exactly: POST-only;
// 401 if there is no Authorization header; an anon-key client scoped to the
// caller's JWT identifies the user AND runs the usage/rate-limit RPCs so
// auth.uid() is the caller (log_ai_usage / check_ai_rate_limit are SECURITY
// DEFINER, granted to `authenticated`). A SEPARATE service-role client performs
// the privileged reads (sighting + timeline + usernames), like send-push.
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-adoption-copy
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude, isAnthropicConfigured } from '../_shared/anthropic.ts';

const FEATURE = 'adoption_copy';
const MAX_PER_HOUR = 10;

// Rough Haiku pricing (USD per token) for the usage ledger's est_cost. Display
// only — accounting, not billing — so an approximate figure is fine.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

// Human-readable temperament labels, kept in sync with the cat_temperament enum
// (migration 0001) and src/constants/status.ts TEMPERAMENT_META.
const TEMPERAMENT_LABEL: Record<string, string> = {
  friendly: 'friendly',
  shy: 'shy',
  feral: 'feral / not yet socialised',
  unknown: 'temperament not yet known',
};

const SYSTEM = [
  'You write short adoption listings for Guardians, a community cat-rescue app.',
  'The brand voice is warm, neighbourly, and community-driven — it should read like a caring neighbour wrote it, never like a salesy ad and never saccharine. The app\'s own tagline is "Every cat deserves a Guardian".',
  "You are drafting an EDITABLE draft for the cat's reporter or guardian to review and polish before it is published — never the final, published listing.",
  'CRITICAL GROUNDING RULE: use ONLY the facts provided about this specific cat and its rescue timeline. Never invent a name, breed, age, backstory, medical detail, or personality trait that is not present in the supplied data. If a detail is unknown, simply leave it out — do not guess or embellish.',
  'You are NOT a veterinarian: never diagnose or assess the severity of any injury. If the data mentions an injury, phrase it gently and factually (e.g. "was found injured and has been in care") without medical claims.',
  'Write 2 short paragraphs (about 60–110 words total): first, warmly introduce the cat using its real described traits; second, a gentle, hopeful invitation to give it a forever home. Refer to the cat by its listing nickname if one is given, otherwise as "this cat" / "them". Do not add a title, headers, markdown, hashtags, or a signature — return only the listing body text.',
].join(' ');

interface ProfileRow {
  id: string;
  username: string | null;
}

interface UpdateRow {
  type: string;
  body: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
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

  let body: { sighting_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }
  const sightingId = typeof body.sighting_id === 'string' ? body.sighting_id : '';
  if (!sightingId) return json({ error: 'sighting_id required' }, 400);

  // Privileged reads via the service role (never exposed to clients), like
  // send-push. RLS would also allow the reporter/guardian to read these, but
  // using the service role keeps the read deterministic and mirrors send-push.
  const admin = createClient(url, serviceKey);

  const { data: s, error: sErr } = await admin
    .from('sightings')
    .select(
      'id, reporter_id, claimed_by, title, description, status, temperament, color, is_injured',
    )
    .eq('id', sightingId)
    .single();
  if (sErr || !s) return json({ error: 'Sighting not found' }, 404);

  // Only the reporter or the assigned guardian may draft this listing — mirrors
  // the ownership check in update_sighting_status (migration 0002).
  if (s.reporter_id !== user.id && s.claimed_by !== user.id) {
    return json({ error: 'Forbidden' }, 403);
  }

  // The listing only makes sense for a cat that is ready to adopt.
  if (s.status !== 'available') {
    return json({ error: 'This cat is not marked as ready to adopt.' }, 409);
  }

  // Rate limit BEFORE spending money on the model (per-user, per-feature/hour).
  const { data: allowed, error: rlErr } = await caller.rpc('check_ai_rate_limit', {
    p_feature: FEATURE,
    p_max_per_hour: MAX_PER_HOUR,
  });
  if (rlErr) {
    console.error('[ai-adoption-copy] rate-limit check failed:', rlErr.message);
    return json({ error: 'Could not verify rate limit' }, 500);
  }
  if (!allowed) {
    return json(
      {
        error: 'rate_limited',
        message: 'You have drafted too many listings this hour. Please try again later.',
      },
      429,
    );
  }

  // Timeline + the people involved, so the draft can honestly reference the
  // rescue journey ("spotted by …, cared for by …") without inventing anything.
  const [{ data: updates }, { data: people }] = await Promise.all([
    admin
      .from('sighting_updates')
      .select('type, body, old_status, new_status, created_at')
      .eq('sighting_id', sightingId)
      .order('created_at', { ascending: true }),
    admin
      .from('profiles')
      .select('id, username')
      .in(
        'id',
        [s.reporter_id, s.claimed_by].filter((v): v is string => Boolean(v)),
      ),
  ]);

  const byId = new Map<string, ProfileRow>((people ?? []).map((p) => [p.id, p as ProfileRow]));
  const reporterName = s.reporter_id ? (byId.get(s.reporter_id)?.username ?? null) : null;
  const guardianName = s.claimed_by ? (byId.get(s.claimed_by)?.username ?? null) : null;

  const factSheet = buildFactSheet(s, updates ?? [], reporterName, guardianName);

  const startedAt = Date.now();
  let result;
  try {
    result = await callClaude<string>({
      system: SYSTEM,
      maxTokens: 400,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Draft an adoption listing for this cat using ONLY the facts below. ' +
                'Do not invent anything not stated here. Return only the listing body.\n\n' +
                factSheet,
            },
          ],
        },
      ],
    });
  } catch (e) {
    console.error('[ai-adoption-copy] model call failed:', e instanceof Error ? e.message : e);
    return json({ error: 'AI request failed. Please write the listing manually.' }, 502);
  }
  const latencyMs = Date.now() - startedAt;

  const draft = typeof result.output === 'string' ? result.output.trim() : '';
  if (!draft) {
    return json({ error: 'AI request failed. Please write the listing manually.' }, 502);
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
  if (logErr) console.error('[ai-adoption-copy] log_ai_usage failed:', logErr.message);

  return json({ draft });
});

/**
 * Turn the real sighting record + timeline into a plain-text fact sheet the
 * model may draw from. Only facts that are actually present are included — an
 * absent field is simply omitted so the model has nothing to embellish.
 */
function buildFactSheet(
  s: {
    title: string | null;
    description: string | null;
    temperament: string | null;
    color: string | null;
    is_injured: boolean | null;
  },
  updates: UpdateRow[],
  reporterName: string | null,
  guardianName: string | null,
): string {
  const lines: string[] = [];

  const nickname = (s.title ?? '').trim();
  lines.push(`Listing nickname: ${nickname || '(none given — do not invent one)'}`);

  const color = (s.color ?? '').trim();
  if (color) lines.push(`Coat / markings: ${color}`);

  const temperament = s.temperament ? TEMPERAMENT_LABEL[s.temperament] : undefined;
  if (temperament) lines.push(`Temperament: ${temperament}`);

  if (s.is_injured) {
    lines.push('Health: was found injured and has been receiving care (do not diagnose).');
  }

  const reporterNote = (s.description ?? '').trim();
  if (reporterNote) lines.push(`Reporter's original note: "${reporterNote}"`);

  if (reporterName) lines.push(`Spotted and reported by community member: ${reporterName}`);
  if (guardianName) lines.push(`Rescued / cared for by guardian: ${guardianName}`);

  // Comments from the community timeline are real, human-written context. Keep
  // only free-text comments (status_change / claim / system rows are just state
  // machinery, not descriptive of the cat).
  const comments = updates
    .filter((u) => u.type === 'comment' && (u.body ?? '').trim())
    .map((u) => (u.body ?? '').trim());
  if (comments.length) {
    lines.push('Community updates from the rescue timeline (real notes people left):');
    for (const c of comments.slice(0, 12)) lines.push(`  - "${c}"`);
  }

  return lines.join('\n');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
