-- ============================================================================
-- Guardians — 0011_security_hardening
-- Fixes from the adversarial backend security audit. Defense-in-depth across
-- the realistic threat model. (False positive intentionally NOT "fixed": the
-- coalesce(uuid, '000…0') ownership checks in update_sighting_status /
-- express_adoption_interest are CORRECT — without the sentinel, `uid <> NULL`
-- evaluates to NULL and the guard would be bypassed; a real auth.uid() is never
-- the nil UUID, so non-owners are properly rejected.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- [CRITICAL] Double-spend race in redeem_reward(): the user's profile was read
-- without a row lock, so two concurrent redemptions could both pass the balance
-- check and each issue a reward for the price of one. Lock the profile FOR
-- UPDATE (serializes per-user) and add a short cooldown. Full re-declaration of
-- the 0007 function with those two changes.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_reward(p_offer uuid)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid    uuid := auth.uid();
  o      public.reward_offers;
  p      public.profiles;
  r      public.reward_redemptions;
  v_code text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  -- Global per-user cooldown (defends against rapid multi-offer redemption spam).
  if exists (
    select 1 from public.reward_redemptions
    where user_id = uid and redeemed_at > now() - interval '5 seconds'
  ) then
    raise exception 'Please wait a few seconds between redemptions';
  end if;

  select * into o from public.reward_offers where id = p_offer for update;
  if not found then raise exception 'Reward not found'; end if;
  if not o.is_active then raise exception 'This reward is no longer available'; end if;
  if o.starts_at is not null and now() < o.starts_at then raise exception 'This reward is not available yet'; end if;
  if o.ends_at   is not null and now() > o.ends_at   then raise exception 'This reward has expired'; end if;
  if o.inventory is not null and o.redeemed_count >= o.inventory then raise exception 'This reward is sold out'; end if;

  -- Lock the caller's profile row so the balance check + debit are atomic.
  select * into p from public.profiles where id = uid for update;
  if not found then raise exception 'Profile not found'; end if;

  if p.level < o.min_level then
    raise exception 'Reach level % to unlock this reward', o.min_level;
  end if;
  if o.required_badge_id is not null
     and not exists (select 1 from public.user_badges ub where ub.user_id = uid and ub.badge_id = o.required_badge_id) then
    raise exception 'This reward is reserved for guardians who earned the % badge', o.required_badge_id;
  end if;
  if o.once_per_user and exists (
       select 1 from public.reward_redemptions rr where rr.user_id = uid and rr.offer_id = p_offer
     ) then
    raise exception 'You have already redeemed this reward';
  end if;
  if p.kibble_balance < o.cost_kibble then
    raise exception 'Not enough Kibble — you need % but have %', o.cost_kibble, p.kibble_balance;
  end if;

  v_code := 'GUARD-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));

  update public.profiles set kibble_balance = kibble_balance - o.cost_kibble where id = uid;
  update public.reward_offers set redeemed_count = redeemed_count + 1 where id = p_offer;

  insert into public.reward_redemptions (user_id, offer_id, cost_kibble, code, expires_at)
  values (uid, p_offer, o.cost_kibble, v_code,
          case when o.ends_at is not null then o.ends_at else now() + interval '90 days' end)
  returning * into r;

  insert into public.wallet_transactions (user_id, amount, reason, kind, redemption_id)
  values (uid, -o.cost_kibble, 'Redeemed: ' || o.title, 'redeem', r.id);

  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- [HIGH] Adoption-interest self-approval: the UPDATE policy let a user set
-- their own row's status='approved', bypassing approve_adoption(). Restrict
-- direct UPDATE to the `message` column only (status changes flow through the
-- SECURITY DEFINER RPC, which checks lister/guardian authority).
-- ---------------------------------------------------------------------------
revoke update on public.adoption_interest from anon, authenticated;
grant  update (message) on public.adoption_interest to authenticated;

-- Withdrawing interest now goes through a function (status is no longer
-- client-writable). A user may withdraw only their own pending interest.
create or replace function public.withdraw_adoption_interest(p_sighting uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.adoption_interest
  set status = 'withdrawn'
  where sighting_id = p_sighting and user_id = auth.uid() and status = 'pending';
end;
$$;
revoke execute on function public.withdraw_adoption_interest(uuid) from public;
grant  execute on function public.withdraw_adoption_interest(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- [HIGH] Precise coordinates were readable by any authenticated user via a
-- direct `.select('lat,lng,address')` (RLS allows the row; nothing hid the
-- columns). Lock SELECT down to non-sensitive columns. Exact location now comes
-- ONLY from the privacy-aware get_sighting_detail() RPC (owner/guardian) and
-- the coarsened nearby_sightings() RPC — both SECURITY DEFINER, so they bypass
-- this column grant.
-- ---------------------------------------------------------------------------
revoke select on public.sightings from anon, authenticated;
grant  select (
  id, reporter_id, title, description, status, temperament, color,
  is_injured, needs_urgent_help, claimed_by, claimed_at, rescued_at,
  created_at, updated_at
) on public.sightings to authenticated;

-- ---------------------------------------------------------------------------
-- [HIGH/MED] nearby_sightings(): must become SECURITY DEFINER now that the raw
-- lat/lng/location columns are no longer client-selectable (it reads them to
-- compute distance + coarsen). Also add coordinate-bounds validation to stop a
-- malformed-input DoS. Re-declared as plpgsql; return shape unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.nearby_sightings(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_m  double precision default 5000,
  p_statuses  cat_status[] default null,
  p_limit     integer default 200
)
returns table (
  id                uuid,
  lat               double precision,
  lng               double precision,
  title             text,
  status            cat_status,
  temperament       cat_temperament,
  color             text,
  is_injured        boolean,
  needs_urgent_help boolean,
  created_at        timestamptz,
  distance_m        double precision,
  reporter_id       uuid,
  reporter_username text,
  thumbnail_url     text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid coordinates';
  end if;

  return query
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select
    s.id,
    -- Coarsen to ~3 decimals (~110m) so the map can't enumerate exact locations.
    round(s.lat::numeric, 3)::double precision,
    round(s.lng::numeric, 3)::double precision,
    s.title, s.status, s.temperament, s.color, s.is_injured, s.needs_urgent_help,
    s.created_at,
    st_distance(s.location, o.g),
    s.reporter_id,
    p.username,
    (select ph.url from public.sighting_photos ph
       where ph.sighting_id = s.id order by ph.created_at asc limit 1)
  from public.sightings s
  cross join origin o
  left join public.profiles p on p.id = s.reporter_id
  where st_dwithin(s.location, o.g, least(coalesce(p_radius_m, 5000), 20000))
    and s.status <> 'archived'
    and (p_statuses is null or s.status = any (p_statuses))
  order by s.location <-> o.g
  limit greatest(1, least(p_limit, 500));
end;
$$;

revoke execute on function public.nearby_sightings(
  double precision, double precision, double precision, cat_status[], integer
) from public;
grant execute on function public.nearby_sightings(
  double precision, double precision, double precision, cat_status[], integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- [HIGH/MED] Spam / flood protection. A generic BEFORE INSERT trigger caps how
-- many rows a single user can insert into a table within a time window. It runs
-- on EVERY insert path (direct table writes AND SECURITY DEFINER RPCs), because
-- auth.uid() reflects the request's JWT regardless of the executing role.
-- Args: (window, max_count, owner_column).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_insert_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_window interval := (tg_argv[0])::interval;
  v_max    int      := (tg_argv[1])::int;
  v_col    text     := tg_argv[2];
  v_owner  uuid;
  v_count  int;
begin
  if v_user is null then return new; end if;            -- system/no-session inserts
  execute format('select ($1).%I', v_col) into v_owner using new;
  if v_owner is distinct from v_user then return new; end if;  -- only limit the caller's own rows

  execute format(
    'select count(*) from public.%I where %I = $1 and created_at > now() - $2',
    tg_table_name, v_col
  ) into v_count using v_user, v_window;

  if v_count >= v_max then
    raise exception 'Too many requests — please slow down and try again shortly'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists sightings_rate_burst on public.sightings;
create trigger sightings_rate_burst before insert on public.sightings
  for each row execute function public.enforce_insert_rate_limit('45 seconds', '5', 'reporter_id');

drop trigger if exists sightings_rate_daily on public.sightings;
create trigger sightings_rate_daily before insert on public.sightings
  for each row execute function public.enforce_insert_rate_limit('1 day', '60', 'reporter_id');

drop trigger if exists sighting_updates_rate on public.sighting_updates;
create trigger sighting_updates_rate before insert on public.sighting_updates
  for each row execute function public.enforce_insert_rate_limit('30 seconds', '8', 'author_id');

drop trigger if exists adoption_interest_rate on public.adoption_interest;
create trigger adoption_interest_rate before insert on public.adoption_interest
  for each row execute function public.enforce_insert_rate_limit('60 seconds', '8', 'user_id');

-- ---------------------------------------------------------------------------
-- [MED] Cap photos per sighting (the 4-photo UI limit was bypassable via a
-- direct insert into sighting_photos).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_photo_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  select count(*) into v_count from public.sighting_photos where sighting_id = new.sighting_id;
  if v_count >= 12 then
    raise exception 'This sighting already has the maximum number of photos'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists sighting_photos_cap on public.sighting_photos;
create trigger sighting_photos_cap before insert on public.sighting_photos
  for each row execute function public.enforce_photo_cap();

-- ---------------------------------------------------------------------------
-- [LOW] Cap push tokens per user (keep the 10 most recent). Re-declares the
-- 0010 function with a prune step.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_push_token(
  p_token text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  geo geography(Point, 4326);
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_token is null or length(p_token) < 10 then raise exception 'Invalid push token'; end if;

  if p_lat is not null and p_lng is not null then
    geo := st_setsrid(
      st_makepoint(round(p_lng::numeric, 3)::double precision,
                   round(p_lat::numeric, 3)::double precision),
      4326
    )::geography;
  end if;

  insert into public.device_push_tokens (user_id, token, last_known_location, updated_at)
  values (uid, p_token, geo, now())
  on conflict (user_id, token) do update
    set last_known_location = coalesce(excluded.last_known_location, public.device_push_tokens.last_known_location),
        updated_at = now();

  -- Keep only this user's 10 most-recently-seen devices.
  delete from public.device_push_tokens d
  where d.user_id = uid
    and d.token not in (
      select token from public.device_push_tokens
      where user_id = uid order by updated_at desc limit 10
    );
end;
$$;
