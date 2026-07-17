// Supabase Edge Function: ai-kb-ingest (Deno runtime)
// -----------------------------------------------------------------------------
// AI-M5 #7 — one-time moderator ingestion for the rescue-copilot knowledge
// base (migration 0024). Chunks any kb_documents that have no kb_chunks yet
// (paragraph / ~800-char windows) and embeds any kb_chunks that have no
// embedding yet, storing the vector via the service-role-only `store_embedding`
// RPC (migration 0021) with owner_type='kb', owner_id=chunk_id, kind='kb_chunk'.
//
// Idempotent: re-running skips docs that already have chunks and chunks that
// already have embeddings, so a founder can run it again after editing the KB
// (today edits are appends — a chunk-text edit would need a manual re-embed,
// out of scope here) or after the Voyage key is configured.
//
// GUARDRAIL (ai-rag-agent charter): this is the WRITE path into the KB. Only
// a moderator may trigger it — `is_moderator()` is enforced server-side via
// the anon-key client (granted to authenticated, body checks the boolean),
// 403 otherwise. A non-moderator client can never inject or re-embed KB
// content. The KB content itself is human-authored in the migration; this
// function only chunks and embeds what the founder already approved.
//
// Auth mirrors ai-moderate-text / ai-mod-copilot exactly: POST-only; 401
// without an Authorization header; an anon-key client scoped to the caller's
// JWT identifies the user AND runs the usage / rate-limit RPCs so auth.uid()
// is the caller. A SEPARATE service-role client does the privileged reads /
// writes (kb_documents/kb_chunks RLS bypass + store_embedding, which is
// service_role-only per 0021).
//
// Deploy (human, with explicit authorization):
//   supabase functions deploy ai-kb-ingest
//   supabase secrets set VOYAGE_API_KEY=pa-...
// This file is Deno, not part of the React Native app (excluded in tsconfig).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  embedTexts,
  isVoyageConfigured,
  VOYAGE_3,
  VOYAGE_USD_PER_TOKEN,
} from '../_shared/voyage.ts';

const FEATURE = 'kb_ingest';
// Ingest is rare and founder-run; the cap is generous but exists so a runaway
// loop can't burn the Voyage bill if re-run repeatedly in a short window.
const MAX_PER_HOUR = 30;

// Chunking target (characters). Paragraphs are joined until ~this length, then
// a new chunk starts; a paragraph longer than this is hard-split. Kept around
// 800 so each chunk embeds as one focused reference card section, and so the
// copilot prompt stays small (a few hundred tokens of context per retrieval).
const CHUNK_TARGET = 800;

// The embedding kind tag the rescue-copilot retrieval filters on. Keep in
// sync with match_kb_chunks (0024) and ai-rescue-copilot.
const KB_KIND = 'kb_chunk';
const KB_OWNER = 'kb';

// Row shapes returned by the untyped (non-Database-generic) supabase-js
// client. The client is created with `createClient(url, serviceKey)` (no
// Database generic), so `.select()` returns `data: any`. We cast to these
// narrow interfaces so Deno's strict mode has explicit element types for
// the `.map` / `.filter` callbacks below.
interface KbDocRow {
  id: string;
  content: string | null;
}
interface KbChunkCountRow {
  document_id: string;
}
interface KbChunkRow {
  id: string;
  chunk_text: string | null;
}
interface EmbeddingRow {
  owner_id: string;
}

