-- ============================================================================
-- Guardians — 0030_push_ranking_respect_opt_out
--
-- Republishes `rank_push_recipients` (0022) with the `push_enabled` filter that
-- 0029 added to `tokens_near`, honoring 0022's own documented contract:
--
--   "Mirrors tokens_near (0010) EXACTLY ... If tokens_near changes, this
--    filter MUST change to match; the hard contract is 'same set, never fewer'."
--
-- 0029 added the `push_enabled` master push opt-out and taught `tokens_near`
-- to respect it. `rank_push_recipients` re-implements that filter in its `geo`
-- CTE (it needs `user_id` in hand to join `profiles`/`analytics_events`, which
-- a token-only call to `tokens_near` can't provide), so the two would have
-- drifted: ranking would have re-admitted users who turned notifications OFF.
--
-- NOT a production bug at the time of writing — `send-push`'s urgent fan-out
-- calls `tokens_near` directly and never calls `rank_push_recipients`, so the
-- ranked A/B variant is unshipped and the two recipient sets could not yet
-- diverge in production. This closes the gap BEFORE that variant is wired in.
--
-- DEPENDS ON 0029: the new filter references
-- `public.device_push_tokens.push_enabled`, which 0029 adds. Apply 0029 first.
-- (The reference sits inside a `return query` in a plpgsql body, so creating
-- this function against a database without the column would succeed and then
-- fail at call time — apply in order.)
--
-- The body below is carried over verbatim from 0022 with exactly one line added
-- (`and t.push_enabled` in the `geo` CTE) plus the comment above it updated.
-- Same signature, so `create or replace` preserves the existing service_role-
-- only ACL; the revoke/grant pair at the end is restated for clarity, matching
-- the 0020/0021/0029 convention.
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors.
-- ============================================================================

create or replace function public.rank_push_recipients(
  p_sighting uuid,
  p_variant  text default 'control'
)
returns table (
  token       text,
  user_id     uuid,
  score       double precision,
  rank        int,
  is_guardian boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lat      double precision;
  v_lng      double precision;
  v_reporter uuid;
  v_radius   integer := 8000;
  v_var      text := lower(coalesce(nullif(trim(p_variant), ''), 'control'));
begin
  -- Resolve the sighting (the edge function authorizes before calling, but
  -- raising here mirrors send-push's 404 path and makes the function safe to
  -- call in tests / via the SQL editor).
  select s.lat, s.lng, s.reporter_id
    into v_lat, v_lng, v_reporter
  from public.sightings s
  where s.id = p_sighting;
  if not found then raise exception 'Sighting not found'; end if;

  -- Clamp the variant: an unknown value degrades to 'control' so a typo never
  -- silently re-ranks recipients.
  if v_var not in ('control', 'ranked') then
    v_var := 'control';
  end if;

  return query
  with
  -- ── geo: the recipient set. Mirrors `tokens_near` (0010, filter updated in
  -- 0029) EXACTLY — same opt-in flag, same `push_enabled` master opt-out, same
  -- null-location skip, same reporter exclusion, same
  -- least(p_radius_m, notify_radius_m) radius. If `tokens_near` changes, this
  -- filter MUST change to match; the hard contract is "same set, never fewer".
  -- We re-implement (rather than call `tokens_near`) so we have `user_id` in
  -- hand to join to `profiles` and `analytics_events` without a lossy token-
  -- only join back.
  geo as (
    select t.token, t.user_id
    from public.device_push_tokens t
    where t.urgent_opt_in
      and t.push_enabled
      and t.last_known_location is not null
      and (v_reporter is null or t.user_id <> v_reporter)
      and st_dwithin(
        t.last_known_location,
        st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography,
        least(v_radius, t.notify_radius_m)
      )
  ),
  -- ── responsiveness (recent claims + last activity): per-recipient
  -- aggregation over `analytics_events`, bounded to recipients + last 90 days
  -- so the event_idx + time filter does the heavy lifting and the per-user
  -- aggregation only touches the small recipient set.
  resp as (
    select
      e.user_id,
      count(*) filter (where e.event = 'sighting_claimed') as claims_90d,
      max(e.created_at) as last_activity_at
    from public.analytics_events e
    where e.user_id is not null
      and e.event in ('sighting_claimed', 'rescue_completed')
      and e.created_at > now() - interval '90 days'
      and e.user_id in (select g.user_id from geo g)
    group by e.user_id
  ),
  -- ── urgent push → claim latency per recipient. Joins 'urgent_push_sent'
  -- events (logged by send-push, props->>'sighting_id') to this recipient's
  -- 'sighting_claimed' events (props->>'id') on the same sighting, bounded to
  -- claims within 24 h of the push. The gap is the PRD's urgent-alert-to-claim
  -- latency. Null for everyone until the `urgent_push_sent` logging has been
  -- live for a while — the formula degrades gracefully (latency_bonus = 0).
  lat as (
    select
      cl.user_id,
      avg(extract(epoch from (cl.created_at - pu.created_at)) / 60.0)::double precision
        as avg_urgent_claim_min
    from public.analytics_events pu
    join public.analytics_events cl
      on (cl.props->>'id') = (pu.props->>'sighting_id')
     and cl.created_at >= pu.created_at
     and cl.created_at < pu.created_at + interval '24 hours'
    where pu.event = 'urgent_push_sent'
      and pu.created_at > now() - interval '90 days'
      and pu.props ? 'sighting_id'
      and cl.event = 'sighting_claimed'
      and cl.user_id in (select g.user_id from geo g)
    group by cl.user_id
  ),
  scored as (
    select
      g.token,
      g.user_id,
      coalesce(p.is_guardian, false) as is_guardian,
      case
        when v_var = 'ranked' then
          (
            0.40 * least(
              1.0,
              coalesce(r.claims_90d, 0)::numeric * 0.20
              + case
                  when l.avg_urgent_claim_min is null then 0.0
                  when l.avg_urgent_claim_min <= 15 then 0.5
                  when l.avg_urgent_claim_min <= 30 then 0.35
                  when l.avg_urgent_claim_min <= 60 then 0.20
                  else 0.05
                end
            )
            + 0.35 * least(
                1.0,
                coalesce(p.rescues_count, 0)::numeric * 0.08
                + case when coalesce(p.is_guardian, false) then 0.20 else 0.0 end
                + least(coalesce(p.level, 1), 10)::numeric * 0.02
              )
            + 0.25 * case
                when r.last_activity_at is null then 0.0
                when r.last_activity_at > now() - interval '7 days'  then 1.0
                when r.last_activity_at > now() - interval '30 days' then 0.5
                else 0.1
              end
          )::double precision
        else null::double precision
      end as score
    from geo g
    left join public.profiles p on p.id = g.user_id
    left join resp r on r.user_id = g.user_id
    left join lat l on l.user_id = g.user_id
  )
  select
    s.token,
    s.user_id,
    s.score,
    case
      when v_var = 'ranked'
        then (row_number() over (order by s.score desc nulls last, s.token asc))::int
      else null::int
    end as rank,
    s.is_guardian
  from scored s
  order by
    case when v_var = 'ranked' then s.score end desc nulls last,
    s.token asc;
end;
$$;

-- Privileged: only the send-push Edge Function (service_role) may call this —
-- it reads `device_push_tokens` (never client-readable) and `analytics_events`
-- (no client policy). Revoke from every client role, exactly like
-- `ai_moderate_content` (0020) and `store_embedding` (0021).
revoke execute on function public.rank_push_recipients(uuid, text) from public, anon, authenticated;
grant  execute on function public.rank_push_recipients(uuid, text) to service_role;
