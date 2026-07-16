-- ============================================================================
-- Guardians — 0022_push_ranking
-- AI-M5 #8 — smarter urgent-push targeting. A READ-ONLY ranking layer on top
-- of the recipient list the `send-push` Edge Function already builds via
-- `tokens_near` (0010). This is applied statistics / heuristics, not a model
-- call: a SQL function scores each opted-in recipient within the geo radius
-- using their rescue history (`profiles`) and responsiveness from
-- `analytics_events` (0018) — past claims and time-to-claim after an urgent
-- push — and returns them ordered by score.
--
-- THE ONE HARD RULE (ai-analytics-agent charter): this RANKS / REORDERS, it
-- NEVER EXCLUDES a recipient. The `geo` CTE below mirrors `tokens_near` exactly
-- — same opt-in flag, same null-location skip, same reporter exclusion, same
-- `least(p_radius_m, notify_radius_m)` radius — so the recipient set is always
-- identical to what `tokens_near` would return. A lower-scoring user still
-- receives the urgent alert; a cat's safety must never depend on a heuristic's
-- confidence in a particular human.
--
-- A/B shipped from day one: `p_variant = 'control'` returns the same set with
-- `score = null` and `rank = null` (unranked, geo order); `p_variant = 'ranked'`
-- returns non-null scores and ranks 1..N ordered by score desc. `send-push`
-- picks the variant via a deterministic per-sighting 50/50 split and logs one
-- `urgent_push_sent` analytics event per push so the PRD's <60-min urgent-alert-
-- to-claim latency can be compared between variants.
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors. Follows the 0014/0016/0019/0020/0021
-- convention: pinned search_path, revoke public/anon/authenticated, grant only
-- to service_role (the send-push Edge Function's service-role client), exactly
-- like `ai_moderate_content` (0020) and `store_embedding` (0021).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- rank_push_recipients — score + rank the recipient set for an urgent push.
--
--   p_sighting  the urgent sighting to push about (lat/lng/reporter come from it)
--   p_variant   'control' (default) → same set, score = null, rank = null
--               'ranked'             → same set, score computed, rank = 1..N
--               anything else        → treated as 'control' (a typo never
--                                      silently re-ranks recipients)
--
-- Returns (token, user_id, score, rank, is_guardian) for EVERY opted-in token
-- within the geo radius (minus the reporter) — never fewer than `tokens_near`.
-- Callable ONLY by the send-push Edge Function via its service-role client.
--
-- Ranking formula (deterministic, documented; higher score = more likely to
-- help, max = 1.0):
--
--   score = 0.40 * responsiveness_score
--         + 0.35 * rescue_history_score
--         + 0.25 * activity_score
--
--   responsiveness_score ∈ [0,1]: from `analytics_events` —
--     * claims_90d: 'sighting_claimed' events by this recipient in the last 90
--       days (recent claim activity), scaled 0.20 each.
--     * latency_bonus: average minutes from a past 'urgent_push_sent' event
--       to this recipient's 'sighting_claimed' on the same sighting — the
--       PRD's urgent-alert-to-claim latency. ≤15 min → 0.5, ≤30 → 0.35,
--       ≤60 → 0.20, else 0.05. Null (no correlated history yet) → 0. This
--       signal populates over time once send-push's `urgent_push_sent`
--       logging (this migration's companion edge-function change) is live.
--     Capped at 1.0.
--
--   rescue_history_score ∈ [0,1]: from `profiles` —
--     rescues_count * 0.08 + (is_guardian ? 0.20 : 0) + min(level,10) * 0.02.
--     Capped at 1.0.
--
--   activity_score ∈ {0, 0.1, 0.5, 1.0}: recency of the recipient's most recent
--     'sighting_claimed'/'rescue_completed' event — within 7 days → 1.0,
--     within 30 days → 0.5, else 0.1, null (no history) → 0.
--
-- Index awareness: the responsiveness CTEs filter `analytics_events` by event
-- first (served by `analytics_events_event_idx` on (event, created_at desc),
-- migration 0018) and bound to the last 90 days, then semi-join to the small
-- recipient set (within 8 km — a handful of rows), so the per-user aggregation
-- stays cheap as the table grows. No new index is added here; if a future
-- `get_advisors` run flags the plan, a `user_id` index on `analytics_events`
-- or a `props->>'sighting_id'` expression index is the right next step.
-- ---------------------------------------------------------------------------
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
  -- ── geo: the recipient set. Mirrors `tokens_near` (0010) EXACTLY — same
  -- opt-in flag, same null-location skip, same reporter exclusion, same
  -- least(p_radius_m, notify_radius_m) radius. If `tokens_near` changes, this
  -- filter MUST change to match; the hard contract is "same set, never fewer".
  -- We re-implement (rather than call `tokens_near`) so we have `user_id` in
  -- hand to join to `profiles` and `analytics_events` without a lossy token-
  -- only join back.
  geo as (
    select t.token, t.user_id
    from public.device_push_tokens t
    where t.urgent_opt_in
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
