-- 0039 — enforce security invariants at the database boundary.
-- Apply only after verifying the hosted migration history (see DEPLOY.md).
-- Repository changes do not apply this migration to a hosted database.

-- Creation RPCs set ownership, lifecycle fields and server timestamps. Table
-- INSERT previously let a caller forge status/claims and backdate rate limits.
revoke insert on public.sightings, public.lost_cats from public, anon, authenticated;
drop policy if exists "users create their own sightings" on public.sightings;
drop policy if exists "owners create their lost cats" on public.lost_cats;

-- These two app paths intentionally insert directly. Keep their input columns
-- while leaving IDs, timestamps and moderation fields under server control.
revoke insert on public.sighting_updates, public.sighting_photos from public, anon, authenticated;
grant insert (sighting_id, author_id, type, body) on public.sighting_updates to authenticated;
grant insert (sighting_id, uploaded_by, url) on public.sighting_photos to authenticated;

-- One bounded row per account/action. Row locking makes quota reservation
-- atomic, and deletion of domain rows never refunds points-producing actions.
-- Old timestamps are pruned on access; account deletion removes the whole row.
create table if not exists private.request_rate_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (length(action) between 1 and 120),
  arrivals timestamptz[] not null default '{}',
  primary key (user_id, action),
  check (cardinality(arrivals) <= 120)
);
alter table private.request_rate_windows enable row level security;
revoke all on private.request_rate_windows from public, anon, authenticated;

create or replace function private.reserve_request(
  p_user uuid, p_action text, p_limit integer, p_window interval
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_arrivals timestamptz[];
  v_now timestamptz;
begin
  if p_user is null or p_limit is null or p_limit < 1 or p_limit > 120
     or p_window is null or p_window <= interval '0 seconds' then
    return false;
  end if;
  insert into private.request_rate_windows(user_id, action)
  values (p_user, p_action) on conflict do nothing;
  select arrivals into v_arrivals from private.request_rate_windows
  where user_id = p_user and action = p_action for update;
  -- Measure after acquiring the lock; a caller may have waited behind others.
  v_now := clock_timestamp();
  select coalesce(array_agg(t), '{}'::timestamptz[]) into v_arrivals
  from unnest(v_arrivals) t where t > v_now - p_window;
  if cardinality(v_arrivals) >= p_limit then return false; end if;
  update private.request_rate_windows
  set arrivals = array_append(v_arrivals, v_now)
  where user_id = p_user and action = p_action;
  return true;
end;
$$;
revoke all on function private.reserve_request(uuid, text, integer, interval)
  from public, anon, authenticated;

create or replace function public.enforce_insert_rate_limit()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
begin
  if v_user is null then return new; end if;
  execute format('select ($1).%I', tg_argv[2]) into v_owner using new;
  if v_owner is distinct from v_user then return new; end if;
  if not private.reserve_request(v_user, 'insert:' || tg_table_name || ':' || tg_name,
      tg_argv[1]::integer, tg_argv[0]::interval) then
    raise exception 'Too many requests — please slow down and try again shortly'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_insert_rate_limit() from public, anon, authenticated;

-- Reserve before calling a paid provider, independently of whether usage
-- accounting succeeds afterwards. Retain the RPC signature used by all edges.
-- Feature names and ceilings are server-owned, preventing arbitrary quota-row
-- creation or unbounded arrays through direct calls to this public RPC.
create or replace function public.check_ai_rate_limit(p_feature text, p_max_per_hour integer)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_limit integer := case p_feature
    when 'adoption_copy' then 10
    when 'report_autofill' then 20
    when 'rescue_copilot' then 20
    when 'reid' then 30
    when 'mod_copilot' then 30
    when 'lost_cat_match' then 30
    when 'kb_ingest' then 30
    when 'photo_moderation' then 30
    when 'text_moderation' then 60
    when 'embed' then 120
  end;
begin
  if auth.uid() is null or v_limit is null or p_max_per_hour is null
     or p_max_per_hour < 1 then return false; end if;
  return private.reserve_request(auth.uid(), 'ai:' || p_feature,
    least(v_limit, p_max_per_hour), interval '1 hour');
end;
$$;
revoke all on function public.check_ai_rate_limit(text, integer) from public, anon;
grant execute on function public.check_ai_rate_limit(text, integer) to authenticated;

-- Both questionnaire RPCs and trusted Edge writes pass this trigger. A path
-- must identify this applicant's upload, never another applicant's ID photo.
create or replace function public.validate_screening_document_paths()
returns trigger
language plpgsql set search_path = ''
as $$
declare v_path text;
begin
  if cardinality(new.id_doc_paths) > 4 then
    raise exception 'At most four ID documents are allowed' using errcode = 'check_violation';
  end if;
  foreach v_path in array new.id_doc_paths loop
    if v_path is null or length(v_path) > 1024
       or split_part(v_path, '/', 1) <> new.user_id::text
       or array_length(string_to_array(v_path, '/'), 1) < 2
       or v_path ~ '(^|/)(\.{1,2})?(/|$)'
       or position(chr(92) in v_path) > 0
       or position('%' in v_path) > 0
       or v_path ~ '[ ?#]'
       or v_path ~ '[[:cntrl:]]' then
      raise exception 'ID documents must use valid paths in your own upload folder'
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validate_screening_document_paths() from public, anon, authenticated;
drop trigger if exists validate_screening_document_paths on public.adopter_screenings;
create trigger validate_screening_document_paths
  before insert or update of id_doc_paths, user_id on public.adopter_screenings
  for each row execute function public.validate_screening_document_paths();

-- Close the pre-existing-data path too: a previously approved foreign/aliased
-- reference must not survive the patch. Clearing only invalid arrays invokes
-- 0035's evidence-reset trigger, invalidating approval/session metadata while
-- preserving all valid evidence and its approval. The applicant can reupload.
update public.adopter_screenings s
set id_doc_paths = '{}'
where cardinality(s.id_doc_paths) > 4
   or exists (
     select 1 from unnest(s.id_doc_paths) as d(path)
     where d.path is null or length(d.path) > 1024
        or split_part(d.path, '/', 1) <> s.user_id::text
        or array_length(string_to_array(d.path, '/'), 1) < 2
        or d.path ~ '(^|/)(\.{1,2})?(/|$)'
        or position(chr(92) in d.path) > 0
        or position('%' in d.path) > 0
        or d.path ~ '[ ?#]'
        or d.path ~ '[[:cntrl:]]'
   );

-- Replacing bytes at an already-reviewed path must not preserve verification.
-- Upload a fresh path and resubmit instead (0035 then resets the approval).
-- Service-role account erasure still bypasses RLS, as intended.
alter policy "owners manage screening docs" on storage.objects
  using (
    bucket_id = 'screening-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.adopter_screenings s
      where s.user_id = (select auth.uid()) and storage.objects.name = any(s.id_doc_paths)
    )
  )
  with check (
    bucket_id = 'screening-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.adopter_screenings s
      where s.user_id = (select auth.uid()) and storage.objects.name = any(s.id_doc_paths)
    )
  );
