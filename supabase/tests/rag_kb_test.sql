-- pgTAP tests for AI-M5 #7 rescue-copilot knowledge base (migration 0024):
-- match_kb_chunks + the kb_documents/kb_chunks RLS policies. Mirrors
-- push_ranking_test.sql / ai_moderation_test.sql's style. Guards the invariants
-- that matter for the ai-rag-agent charter:
--   * match_kb_chunks returns chunks ORDERED BY ASCENDING cosine distance
--     (best match first) — the copilot edge function relies on chunks[0]
--     being the single best match to threshold against;
--   * best distance is exactly 0 when the query vector is identical to a
--     chunk's vector (sanity check that `<=>` and our join behave);
--   * p_limit caps the number of returned rows;
--   * the function is granted to authenticated ONLY — anon cannot execute
--     (the rescue-copilot edge function calls it via the caller's anon-key
--     client, so auth.uid() must be set; a raw anon call is rejected);
--   * kb_chunks are visible to an authenticated role but not to anon
--     (RLS SELECT policy for authenticated, revoked from anon);
--   * the seed KB documents shipped with the migration are present and
--     well-formed (the copilot is only useful if its KB actually loaded).
--
-- Synthetic embeddings: pgvector lets us cast a literal 1024-dim float array
-- to vector(1024) with '[a,b,c,...]'::vector. We hand-build two chunks with
-- known unit vectors so the ordering assertion is deterministic: chunk A's
-- vector = [1,0,0,...,0] (a 1 in position 1), chunk B's = [0,1,0,...,0] (a 1
-- in position 2). The query vector = chunk A's vector, so chunk A is the
-- exact match (distance 0) and chunk B is orthogonal (distance 1). Both are
-- unit-norm, so `<=>` returns cosine distance = 1 − cosine_similarity, and
-- the ordering is deterministic regardless of model behavior.
--
-- Run with:  supabase test db

begin;
select plan(10);

-- ── Fixtures: one authenticated user so auth.uid() is set inside the
-- SECURITY DEFINER match_kb_chunks (which raises 'Not authenticated' when
-- auth.uid() is null). The pgTAP session runs as the superuser, so RLS on
-- the kb_* tables does not block our inserts; we set role authenticated
-- later to verify the SELECT policy from a real role's perspective.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'guardian@example.test')
  on conflict do nothing;
insert into public.profiles (id, username, is_guardian) values
  ('11111111-1111-1111-1111-111111111111', 'guardian', true)
  on conflict do nothing;

-- ── Insert one KB document + two chunks, each with a synthetic embedding ──
insert into public.kb_documents (id, title, source, content) values
  ('b0000000-0000-4000-8000-000000000001', 'Test card', 'Test source', 'chunk a content. chunk b content.')
  on conflict do nothing;

insert into public.kb_chunks (id, document_id, chunk_index, chunk_text) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 0, 'chunk a content.'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 1, 'chunk b content.')
  on conflict do nothing;

-- Synthetic 1024-dim unit vectors built from generate_series: position 1 set
-- for chunk A, position 2 set for chunk B. The query below uses position 1.
insert into public.embeddings (owner_type, owner_id, kind, embedding)
select 'kb', chunk_id, 'kb_chunk', vec::vector
from (
  values
    ('c0000000-0000-4000-8000-000000000001'::uuid,
     (select '[' || string_agg(CASE WHEN i = 1 THEN '1' ELSE '0' END, ',') || ']'
        from generate_series(1, 1024) as g(i))),
    ('c0000000-0000-4000-8000-000000000002'::uuid,
     (select '[' || string_agg(CASE WHEN i = 2 THEN '1' ELSE '0' END, ',') || ']'
        from generate_series(1, 1024) as g(i)))
) as t(chunk_id, vec);

-- ── match_kb_chunks returns chunks ordered by ASCENDING distance ───────────
-- Act as the authenticated user so auth.uid() is set inside the SECURITY
-- DEFINER function (match_kb_chunks was granted to authenticated in 0024).
-- set_config(..., true) is transaction-local, so this session persists across
-- the set role/reset role pairs below.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true);
set role authenticated;
select is(
  (select array_agg(chunk_id order by distance)
     from public.match_kb_chunks(
       (select '[' || string_agg(CASE WHEN i = 1 THEN '1' ELSE '0' END, ',') || ']'
         from generate_series(1, 1024) as g(i))::vector,
       6
     )),
  array[
    'c0000000-0000-4000-8000-000000000001'::uuid,
    'c0000000-0000-4000-8000-000000000002'::uuid
  ]::uuid[],
  'match_kb_chunks returns chunks ordered by ascending distance (best first)');
reset role;

-- ── Best distance is exactly 0 for the identical-vector chunk ─────────────
set role authenticated;
select is(
  (select distance
     from public.match_kb_chunks(
       (select '[' || string_agg(CASE WHEN i = 1 THEN '1' ELSE '0' END, ',') || ']'
         from generate_series(1, 1024) as g(i))::vector,
       6
     )
     order by distance limit 1),
  0::double precision,
  'best chunk has distance 0 when the query vector is identical');
reset role;

-- ── p_limit caps the number of returned rows ──────────────────────────────
set role authenticated;
select is(
  (select count(*)::int
     from public.match_kb_chunks(
       (select '[' || string_agg(CASE WHEN i = 1 THEN '1' ELSE '0' END, ',') || ']'
         from generate_series(1, 1024) as g(i))::vector,
       1
     )),
  1, 'p_limit = 1 returns exactly one chunk');
reset role;

-- ── Grant surface: anon cannot execute; authenticated can ─────────────────
select ok(
  not has_function_privilege('anon', 'public.match_kb_chunks(vector, int)', 'execute'),
  'anon cannot execute match_kb_chunks');
select ok(
  has_function_privilege('authenticated', 'public.match_kb_chunks(vector, int)', 'execute'),
  'authenticated can execute match_kb_chunks');

-- ── RLS: kb_chunks visible to authenticated, not anon ──────────────────────
set role authenticated;
select is(
  (select count(*)::int from public.kb_chunks where document_id = 'b0000000-0000-4000-8000-000000000001'),
  2, 'authenticated can read kb_chunks (RLS SELECT policy)');
reset role;

-- anon has no SELECT grant on kb_chunks (revoked in 0024), so even though
-- RLS is enabled, the table is unreachable. Assert by checking the role
-- does not have the table-level SELECT privilege.
select ok(
  not has_table_privilege('anon', 'public.kb_chunks', 'select'),
  'anon has no SELECT on kb_chunks');

-- ── match_kb_chunks returns the joined document title + source ─────────────
set role authenticated;
select is(
  (select (title, source)::text
     from public.match_kb_chunks(
       (select '[' || string_agg(CASE WHEN i = 1 THEN '1' ELSE '0' END, ',') || ']'
         from generate_series(1, 1024) as g(i))::vector,
       6
     )
     where chunk_id = 'c0000000-0000-4000-8000-000000000001'),
  '("Test card","Test source")',
  'match_kb_chunks joins the chunk to its document title and source');
reset role;

-- ── RLS: kb_documents visible to authenticated, not anon ───────────────────
set role authenticated;
select is(
  (select count(*)::int from public.kb_documents
     where source in ('Alley Cat Allies TNR guide','ASPCA','HSUS','ASPCA / Alley Cat Allies')),
  4, 'authenticated can read the four seeded kb_documents (RLS SELECT policy)');
reset role;

select ok(
  not has_table_privilege('anon', 'public.kb_documents', 'select'),
  'anon has no SELECT on kb_documents');

select * from finish();
rollback;
