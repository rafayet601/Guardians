-- 0037 — pay claim and rescue points once per cat, not once per transition.
--
-- NOT APPLIED to any hosted project by this file being here. It is independent
-- of the app (the client never computes these awards) and changes nothing else
-- about either function.
--
-- Why: both awards were unconditional, so they could be collected repeatedly
-- for the same cat:
--   * claim_sighting paid +15 on every claim, and a claimed cat can go back to
--     `spotted` (release) and be claimed again, so claim / release / claim
--     farmed 15 points a lap;
--   * update_sighting_status paid +50 and bumped rescues_count every time a cat
--     entered `safe`, and safe <-> available is a legal toggle, so
--     safe / available / safe farmed 50 points and a rescue count per lap.
-- Points feed the leaderboard, levels, badges and spendable Kibble, so this
-- let one person buy rewards with no rescues behind them.
--
-- Now each (person, cat, kind of award) pays out once. It is per person: a
-- second Guardian who takes over a released cat and finishes the rescue still
-- earns their own points, which is the behaviour releasing a claim exists to
-- allow. It does NOT try to decide whether a report is genuine, or whether
-- someone should earn claim/rescue points on their own report; that is a
-- product decision, not a bug.

create or replace function public.claim_sighting(p_sighting uuid)
returns public.sightings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  s public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting for update;
  if not found then raise exception 'Sighting not found'; end if;
  if s.status <> 'spotted' then
    raise exception 'This cat is no longer available to claim';
  end if;

  update public.sightings
  set status = 'claimed', claimed_by = uid, claimed_at = now()
  where id = p_sighting
  returning * into s;

  -- claiming a rescue makes you a guardian
  update public.profiles set is_guardian = true where id = uid and is_guardian = false;

  insert into public.sighting_updates (sighting_id, author_id, type, old_status, new_status, body)
  values (p_sighting, uid, 'claim', 'spotted', 'claimed', 'A guardian is on the way!');

  -- Once per person per cat: release + re-claim must not pay again.
  if not exists (
    select 1 from public.point_events pe
    where pe.user_id = uid and pe.sighting_id = p_sighting and pe.reason = 'Claimed a rescue'
  ) then
    perform public.award_points(uid, 15, 'Claimed a rescue', p_sighting);
  end if;
  return s;
end;
$$;

create or replace function public.update_sighting_status(
  p_sighting uuid, p_new_status cat_status, p_note text default null
)
returns public.sightings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  s public.sightings;
  v_old cat_status;
  v_claimed_by uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting for update;
  if not found then raise exception 'Sighting not found'; end if;

  if uid <> coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     and uid <> coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'Only the reporter or the assigned guardian can update this cat';
  end if;

  if p_new_status in ('claimed', 'adopted') then
    raise exception 'Use the dedicated action for that status';
  end if;

  if not public.is_valid_transition(s.status, p_new_status) then
    raise exception 'Cannot move from % to %', s.status, p_new_status;
  end if;

  -- capture pre-update values before RETURNING overwrites them
  v_old := s.status;
  v_claimed_by := s.claimed_by;

  update public.sightings
  set status = p_new_status,
      -- releasing a cat back to 'spotted' clears the previous guardian so
      -- they don't retain stale ownership/permissions
      claimed_by = case when p_new_status = 'spotted' then null else claimed_by end,
      claimed_at = case when p_new_status = 'spotted' then null else claimed_at end,
      rescued_at = case when p_new_status = 'safe' and rescued_at is null
                        then now() else rescued_at end
  where id = p_sighting
  returning * into s;

  insert into public.sighting_updates (sighting_id, author_id, type, old_status, new_status, body)
  values (p_sighting, uid, 'status_change', v_old, p_new_status, p_note);

  -- Rescue completed: reward the guardian who saw it through, once per cat.
  -- safe <-> available is a legal toggle, so without this check every lap paid
  -- again and bumped rescues_count.
  if p_new_status = 'safe' and v_claimed_by is not null
     and not exists (
       select 1 from public.point_events pe
       where pe.user_id = v_claimed_by
         and pe.sighting_id = p_sighting
         and pe.reason = 'Completed a rescue'
     ) then
    update public.profiles set rescues_count = rescues_count + 1 where id = v_claimed_by;
    perform public.award_points(v_claimed_by, 50, 'Completed a rescue', p_sighting);
  end if;

  return s;
end;
$$;
