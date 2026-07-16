-- ============================================================================
-- Guardians — 0024_rag_kb
-- AI-M5 #7 — Rescue copilot knowledge base. A small, founder-curated set of
-- vetted TNR/rescue reference cards (humane trapping, safe transport,
-- approaching a fearful/injured cat, when to involve professional help) that
-- the `ai-rescue-copilot` Edge Function retrieves from with pgvector before
-- it answers a Guardian's question. Strictly RAG-grounded: when retrieval
-- similarity is low (the `ai-rescue-copilot` threshold), the copilot says so
-- and defers to a vet / animal services — it NEVER fills a KB gap with the
-- model's general training (ai-rag-agent charter, single most important
-- constraint). The KB is intentionally tiny and human-vetted so the safety
-- story is "every answer is grounded in something we read and approved",
-- not "the model happened to be right".
--
-- Schema:
--   kb_documents  — the curated reference cards (title, source, content). RLS
--                   readable by `authenticated`; written only by a moderator
--                   via the `ai-kb-ingest` Edge Function (service role).
--   kb_chunks     — paragraph-ish windows of each document, embedded into the
--                   shared `embeddings` table (0019) with owner_type='kb',
--                   owner_id=chunk_id, kind='kb_chunk' (written by the
--                   service-role-only `store_embedding` RPC, 0021). RLS
--                   readable by `authenticated`.
--
-- Seed: four founder-vetted reference cards are INSERTed below so the KB is
-- populated at migration time. The `ai-kb-ingest` Edge Function chunks the
-- documents (paragraph / ~800-char windows) and embeds each chunk — the
-- migration itself stores no embeddings (the Voyage API key lives only in
-- the edge runtime, AI_ROADMAP principle 1).
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors. Follows the 0014/0016/0019/0020/0021
-- convention: pinned search_path, revoke public/anon, grant only to the role
-- that must call it (`match_kb_chunks` is granted to `authenticated` because
-- the rescue-copilot edge function calls it with the caller's anon-key client
-- so `auth.uid()` attributes the retrieval to the user — exactly like
-- `log_ai_usage` / `check_ai_rate_limit` in 0019).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- kb_documents — the curated reference cards. RLS readable by authenticated
-- (any signed-in guardian / reporter may retrieve cards directly); writes go
-- through the service-role `ai-kb-ingest` Edge Function, which is itself
-- is_moderator()-gated. No client INSERT/UPDATE/DELETE policy — a client can
-- never edit the KB.
-- ---------------------------------------------------------------------------
create table if not exists public.kb_documents (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  source     text not null,
  content    text not null,
  created_at timestamptz not null default now()
);

alter table public.kb_documents enable row level security;

drop policy if exists "kb_documents are viewable by authenticated" on public.kb_documents;
create policy "kb_documents are viewable by authenticated"
  on public.kb_documents for select to authenticated using (true);

revoke select on public.kb_documents from anon;
grant  select on public.kb_documents to authenticated;

-- ---------------------------------------------------------------------------
-- kb_chunks — paragraph-ish windows of each document. Each chunk's embedding
-- lives in `embeddings` (0019) with owner_type='kb', owner_id=chunk_id,
-- kind='kb_chunk' (written by `store_embedding`, 0021, service_role-only). RLS
-- readable by authenticated; chunks are created by the `ai-kb-ingest` Edge
-- Function (service role), never by a client.
-- ---------------------------------------------------------------------------
create table if not exists public.kb_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents (id) on delete cascade,
  chunk_index int  not null,
  chunk_text  text not null,
  created_at  timestamptz not null default now()
);

-- UNIQUE: (document_id, chunk_index) identifies a chunk. ai-kb-ingest upserts
-- against this, so two concurrent ingest runs (double-tap / retry while the
-- first is still embedding) can't insert a second full set of duplicate chunks
-- — duplicates would each get embedded and crowd match_kb_chunks' top-k with
-- the same text.
drop index if exists public.kb_chunks_document_idx; -- pre-unique name, in case a dev DB already ran this file
create unique index if not exists kb_chunks_document_uniq
  on public.kb_chunks (document_id, chunk_index);

alter table public.kb_chunks enable row level security;

drop policy if exists "kb_chunks are viewable by authenticated" on public.kb_chunks;
create policy "kb_chunks are viewable by authenticated"
  on public.kb_chunks for select to authenticated using (true);

revoke select on public.kb_chunks from anon;
grant  select on public.kb_chunks to authenticated;

