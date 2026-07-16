-- ============================================================================
-- Guardians — 0020_ai_moderation
-- AI-M2 #9/#10 write path: the automated hide-and-enqueue action that the
-- ai-moderate-photo / ai-moderate-text edge functions perform after a Haiku
-- classification. It builds ON the existing moderation system (0012) — it writes
-- into the SAME abuse_reports queue and flips the SAME is_hidden columns; it does
-- NOT introduce a parallel moderation table or a separate "maybe" status.
--
-- THE ONE HARD RULE (ai-safety-agent charter): nothing here bans, deletes, or
-- suspends a user. A CONFIDENT content violation may auto-_hide_ (never delete)
-- and is ALWAYS enqueued for human review; a borderline verdict only enqueues.
-- The founder still makes every real decision from app/moderation.tsx.
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors. Follows the 0014/0016/0019 convention: pinned
-- search_path, revoke public/anon, grant only to the role that must call it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Let a report be attributed to "the system" rather than a human reporter. A
-- NULL reporter_id now means "flagged by AI moderation", distinct from every
-- community report (which always has a real reporter_id). The per-reporter
-- uniqueness constraint (reporter_id, target_type, target_id) still holds for
-- human reports; NULLs are never equal in a UNIQUE index, so the AI can add its
-- own flag alongside community reports without colliding — and de-duplication of
-- repeat AI flags is enforced by the partial unique index below.
-- ---------------------------------------------------------------------------
alter table public.abuse_reports alter column reporter_id drop not null;

-- One OPEN AI flag per target, enforced by the database. The edge functions
-- fire one screening call per photo, so concurrent ai_moderate_content calls
-- for the same target are the NORMAL case (a 3-photo sighting = 3 parallel
-- invocations) — a read-then-write dedupe in the RPC would race and enqueue
-- duplicates, inflating the queue's report counts. Resolved (actioned/
-- dismissed) AI flags are excluded so history can accumulate across incidents.
create unique index if not exists abuse_reports_ai_open_uniq
  on public.abuse_reports (target_type, target_id)
  where reporter_id is null and status in ('open', 'reviewing');

