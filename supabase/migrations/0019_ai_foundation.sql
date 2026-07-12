-- ============================================================================
-- Guardians — 0019_ai_foundation
-- AI-M0 shared plumbing every later AI milestone reuses: pgvector, an RPC-only
-- embeddings store, AI cost/latency accounting, and rate limiting on AI work.
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors. Every function pins search_path and follows
-- the 0014/0016 revoke-anon / grant-authenticated pattern so the advisors stay
-- clean; the two data tables get RLS with NO client policy (RPC-only access,
-- exactly like analytics_events (0018) and device_push_tokens).
-- ============================================================================

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Embeddings store. Written and read ONLY through SECURITY DEFINER RPCs; there
-- is deliberately no client RLS policy, so raw `.from('embeddings')` calls see
-- nothing. `owner_type`/`owner_id` is a polymorphic pointer (e.g. 'sighting',
-- 'lost_cat') so one table serves re-ID (AI-M3), reunification (AI-M4), etc.
-- 1024-dim vectors match the intended embedding model's output width.
-- ---------------------------------------------------------------------------
create table if not exists public.embeddings (
  id         uuid primary key default gen_random_uuid(),
  owner_type text not null,
  owner_id   uuid not null,
  kind       text not null,
  embedding  vector(1024),
  created_at timestamptz not null default now()
);
create index if not exists embeddings_owner_idx
  on public.embeddings (owner_type, owner_id);

alter table public.embeddings enable row level security;
-- No client policy: embeddings are written/read only via the RPCs below.

-- ---------------------------------------------------------------------------
-- AI usage ledger. One row per model call: which feature, which model, token
-- counts, an estimated USD cost, and end-to-end latency. This is what lets the
-- founder answer "is this feature worth what it costs" (AI_ROADMAP: cost tracked
-- from day one). RLS on, no client policy — written only via log_ai_usage().
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete set null,
  feature       text,
  model         text,
  input_tokens  int,
  output_tokens int,
  est_cost_usd  numeric,
  latency_ms    int,
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_feature_idx
  on public.ai_usage (feature, created_at desc);

alter table public.ai_usage enable row level security;
-- No client policy: usage rows are written only via the RPC.

-- ---------------------------------------------------------------------------
-- log_ai_usage — record one AI call for the current user. Called by ai-* edge
-- functions (which run with the caller's JWT, so auth.uid() is the caller).
-- SECURITY DEFINER so it can insert past the no-policy RLS.
-- ---------------------------------------------------------------------------
create or replace function public.log_ai_usage(
  p_feature text,
  p_model   text,
  p_input   int,
  p_output  int,
  p_cost    numeric,
  p_latency int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.ai_usage
    (user_id, feature, model, input_tokens, output_tokens, est_cost_usd, latency_ms)
  values
    (auth.uid(), left(p_feature, 80), left(p_model, 80), p_input, p_output, p_cost, p_latency);
end;
$$;

revoke execute on function public.log_ai_usage(text, text, int, int, numeric, int) from public, anon;
grant  execute on function public.log_ai_usage(text, text, int, int, numeric, int) to authenticated;

-- ---------------------------------------------------------------------------
-- match_embeddings — nearest-neighbour search by cosine distance (<=>), bounded
-- by p_limit and optionally excluding one owner (e.g. don't match a sighting to
-- itself). SECURITY DEFINER so it can read the no-policy embeddings table.
-- Stub-quality but valid: callers filter by kind and get the closest rows.
-- ---------------------------------------------------------------------------
create or replace function public.match_embeddings(
  p_kind          text,
  p_query         vector(1024),
  p_owner_exclude uuid default null,
  p_limit         int default 10
)
returns table (
  id         uuid,
  owner_type text,
  owner_id   uuid,
  kind       text,
  distance   double precision
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
    e.id,
    e.owner_type,
    e.owner_id,
    e.kind,
    (e.embedding <=> p_query)::double precision as distance
  from public.embeddings e
  where e.kind = p_kind
    and e.embedding is not null
    and (p_owner_exclude is null or e.owner_id <> p_owner_exclude)
  order by e.embedding <=> p_query
  limit greatest(1, least(coalesce(p_limit, 10), 100));
end;
$$;

revoke execute on function public.match_embeddings(text, vector, uuid, int) from public, anon;
grant  execute on function public.match_embeddings(text, vector, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- check_ai_rate_limit — per-user, per-feature hourly cap. Returns true while the
-- caller is UNDER the cap (safe to proceed), false once they hit it. Same spirit
-- as 0011's enforce_insert_rate_limit, but callable by the edge function before
-- it spends money on a model call. SECURITY DEFINER so it can count the
-- no-policy ai_usage rows.
-- ---------------------------------------------------------------------------
create or replace function public.check_ai_rate_limit(
  p_feature      text,
  p_max_per_hour int
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if auth.uid() is null then return false; end if;

  select count(*) into v_count
  from public.ai_usage
  where user_id = auth.uid()
    and feature = left(p_feature, 80)
    and created_at > now() - interval '1 hour';

  return v_count < greatest(1, p_max_per_hour);
end;
$$;

revoke execute on function public.check_ai_rate_limit(text, int) from public, anon;
grant  execute on function public.check_ai_rate_limit(text, int) to authenticated;