-- ---------------------------------------------------------------------------
-- match_kb_chunks — the retrieval RPC the rescue-copilot Edge Function calls
-- with the caller's anon-key client (so auth.uid() is the Guardian). Returns
-- the top p_limit chunks joined to their documents and embeddings, ordered
-- by cosine distance (<=>) to the query embedding — smallest distance first.
-- SECURITY DEFINER so it can read the no-client-policy `embeddings` table
-- (0019); granted to `authenticated` (NOT service_role-only) so the edge
-- function can call it through the caller's JWT. A non-authenticated caller
-- is rejected in the body, mirroring `match_embeddings` (0019).
-- ---------------------------------------------------------------------------
create or replace function public.match_kb_chunks(
  p_query vector(1024),
  p_limit int default 6
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  title       text,
  source      text,
  chunk_text  text,
  distance    double precision
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_query is null then raise exception 'Query embedding required'; end if;

  return query
  select
    c.id,
    c.document_id,
    d.title,
    d.source,
    c.chunk_text,
    (e.embedding <=> p_query)::double precision as distance
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  join public.embeddings   e on e.owner_type = 'kb'
                            and e.owner_id   = c.id
                            and e.kind       = 'kb_chunk'
  where e.embedding is not null
  order by e.embedding <=> p_query
  limit greatest(1, least(coalesce(p_limit, 6), 20));
end;
$$;

revoke execute on function public.match_kb_chunks(vector, int) from public, anon;
grant  execute on function public.match_kb_chunks(vector, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: four founder-vetted reference cards. Content is factual, short, and
-- cited (Alley Cat Allies TNR guide / ASPCA / HSUS). No medical instructions
-- beyond first-response + "contact a vet" — the rescue copilot never
-- diagnoses or suggests treatment (ai-rag-agent charter).
-- Fixed UUIDs make the seed deterministic and let tests / re-runs be
-- idempotent (`on conflict do nothing`).
-- ---------------------------------------------------------------------------
insert into public.kb_documents (id, title, source, content) values
  (
    'a0000000-0000-4000-8000-000000000001',
    'Humane trapping basics',
    'Alley Cat Allies TNR guide',
    $doc_a$Place the trap on flat, level ground where the cat is already comfortable feeding — against a wall, hedge, or under a bush works well, away from busy roads and off hot pavement. Line the bottom with newspaper so the cat steps onto a surface that does not clatter. Avoid open lawns where the cat feels exposed.

Bait with a strong-smelling food the cat cannot resist: tuna in oil, sardines, or warm chicken baby food placed at the very back of the trap, past the trip plate. Smear a thin trail of bait from the entrance to the back so the cat walks fully in. Pre-feed the same spot for a few days with the trap unset so the cat learns to enter safely.

Set the trap at the cat's usual feeding time and never leave it unattended once set. Check it every 15 to 30 minutes from a distance; a trapped cat can injure itself trying to escape, and a trap left out can be stolen or disturb a neighbor. As soon as the cat is caught, cover the entire trap with a light towel or sheet — darkness calms the cat.

Do not trap in heavy rain, extreme heat, or freezing cold. If the cat has kittens, locate them before trapping and never separate a nursing mother from her kittens — get guidance from a TNR group first.$doc_a$
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'Safe transport of a trapped cat',
    'ASPCA',
    $doc_b$Once trapped, keep the cat in the covered trap for transport — do not transfer to a carrier in the field. Keep the cover on the trap the entire trip; the darkness keeps the cat calm and stops the lunging that breaks teeth against the wire. A covered trap is a calm trap.

Keep the car quiet: no radio, no phone calls, windows up. Drive smoothly. Avoid strong air fresheners or exhaust in the cargo area. Place the trap on a flat surface where it will not slide — the floor behind the front seats or a rubber-backed mat in the back — and wedge it so it cannot tip if you brake.

Keep the temperature moderate: never leave a trapped cat in a parked car, even with windows cracked. In hot weather, run the air conditioning; in cold, run the heater modestly. Cats cannot regulate in a metal trap the way they can in an open room.

Transport to the vet, shelter, or holding area directly. The cat should not be in the trap longer than a few hours. If the trip is long, ask a vet or shelter staff about safe water access — never open the trap to add food or water in transit.$doc_b$
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'Approaching a fearful or injured cat',
    'HSUS',
    $doc_c$Approach slowly and from the side if you can — never head-on, and never tower over the cat. Stop a few feet away and crouch to make yourself small. Avoid direct eye contact; blink slowly and turn your head slightly away, which a cat reads as non-threatening. Sudden movement or a loud voice can send a fearful cat bolting or push an injured one to bite.

Let the cat decide whether to come closer. Offer the back of a closed hand to sniff if the cat does approach; never reach over the top of the head. For a fearful cat you intend to contain, use a towel or blanket: drape it over the cat calmly, gather the corners, and lift the whole bundle into the carrier. A towel turns a frightened cat into a contained one without a scruff or a chase.

Back off the moment the cat shows escalation: ears flat, growling, hissing, swatting, or any attempt to lunge. Aggression beyond fear is a signal to stop and call for help, not to push through. An injured cat is a frightened cat — do not attempt to pick one up bare-handed if it is warning you.

If you cannot safely contain the cat, do not. Stand at a distance, keep other people and pets away, and call a local animal services team or a TNR group. A cat that bolts is not lost; it is likely hiding close by and can be re-approached later with a trap.$doc_c$
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    'When to involve a vet or animal services',
    'ASPCA / Alley Cat Allies',
    $doc_d$Stop and call a vet or local animal services rather than DIY a rescue when you see any of the following: visible blood, an open wound, or a limb the cat will not put weight on; severe lethargy (the cat does not move away when approached and does not react to a gentle sound); a cat that is panting, drooling, or having seizures; or any aggression that goes beyond fear (the cat actively lunges, bites, or will not back down when you give it space).

For a cat that is visibly injured but stable, the safest path is to trap and transport to a vet — not to attempt field treatment. The rescue copilot does not give medical instructions. Clean a minor wound or bandage a limb only under a vet's guidance.

Suspected poisoning, a cat hit by a car, or a cat that has been trapped in heat without water for hours is an emergency — contact a vet or animal services immediately and describe what you saw. If you can do so safely, contain the cat in a covered trap or carrier and transport it; if not, stay nearby and direct responders.

When in doubt, call. A quick call to a vet, an animal shelter, or a local TNR organization is free and is the right call whenever a cat's condition is more than a routine contained rescue.$doc_d$
  )
on conflict (id) do nothing;
