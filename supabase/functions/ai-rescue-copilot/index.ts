// Supabase Edge Function: ai-rescue-copilot (Deno runtime)
// -----------------------------------------------------------------------------
// AI-M5 #7 — RAG-grounded Q&A for a Guardian who has CLAIMED a sighting.
// Answers questions on approaching, humane trapping, and safe transport of
// stray/lost cats strictly from a curated, founder-vetted knowledge base
// (migration 0024). This is the one AI feature in the app that produces open
// advice, so it carries the strictest guardrails of any edge function here.
//
// GUARDRAILS (ai-rag-agent charter, enforced below in this exact order):
//   1. Server-side guardian gate: the sighting's `claimed_by` MUST equal the
//      caller's user id (403 otherwise). A client-side `isClaimer` hide is
//      not enough — a non-claimer can never reach the model.
//   2. Per-user hourly ceiling: 20 rescue-copilot calls / hour (check_ai_rate_limit).
//   3. RAG-grounded, never free-generation: the question is embedded, the KB
//      is retrieved via `match_kb_chunks`, and IF the best chunk's cosine
//      distance is > SIMILARITY_THRESHOLD the function returns a graceful
//      deferral with `has_match: false` and NO sources. It does NOT call
//      Claude and does NOT fill the gap with general training. This is the
//      single most important constraint in this file.
//   4. No medical diagnosis / no treatment suggestion: the system prompt says
//      so verbatim-in-spirit; medical-adjacent questions get an acknowledge +
//      KB-sourced first-response (if any) + "contact a vet / animal services."
//   5. No unsafe-rescuer action; out-of-scope questions are refused gracefully.
//
// Auth mirrors ai-moderate-text exactly: POST-only; 401 without an
// Authorization header; an anon-key client scoped to the caller's JWT
// identifies the user AND runs the usage / rate-limit / retrieval RPCs so
// auth.uid() is the caller. A SEPARATE service-role client reads the sighting
// (RLS would let any authenticated user read the row, but we re-read with the
// service role so `claimed_by` is the canonical DB value and cannot be
// spoofed by a tampered client request body).
//
// Model: Haiku for MVP (cheap, low-volume). A future upgrade to a larger
// model is a one-line change (`model: ...`); the guardrails above do not
// depend on the model tier.
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-rescue-copilot
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... VOYAGE_API_KEY=pa-...
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude, isAnthropicConfigured } from '../_shared/anthropic.ts';
import { embedTexts, isVoyageConfigured, VOYAGE_USD_PER_TOKEN } from '../_shared/voyage.ts';

const FEATURE = 'rescue_copilot';
// Per-user hourly ceiling (AI_ROADMAP: the one low-volume RAG copilot gets a
// per-user daily-call cap). 20/hr is generous for one rescue and keeps the
// bill bounded if a user spam-asks; the rate-limit RPC (0019) does the count.
const MAX_PER_HOUR = 20;

// Retrieval similarity threshold (cosine DISTANCE, smaller = more similar).
// Voyage-3 returns normalized vectors, so `<=>` distance = 1 − cosine
// similarity. A distance of 0.55 ⇒ cosine similarity ≈ 0.45.
//
// Why 0.55 (and not tighter / looser):
//   * Tighter (e.g. 0.35, cosine ≈ 0.65) would over-defer — short natural-
//     language questions like "how do I bait the trap?" embed a few words
//     away from the KB chunk "Bait with a strong-smelling food…", so a tight
//     cutoff would refuse questions the KB clearly answers.
//   * Looser (e.g. 0.75, cosine ≈ 0.25) would let weak matches through and
//     tempt the model to bridge the gap with general training, which is
//     exactly the failure mode the ai-rag-agent charter forbids.
// 0.55 sits between: a question that maps to the KB's vocabulary passes; a
// question on a topic the KB does not cover (medical diagnosis, non-cats,
// off-rescue advice) lands above the cutoff and is deferred, not answered.
//
// Tuning: re-evaluate against docs/ai/rag-golden-set.md on every model /
// embedding change before merging. Record the new pass rate there.
const SIMILARITY_THRESHOLD = 0.55;

const MAX_QUESTION_CHARS = 1000;
const RETRIEVE_LIMIT = 6;

// Rough Haiku pricing (USD per token) for the usage ledger's est_cost.
// Display only — accounting, not billing.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