alter policy "owners delete screening docs" on storage.objects
  using (
    bucket_id = 'screening-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.adopter_screenings s
      where s.user_id = (select auth.uid()) and storage.objects.name = any(s.id_doc_paths)
    )
  );

-- Apply the same visibility guards when callers address a known UUID.
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
  -- A claim returns the precise row; hidden reports must not be claimable
  -- by a stranger who learned the UUID before moderation hid the report.
  if (s.is_hidden and uid is distinct from s.reporter_id and not public.is_moderator())
     or (not public.is_moderator() and exists (
       select 1 from public.user_blocks b
       where b.blocker_id = uid and b.blocked_id = s.reporter_id
     )) then
    raise exception 'Sighting not found';
  end if;
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


create or replace function public.get_sighting_detail(p_sighting uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  s         public.sightings;
  v_precise boolean;
  v_lat     double precision;
  v_lng     double precision;
  result    jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting;
  if not found then raise exception 'Sighting not found'; end if;

  v_precise :=
    uid = coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
    or uid = coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000');

  if not public.is_moderator() and exists (
    select 1 from public.user_blocks b
    where b.blocker_id = uid and b.blocked_id = s.reporter_id
  ) then
    raise exception 'Sighting not found';
  end if;

  -- Hidden cats are visible only to the people managing them and moderators.
  if s.is_hidden and not v_precise and not public.is_moderator() then
    raise exception 'Sighting not found';
  end if;

  if v_precise then
    v_lat := s.lat; v_lng := s.lng;
  else
    v_lat := round(s.lat::numeric, 3)::double precision;
    v_lng := round(s.lng::numeric, 3)::double precision;
  end if;

  result := jsonb_build_object(
    'id', s.id, 'reporter_id', s.reporter_id, 'title', s.title, 'description', s.description,
    'address', case when v_precise then s.address else null end,
    'status', s.status, 'temperament', s.temperament, 'color', s.color,
    'is_injured', s.is_injured, 'needs_urgent_help', s.needs_urgent_help,
    'claimed_by', s.claimed_by, 'claimed_at', s.claimed_at, 'rescued_at', s.rescued_at,
    'created_at', s.created_at, 'updated_at', s.updated_at,
    'lat', v_lat, 'lng', v_lng, 'is_precise', v_precise,
    'reporter', (select jsonb_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url, 'level', p.level)
                 from public.profiles p where p.id = s.reporter_id),
    'claimer', (select jsonb_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url, 'level', p.level)
                from public.profiles p where p.id = s.claimed_by),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'sighting_id', ph.sighting_id, 'url', ph.url,
                                'uploaded_by', ph.uploaded_by, 'created_at', ph.created_at) order by ph.created_at)
               from public.sighting_photos ph where ph.sighting_id = s.id), '[]'::jsonb)
  );
  return result;
end;
$$;
revoke execute on function public.get_sighting_detail(uuid) from public;
grant  execute on function public.get_sighting_detail(uuid) to authenticated;
