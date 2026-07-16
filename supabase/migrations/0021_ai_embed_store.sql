-- ============================================================================
-- Guardians — 0021_ai_embed_store
-- Write/read RPCs for the embeddings table (0019) so the AI-M3 / AI-M4 / AI-M5
-- feature edge functions can store a freshly-computed 1024-dim vector past the
-- no-client-policy RLS on `embeddings`, and read one back without doing a
-- nearest-neighbour search. The ai-embed edge function (companion to this
-- migration) computes and RETURNS the vector to its caller; the caller — a
-- feature-specific edge function — verifies ownership of the target and then
-- calls store_embedding with a service-role client. Ownership is enforced in
-- the feature (sighting reporter, lost-cat post owner, KB writer role…), NOT
-- here: this RPC is intentionally agnostic about what (owner_type, owner_id,
-- kind) means so one pipe serves re-ID, reunification, and RAG.
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors. Follows the 0014/0016/0019/0020 convention:
-- pinned search_path, revoke public/anon/authenticated, grant only to the role
-- that must call it (service_role — exactly like ai_moderate_content in 0020).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Unique upsert target: one embedding per (owner_type, owner_id, kind). A
-- sighting can have both a `sighting_photo` embedding and (later) a
-- `sighting_text` embedding — those are different `kind` values, so the unique
-- index lets them coexist while making a re-embed of the same kind overwrite
-- in place (the `on conflict` below relies on this). IF NOT EXISTS keeps the
-- migration idempotent if 0019 already created it.
-- ---------------------------------------------------------------------------
create unique index if not exists embeddings_owner_kind_uniq
  on public.embeddings (owner_type, owner_id, kind);

-- ---------------------------------------------------------------------------
-- store_embedding — upsert one 1024-dim vector for (owner_type, owner_id, kind).
-- Called ONLY by edge functions using the service-role key (which maps to the
-- `service_role` DB role); not reachable by anon or authenticated clients.
-- SECURITY DEFINER so it can write past the no-policy RLS on `embeddings`
-- (migration 0019). The caller is responsible for ownership verification
-- BEFORE calling this — see the migration header.
-- ---------------------------------------------------------------------------
create or replace function public.store_embedding(
  p_owner_type text,
  p_owner_id   uuid,
  p_kind       text,
  p_embedding  vector(1024)
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_owner_type is null or p_owner_id is null or p_kind is null then
    raise exception 'owner_type, owner_id and kind are required';
  end if;
  if p_embedding is null then
    raise exception 'embedding is required';
  end if;

  insert into public.embeddings (owner_type, owner_id, kind, embedding)
  values (p_owner_type, p_owner_id, p_kind, p_embedding)
  on conflict (owner_type, owner_id, kind) do update
    set embedding   = excluded.embedding,
        created_at  = now();
end;
$$;

-- Privileged: only the edge functions (service_role) may call this. Revoke
-- from every client role — a client must never bypass the no-policy RLS on
-- embeddings, and ownership is enforced in each feature's edge function.
revoke execute on function public.store_embedding(text, uuid, text, vector) from public, anon, authenticated;
grant  execute on function public.store_embedding(text, uuid, text, vector) to service_role;

-- ---------------------------------------------------------------------------
-- get_embedding — read one 1024-dim vector back by (owner_type, owner_id, kind)
-- without a nearest-neighbour search. Handy for edge functions that need to
-- re-embed a target on update (read the old one to skip work if unchanged) or
-- to fetch a query vector before calling match_embeddings. SECURITY DEFINER so
-- it can read the no-policy embeddings table; service_role-only, exactly like
-- store_embedding. Returns NULL when no such row exists.
-- ---------------------------------------------------------------------------
create or replace function public.get_embedding(
  p_owner_type text,
  p_owner_id   uuid,
  p_kind       text
)
returns vector(1024)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_embedding vector(1024);
begin
  select e.embedding into v_embedding
  from public.embeddings e
  where e.owner_type = p_owner_type
    and e.owner_id   = p_owner_id
    and e.kind       = p_kind
  limit 1;

  return v_embedding;
end;
$$;

revoke execute on function public.get_embedding(text, uuid, text) from public, anon, authenticated;
grant  execute on function public.get_embedding(text, uuid, text) to service_role;