-- ---------------------------------------------------------------------------
-- ai_moderate_content — the privileged hide+enqueue action for AI moderation.
-- Called ONLY by the ai-moderate-photo / ai-moderate-text edge functions using
-- the service-role key (which maps to the `service_role` DB role); it is not
-- reachable by anon or authenticated clients. SECURITY DEFINER so it can write
-- the RLS-guarded abuse_reports table and the is_hidden columns.
--
--   p_verdict   'violation' (confident) → hide + enqueue
--               'borderline'            → enqueue only (never hide)
--               anything else           → no-op (caller should not call for 'ok')
--
-- Never deletes. Never touches profiles / bans / roles. On a violation it flips
-- is_hidden exactly like the community auto-hide in report_content() and the
-- moderator moderate_content() — the content is hidden pending the human's
-- review of the enqueued report, and the founder can restore it with one click.
-- ---------------------------------------------------------------------------
create or replace function public.ai_moderate_content(
  p_type       text,
  p_id         uuid,
  p_verdict    text,
  p_categories text[] default null,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_hide   boolean := (p_verdict = 'violation');
begin
  if p_type not in ('sighting', 'comment') then
    raise exception 'Unsupported target type';
  end if;
  if p_id is null then raise exception 'Target required'; end if;
  if p_verdict not in ('violation', 'borderline') then
    -- 'ok' (or anything unexpected) is a no-op: the AI found nothing to enqueue.
    return;
  end if;

  -- Compose a queue-visible reason so the founder sees, at a glance, that this
  -- was an AI flag and why. Kept short and prefixed for easy filtering.
  v_reason := left(
    '[AI:' || p_verdict || '] '
      || coalesce(nullif(trim(p_reason), ''), 'flagged by automated moderation')
      || case
           when p_categories is not null and array_length(p_categories, 1) > 0
             then ' (' || array_to_string(p_categories, ', ') || ')'
           else ''
         end,
    500
  );

  -- Enqueue an AI-attributed report (reporter_id NULL = system). The partial
  -- unique index (abuse_reports_ai_open_uniq) arbitrates concurrent calls, so
  -- a repeat AI flag refreshes the existing open row instead of piling up
  -- duplicates — race-safe, unlike a read-then-write dedupe.
  insert into public.abuse_reports (reporter_id, target_type, target_id, reason)
  values (null, p_type, p_id, v_reason)
  on conflict (target_type, target_id)
    where reporter_id is null and status in ('open', 'reviewing')
  do update set reason = excluded.reason, created_at = now();

  -- Confident violation → auto-HIDE (never delete) pending human review.
  if v_hide then
    if p_type = 'sighting' then
      update public.sightings set is_hidden = true where id = p_id;
    elsif p_type = 'comment' then
      update public.sighting_updates set is_hidden = true where id = p_id;
    end if;
  end if;
end;
$$;

-- Privileged: only the edge functions (service_role) may call this. Revoke from
-- every client role — a human's takedown path stays moderate_content() (0012),
-- which is is_moderator()-gated.
revoke execute on function public.ai_moderate_content(text, uuid, text, text[], text) from public, anon, authenticated;
grant  execute on function public.ai_moderate_content(text, uuid, text, text[], text) to service_role;

-- ---------------------------------------------------------------------------
-- get_report_velocity_flags — AI-M2 #12 (scoped): the cheap behavioural
-- points-farming heuristic. No model, no embeddings — pure SQL: surface users
-- who created an abnormal number of sightings in a short window (the
-- points-farming pattern, since reporting sightings earns points) as a REVIEW
-- FLAG in the moderator's queue screen.
--
-- Charter guarantees (ai-safety-agent):
--   * READ-ONLY — this flags for review; it never blocks report creation,
--     never hides, never bans. A false positive must never stop a real cat
--     from getting help.
--   * is_moderator()-gated in the body (grant to authenticated, exactly like
--     moderate_content in 0012 per the 0016 convention), so regular users
--     cannot enumerate other users' posting rates.
--
-- DEFERRED (depends on AI-M3 embeddings — do NOT bolt on here): the
-- image-similarity-to-stock-photo fraud check. Once the `embeddings` table
-- (0019) is populated by the ai-embeddings pipeline, a companion check can
-- flag reporters whose photos sit unusually close to known stock/duplicate
-- images via match_embeddings(). Until then velocity is the only signal.
-- ---------------------------------------------------------------------------
create or replace function public.get_report_velocity_flags(
  p_window_minutes int default 60,
  p_threshold      int default 5,
  p_limit          int default 20
)
returns table (
  user_id        uuid,
  username       text,
  sighting_count bigint,
  window_start   timestamptz,
  latest_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Clamp inputs: window 5 min – 24 h, threshold at least 2, limit 1–100.
  v_window    interval := make_interval(mins => greatest(5, least(coalesce(p_window_minutes, 60), 1440)));
  v_threshold int      := greatest(2, coalesce(p_threshold, 5));
begin
  if not public.is_moderator() then raise exception 'Moderators only'; end if;

  return query
  select
    s.reporter_id,
    p.username,
    count(*)::bigint,
    min(s.created_at),
    max(s.created_at)
  from public.sightings s
  join public.profiles p on p.id = s.reporter_id
  where s.created_at > now() - v_window
    and s.reporter_id is not null
  group by s.reporter_id, p.username
  having count(*) >= v_threshold
  order by count(*) desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

-- Same grant pattern as moderate_content (0012) / the 0016 role-helper lockdown:
-- callable only by signed-in clients, and the body enforces is_moderator().
revoke execute on function public.get_report_velocity_flags(int, int, int) from public, anon;
grant  execute on function public.get_report_velocity_flags(int, int, int) to authenticated;
