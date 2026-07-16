// Shared Voyage AI embedding client for Guardians edge functions (Deno runtime).
// -----------------------------------------------------------------------------
// Dependency-free wrapper around the Voyage AI embeddings endpoint using native
// fetch — mirrors _shared/anthropic.ts's "no SDK, raw fetch" posture. The API key
// lives ONLY in the edge runtime as the VOYAGE_API_KEY secret and never reaches
// the client (AI_ROADMAP principle 1: model keys are server-side only).
//
// Why Voyage (and not Anthropic) for embeddings: Anthropic's Claude API does NOT
// provide an embeddings endpoint, while AI-M3 (cat re-ID), AI-M4 (lost-cat
// matching), and AI-M5#7 (RAG knowledge base) all need to compute numeric
// embeddings. Voyage is Anthropic's recommended embedding provider, and
// `voyage-3` emits a fixed **1024-dim** vector — which is exactly the width
// migration 0019 chose for `embeddings.embedding vector(1024)`. Using one model
// for both text and (captioned) image inputs keeps the embedding space uniform
// so a lost-cat photo and a sighting photo can be compared by cosine distance.
//
// Set the secret before any ai-* function that calls Voyage can work:
//   supabase secrets set VOYAGE_API_KEY=pa-...
//
// This file is Deno, not part of the React Native app (excluded in tsconfig).

const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';

/**
 * Default model. `voyage-3` emits a fixed 1024-dim vector (no flexible
 * dimensions), matching `embeddings.embedding vector(1024)` from migration 0019.
 * It is listed in Voyage's "older models" table but remains fully supported.
 * Keep this in sync with src/constants/ai.ts (display only) when that file gains
 * an embeddings-model constant.
 */
export const VOYAGE_3 = 'voyage-3';

/**
 * Rough Voyage pricing (USD per token) for the usage ledger's est_cost.
 * Display/accounting only — not billing — so an approximate figure is fine.
 * Source: https://docs.voyageai.com/docs/pricing ("Older models" table):
 *   voyage-3 — $0.00006 per 1K tokens = $0.06 per 1M tokens.
 */
export const VOYAGE_USD_PER_TOKEN = 0.06 / 1_000_000;

/** Voyage accepts `query` or `document` (or null); we default to `document`. */
export type VoyageInputType = 'document' | 'query';

export interface EmbedTextsResult {
  /** One 1024-dim vector per input string, in input order. */
  embeddings: number[][];
  usage: { total_tokens: number };
}

/** Read the Voyage API key from the edge runtime, or throw a clear error. */
export function requireVoyageKey(): string {
  const key = Deno.env.get('VOYAGE_API_KEY');
  if (!key) {
    throw new Error('VOYAGE_API_KEY is not configured for this edge function.');
  }
  return key;
}

/** True when the Voyage key is present — lets scaffolds report readiness. */
export function isVoyageConfigured(): boolean {
  return Boolean(Deno.env.get('VOYAGE_API_KEY'));
}

/**
 * POST to the Voyage embeddings endpoint and return the parsed vectors.
 * Throws on a non-2xx response (with the response body) or a body that doesn't
 * contain the expected `data[].embedding` array.
 *
 * `inputType` controls the retrieval prepended prompt: 'document' for things
 * you store and later search against (sighting captions, KB chunks), 'query'
 * for a short probe at search time. Embeddings from both are compatible.
 */
export async function embedTexts(
  texts: string[],
  inputType: VoyageInputType = 'document',
): Promise<EmbedTextsResult> {
  const apiKey = requireVoyageKey();

  // No dtype/encoding fields: a float list is the documented default, and the
  // Voyage API has no `embedding_format` parameter (the real names are
  // `output_dtype` / `encoding_format`) — unknown keys risk a 400 under strict
  // validation, which would take down every embedding feature at once.
  const body = {
    model: VOYAGE_3,
    input: texts,
    input_type: inputType,
  };

  const resp = await fetch(VOYAGE_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Voyage API error ${resp.status}: ${detail}`);
  }

  const payload = (await resp.json()) as {
    data?: { embedding?: number[] }[];
    usage?: { total_tokens?: number };
  };

  const embeddings = (payload.data ?? []).map((row, i) => {
    if (!Array.isArray(row?.embedding)) {
      throw new Error(`Voyage response missing embedding at index ${i}.`);
    }
    return row.embedding;
  });

  if (embeddings.length === 0) {
    throw new Error('Voyage response contained no embeddings.');
  }

  return {
    embeddings,
    usage: { total_tokens: payload.usage?.total_tokens ?? 0 },
  };
}

/**
 * Single-text convenience wrapper returning one 1024-dim vector.
 * Use 'query' when this text is a search probe, 'document' when it is something
 * you are storing for later retrieval.
 */
export async function embedText(
  text: string,
  inputType: VoyageInputType = 'document',
): Promise<number[]> {
  const { embeddings } = await embedTexts([text], inputType);
  return embeddings[0];
}