// PostgREST silently caps un-ranged selects at max-rows (default 1000) with no
// error. Page explicitly so a KB past ~1000 chunks doesn't silently re-chunk
// documents (duplicate rows), re-embed already-paid chunks, or strand chunks
// past the cap that would never get embedded at all.
async function selectAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: T[]; errorMessage: string | null }> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, errorMessage: error.message };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, errorMessage: null };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from their session JWT. This same client runs the
  // usage RPCs so auth.uid() attributes the call to the user, and runs the
  // is_moderator() helper (granted to authenticated, 0016) so we can gate.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // Moderator gate: only the founder / a delegated moderator may (re)ingest
  // the KB. is_moderator() (0012) is granted to authenticated (0016) and
  // evaluates the caller's profile row, so this runs as the caller.
  const { data: isMod, error: modErr } = await caller.rpc('is_moderator');
  if (modErr) {
    console.error('[ai-kb-ingest] is_moderator check failed:', modErr.message);
    return json({ error: 'Could not verify moderator status' }, 500);
  }
  if (!isMod) return json({ error: 'Moderators only' }, 403);

  if (!isVoyageConfigured()) {
    return json({ error: 'Embeddings are not configured on the server.' }, 503);
  }

  // Rate limit BEFORE spending money on embeddings.
  const { data: allowed, error: rlErr } = await caller.rpc('check_ai_rate_limit', {
    p_feature: FEATURE,
    p_max_per_hour: MAX_PER_HOUR,
  });
  if (rlErr) {
    console.error('[ai-kb-ingest] rate-limit check failed:', rlErr.message);
    return json({ error: 'Could not verify rate limit' }, 500);
  }
  if (!allowed) {
    return json({ error: 'rate_limited', message: 'Too many ingest runs this hour.' }, 429);
  }

  // Privileged reads/writes use the service role: kb_documents / kb_chunks are
  // read-only to authenticated and have no client INSERT policy, and
  // store_embedding is service_role-only (0021).
  const admin = createClient(url, serviceKey);

  const startedAt = Date.now();
  let voyageTokens = 0;
  let embedded = 0;

  // Record the run in the usage ledger — called on the success path AND before
  // every post-spend error return. A paid-but-failed run must still count
  // toward check_ai_rate_limit's cap (which counts ai_usage rows), otherwise a
  // retry loop against a persistent failure re-pays Voyage forever with the
  // limiter reading "under cap" and the ledger showing nothing.
  const logUsage = async () => {
    const { error: logErr } = await caller.rpc('log_ai_usage', {
      p_feature: FEATURE,
      p_model: VOYAGE_3,
      p_input: voyageTokens,
      p_output: 0,
      p_cost: voyageTokens * VOYAGE_USD_PER_TOKEN,
      p_latency: Date.now() - startedAt,
    });
    if (logErr) console.error('[ai-kb-ingest] log_ai_usage failed:', logErr.message);
  };

  // ── 1. Find documents without any chunks yet and chunk them ──────────────
  // A "chunked" document has at least one row in kb_chunks.
  const { rows: unchunked, errorMessage: unchunkedErr } = await selectAll<KbDocRow>((from, to) =>
    admin
      .from('kb_documents')
      .select('id, content')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (unchunkedErr) {
    console.error('[ai-kb-ingest] kb_documents read failed:', unchunkedErr);
    return json({ error: 'Could not read KB documents' }, 500);
  }

  // Per-document chunk presence: only insert chunks for docs that have zero rows.
  const { rows: chunkCounts, errorMessage: chunkCountErr } = await selectAll<KbChunkCountRow>(
    (from, to) =>
      admin
        .from('kb_chunks')
        .select('document_id')
        .order('id', { ascending: true })
        .range(from, to),
  );
  if (chunkCountErr) {
    console.error('[ai-kb-ingest] kb_chunks read failed:', chunkCountErr);
    return json({ error: 'Could not read KB chunks' }, 500);
  }
  const chunkedDocIds = new Set(chunkCounts.map((r) => r.document_id));

  const docsToChunk = unchunked.filter((d) => !chunkedDocIds.has(d.id));

  for (const doc of docsToChunk) {
    const pieces = chunkText(doc.content ?? '');
    const rows = pieces.map((text, i) => ({
      document_id: doc.id,
      chunk_index: i,
      chunk_text: text,
    }));
    if (rows.length === 0) continue;
    // Upsert on (document_id, chunk_index) — unique per 0024 — so a concurrent
    // run (double-tap, curl retry while the first is still embedding) can't
    // insert a second full set of duplicate chunks.
    const { error: insertErr } = await admin
      .from('kb_chunks')
      .upsert(rows, { onConflict: 'document_id,chunk_index', ignoreDuplicates: true });
    if (insertErr) {
      console.error('[ai-kb-ingest] kb_chunks insert failed:', insertErr.message);
      return json({ error: 'Could not insert KB chunks' }, 500);
    }
  }

  // ── 2. Find chunks without an embedding and embed them ───────────────────
  // An "embedded" chunk has a row in `embeddings` with owner_type='kb',
  // owner_id=chunk_id, kind='kb_chunk'. We batch-embed in groups so one Voyage
  // call covers many chunks (cheaper, fewer round-trips).
  const { rows: allChunks, errorMessage: allChunksErr } = await selectAll<KbChunkRow>((from, to) =>
    admin
      .from('kb_chunks')
      .select('id, chunk_text')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (allChunksErr) {
    console.error('[ai-kb-ingest] kb_chunks read failed:', allChunksErr);
    return json({ error: 'Could not read KB chunks' }, 500);
  }

  // Pull the set of chunk ids that already have an embedding.
  const { rows: existingEmbeddings, errorMessage: embErr } = await selectAll<EmbeddingRow>(
    (from, to) =>
      admin
        .from('embeddings')
        .select('owner_id')
        .eq('owner_type', KB_OWNER)
        .eq('kind', KB_KIND)
        .order('owner_id', { ascending: true })
        .range(from, to),
  );
  if (embErr) {
    console.error('[ai-kb-ingest] embeddings read failed:', embErr);
    return json({ error: 'Could not read embeddings' }, 500);
  }
  const embeddedIds = new Set(existingEmbeddings.map((r) => r.owner_id));

  const chunksToEmbed = allChunks.filter((c) => !embeddedIds.has(c.id));

  const BATCH = 16;
  for (let i = 0; i < chunksToEmbed.length; i += BATCH) {
    const batch = chunksToEmbed.slice(i, i + BATCH);
    const texts = batch.map((c: KbChunkRow) => c.chunk_text ?? '');
    let embeddings: number[][];
    let usage: { total_tokens: number };
    try {
      const result = await embedTexts(texts, 'document');
      embeddings = result.embeddings;
      usage = result.usage;
    } catch (e) {
      console.error('[ai-kb-ingest] voyage call failed:', e instanceof Error ? e.message : e);
      await logUsage(); // earlier batches were already paid for
      return json({ error: 'Embedding failed.' }, 502);
    }
    voyageTokens += usage.total_tokens ?? 0;

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const vec = embeddings[j];
      if (!Array.isArray(vec) || vec.length !== 1024) {
        console.error(
          `[ai-kb-ingest] expected 1024-dim, got ${Array.isArray(vec) ? vec.length : 'non-array'}`,
        );
        await logUsage(); // the batch was already paid for
        return json({ error: 'Embedding had unexpected dimensionality.' }, 500);
      }
      const { error: storeErr } = await admin.rpc('store_embedding', {
        p_owner_type: KB_OWNER,
        p_owner_id: chunk.id,
        p_kind: KB_KIND,
        p_embedding: vec,
      });
      if (storeErr) {
        console.error('[ai-kb-ingest] store_embedding failed:', storeErr.message);
        await logUsage(); // embeddings up to here were already paid for
        return json({ error: 'Could not store embedding' }, 500);
      }
      embedded += 1;
    }
  }

  // Record the run in the usage ledger (best-effort — never fail the response).
  // Cost is Voyage-only for this function (no Claude leg).
  await logUsage();

  return json({ ingested: embedded });
});