// System-prompt guardrails — present verbatim-in-spirit per the ai-rag-agent
// charter. Do NOT paraphrase these away when editing.
const SYSTEM_PROMPT = [
  'You are the rescue copilot for Guardians, a community cat-rescue app where neighbours coordinate helping stray and lost cats.',
  'Answer ONLY questions about approaching, safely trapping, and transporting stray or lost cats, grounded strictly in the provided knowledge-base excerpts.',
  'Never diagnose an injury or illness, and never suggest a treatment. If a question is medical-adjacent, acknowledge the concern, give only knowledge-base-sourced first-response guidance if the excerpts contain any, and recommend contacting a veterinarian or local animal services.',
  "Never suggest an action that risks the rescuer's physical safety.",
  'If the excerpts do not contain relevant information, say so plainly and defer to professional resources — do NOT use your general training knowledge to fill the gap.',
  'Refuse gracefully and briefly when a question is out of scope (not related to cat rescue).',
  'Keep your answer short, practical, and warm. Cite the provided source labels inline (e.g. "per Alley Cat Allies TNR guide").',
].join(' ');

// The graceful deferral returned when no KB chunk is close enough. Per the
// charter, this is the answer for a KB gap — never a model-generated guess.
const DEFERRAL_ANSWER =
  "I don't have reliable info on that — for anything involving an injury or the cat's safety, please contact a vet or local animal services.";

interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  title: string;
  source: string;
  chunk_text: string;
  distance: number;
}

interface SourceOut {
  title: string;
  source: string;
  snippet: string;
}

interface CopilotResponse {
  answer: string;
  sources: SourceOut[];
  has_match: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from their session JWT. This same client runs the
  // usage / rate-limit / retrieval RPCs so auth.uid() attributes the call.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body: { sighting_id?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const sightingId = typeof body.sighting_id === 'string' ? body.sighting_id.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sightingId)) {
    return json({ error: 'sighting_id must be a uuid' }, 400);
  }
  if (!question) return json({ error: 'question is required' }, 400);
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ error: `question must be ≤ ${MAX_QUESTION_CHARS} chars` }, 400);
  }

  // ── Server-side guardian gate (charter: server-side, not client-side hide).
  // Re-read the sighting with the service role so `claimed_by` is the
  // canonical DB value and cannot be tampered with via the request body.
  const admin = createClient(url, serviceKey);
  const { data: sighting, error: sightErr } = await admin
    .from('sightings')
    .select('id, claimed_by, temperament, is_injured, needs_urgent_help, status')
    .eq('id', sightingId)
    .single();
  if (sightErr || !sighting) return json({ error: 'Sighting not found' }, 404);
  if (sighting.claimed_by !== user.id) {
    return json({ error: 'Only the assigned guardian may use the rescue copilot' }, 403);
  }

  if (!isVoyageConfigured() || !isAnthropicConfigured()) {
    return json({ error: 'AI is not configured on the server.' }, 503);
  }

  // ── Rate limit BEFORE spending money on the embedding + model calls.
  const { data: allowed, error: rlErr } = await caller.rpc('check_ai_rate_limit', {
    p_feature: FEATURE,
    p_max_per_hour: MAX_PER_HOUR,
  });
  if (rlErr) {
    console.error('[ai-rescue-copilot] rate-limit check failed:', rlErr.message);
    return json({ error: 'Could not verify rate limit' }, 500);
  }
  if (!allowed) {
    return json(
      {
        error: 'rate_limited',
        message: 'You have asked the copilot a lot this hour. Please try again later.',
      },
      429,
    );
  }

  const startedAt = Date.now();

  // ── Embed the question with Voyage ('query' input type for a search probe).
  let queryEmbedding: number[];
  let voyageTokens = 0;
  try {
    // embedTexts (not the embedText wrapper) so the real token count reaches the
    // usage ledger — it feeds p_input and the Voyage line of the cost estimate
    // below. Same pattern as ai-embed.
    const { embeddings, usage } = await embedTexts([question], 'query');
    queryEmbedding = embeddings[0];
    voyageTokens = usage.total_tokens;
  } catch (e) {
    console.error(
      '[ai-rescue-copilot] voyage query embed failed:',
      e instanceof Error ? e.message : e,
    );
    return json({ error: 'Could not embed the question.' }, 502);
  }

  // ── Retrieve KB chunks via match_kb_chunks (called with the caller's JWT
  // so the RPC sees auth.uid() = the user; granted to authenticated in 0024).
  const { data: retrieved, error: matchErr } = await caller.rpc('match_kb_chunks', {
    p_query: queryEmbedding,
    p_limit: RETRIEVE_LIMIT,
  });
  if (matchErr) {
    console.error('[ai-rescue-copilot] match_kb_chunks failed:', matchErr.message);
    return json({ error: 'Retrieval failed.' }, 502);
  }
  const chunks = (retrieved ?? []) as RetrievedChunk[];

  // ── RAG guardrail: if the BEST chunk is still too far, defer. Do NOT call
  // the model. Do NOT fill the gap with general training. (Most important
  // constraint in the ai-rag-agent charter.)
  if (chunks.length === 0 || chunks[0].distance > SIMILARITY_THRESHOLD) {
    const latencyMs = Date.now() - startedAt;
    // Still log the attempt so the founder can see "X% of asks were deferred"
    // (a high deferral rate ⇒ the KB has gaps to fill). Zero model tokens.
    const { error: logErr } = await caller.rpc('log_ai_usage', {
      p_feature: FEATURE,
      p_model: 'deferred',
      p_input: voyageTokens,
      p_output: 0,
      p_cost: 0,
      p_latency: latencyMs,
    });
    if (logErr) console.error('[ai-rescue-copilot] log_ai_usage (defer) failed:', logErr.message);

    const out: CopilotResponse = {
      answer: DEFERRAL_ANSWER,
      sources: [],
      has_match: false,
    };
    return json(out);
  }

  // ── Build the RAG prompt: sighting context + retrieved chunks with source
  // labels, then the guardian's question. The system prompt (above) carries
  // the guardrails; this user message carries only the grounding context.
  const contextLines: string[] = [];
  contextLines.push('Sighting context (use only to personalize; do not diagnose from it):');
  contextLines.push(`- Temperament: ${sighting.temperament ?? 'unknown'}`);
  contextLines.push(`- Injured flag: ${sighting.is_injured ? 'yes' : 'no'}`);
  contextLines.push(`- Urgent help needed: ${sighting.needs_urgent_help ? 'yes' : 'no'}`);
  contextLines.push(`- Status: ${sighting.status ?? 'unknown'}`);
  contextLines.push('');
  contextLines.push('Knowledge-base excerpts (cite by source label):');
  chunks.forEach((c, i) => {
    contextLines.push(`[${i + 1}] (${c.source}): ${c.chunk_text.trim()}`);
  });
  contextLines.push('');
  contextLines.push(`Guardian's question: ${question}`);

  const userText = contextLines.join('\n');

  let answerText = '';
  let claudeInputTokens = 0;
  let claudeOutputTokens = 0;
  let claudeModel = '';
  try {
    const result = await callClaude<string>({
      system: SYSTEM_PROMPT,
      maxTokens: 512,
      messages: [{ role: 'user', content: userText }],
    });
    answerText = result.output.trim();
    claudeInputTokens = result.usage.input_tokens;
    claudeOutputTokens = result.usage.output_tokens;
    claudeModel = result.model;
  } catch (e) {
    console.error('[ai-rescue-copilot] model call failed:', e instanceof Error ? e.message : e);
    return json({ error: 'AI copilot failed.' }, 502);
  }
  if (!answerText) {
    return json({ error: 'No answer returned.' }, 502);
  }

  const latencyMs = Date.now() - startedAt;

  // De-duplicate sources by (title, source) — a chunk may share a document
  // with another; we show one source pill per document the answer drew from.
  const seen = new Set<string>();
  const sources: SourceOut[] = [];
  for (const c of chunks) {
    const key = `${c.title}|${c.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const snippet = c.chunk_text.trim().slice(0, 160);
    sources.push({ title: c.title, source: c.source, snippet });
  }

  // ── Record the call in the usage ledger (best-effort).
  const estCost =
    voyageTokens * VOYAGE_USD_PER_TOKEN +
    claudeInputTokens * HAIKU_INPUT_USD_PER_TOKEN +
    claudeOutputTokens * HAIKU_OUTPUT_USD_PER_TOKEN;
  const { error: logErr } = await caller.rpc('log_ai_usage', {
    p_feature: FEATURE,
    p_model: claudeModel,
    p_input: voyageTokens + claudeInputTokens,
    p_output: claudeOutputTokens,
    p_cost: estCost,
    p_latency: latencyMs,
  });
  if (logErr) console.error('[ai-rescue-copilot] log_ai_usage failed:', logErr.message);

  const out: CopilotResponse = { answer: answerText, sources, has_match: true };
  return json(out);
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