// ---------------------------------------------------------------------------
// chunkText — split a document into paragraph-ish ~target-char windows.
//   * Split on blank lines (paragraphs).
//   * Accumulate paragraphs into a chunk until adding the next would exceed
//     target, then start a new chunk.
//   * A single paragraph longer than target is hard-split on word boundaries
//     so a giant paragraph does not become one giant embedding.
// Returns non-empty trimmed chunks in document order.
// ---------------------------------------------------------------------------
function chunkText(content: string, target = CHUNK_TARGET): string[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const c = current.trim();
    if (c) chunks.push(c);
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > target) {
      flush();
      // Hard-split a paragraph longer than `target` on word boundaries so we
      // never lose chars between slices (a naive `i += target` after a
      // word-boundary shortening would skip the gap to the next word).
      let i = 0;
      while (i < para.length) {
        let end = Math.min(i + target, para.length);
        if (end < para.length) {
          // Try to break on a word boundary in the last half of the slice.
          const lastSpace = para.lastIndexOf(' ', end - 1);
          if (lastSpace > i + target * 0.5) end = lastSpace;
        }
        const c = para.slice(i, end).trim();
        if (c) chunks.push(c);
        i = end;
      }
      continue;
    }
    if (current && `${current} ${para}`.length > target) flush();
    current = current ? `${current} ${para}` : para;
  }
  flush();
  return chunks;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
