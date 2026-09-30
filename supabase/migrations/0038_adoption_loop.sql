-- 0038 — make the ADOPT step of the loop completable, and tell people when
-- something they are waiting on happens.
--
-- NOT APPLIED to any hosted project by this file being here. Apply it the way
-- the migration headers in DEPLOY.md describe, after reading it.
--
-- ⚠ ROLLOUT ORDER: deploy the `send-push` Edge Function from this commit
-- BEFORE applying this migration, then this migration. The new events use a
-- separate `{ event, recipient_user_id, about_sighting_id }` envelope with no
-- `sighting_id`, so an OLD send-push rejects them with a 400 instead of
-- mistaking them for an urgent broadcast. Applied in the wrong order, the
-- only effect is that these new pushes are dropped until send-push is
-- redeployed.
--
-- ── 1. Nobody could ever be cleared to adopt ────────────────────────────────
-- Adoption is gated on a cleared background check (0032). With the default
-- `manual` ID provider, clearing needs a moderator to call
-- review_adopter_screening(), but there was no screen for it, moderators could
-- not open the ID photos (the bucket is owner-only), and nothing listed who was
-- waiting. So every applicant stayed "pending" forever and no cat could be
-- adopted in-app. This adds:
--   * list_screening_queue(): moderators see who is waiting, oldest first,
--     with only what a reviewer needs (name + date of birth to match the ID,
--     city, home and pet answers, the auto-review flags). Phone number and
--     street address are NOT returned;
--   * moderators may read `screening-docs` objects, so the app can mint
--     short-lived signed URLs for the ID photos. Still no public URL and no
--     bucket-wide listing for anyone else;
--   * review_adopter_screening() gains the hard rules the questionnaire already
--     applies (18+, cruelty attestation), refuses to approve an ID it has no
--     photos of, refuses self-review, and requires a reason when it rejects or
--     asks for more information, so the applicant knows what to fix.
--
-- ── 2. The adoption request lifecycle had dead ends ─────────────────────────
--   * approve_adoption() accepted a request the adopter had WITHDRAWN (or one
--     already declined) and completed the adoption anyway. It now requires the
--     request to still be pending;
--   * a lister had no way to say no, only yes: decline_adoption_interest();
--   * re-expressing interest after being declined silently reset the request
--     to pending, so a "no" could be undone by the applicant. Only a withdrawn
--     request can be reopened by its owner now.
--
-- ── 3. Decisions reached nobody ─────────────────────────────────────────────
-- Pushes (via send-push, same shared-secret webhook as 0029) now go to:
--   * the applicant when a moderator decides their background check;
--   * the adopter when their request is approved or declined;
--   * the lister when a withdrawn request is reopened (the insert trigger from
--     0029 only saw brand-new requests);
--   * the reporter and the assigned Guardian when someone comments on their
--     cat, unless they have blocked the author. The push never contains the
--     comment text.
-- As in 0029, nobody is pushed about their own action, and a push failure is a
-- WARNING that can never roll back the write that caused it.
--
-- ── 4. Drift check 6 failed on every fresh build ────────────────────────────
-- 0032's "owners read their screening" policy called auth.uid() per row.

-- ---------------------------------------------------------------------------
-- 4. Hoist auth.uid() in the screening owner policy (schema_assertions check 6)
-- ---------------------------------------------------------------------------
alter policy "owners read their screening" on public.adopter_screenings
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 1a. Moderators can read ID documents (to create signed URLs for review).
-- Widened in place rather than adding a second SELECT policy, so there is
-- still exactly one permissive SELECT policy for this bucket.
-- ---------------------------------------------------------------------------
alter policy "owners read screening docs" on storage.objects
  using (
    bucket_id = 'screening-docs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_moderator())
    )
  );

-- ---------------------------------------------------------------------------
-- 1b. The review queue (moderators only).
-- ---------------------------------------------------------------------------
create or replace function public.list_screening_queue()
returns table (
  user_id             uuid,
  username            text,
  status              text,
  id_status           text,
  full_name           text,
  dob                 date,
  age                 integer,
  city                text,
  postal              text,
  housing             text,
  landlord_permission boolean,
  household_adults    integer,
  household_children  integer,
  other_pets          boolean,
  pets_details        text,
  vet_name            text,
  vet_phone           text,
  experience          text,
  hours_alone         integer,
  home_visit_consent  boolean,
  cruelty_attestation boolean,
  score               integer,
  reasons             text[],
  id_doc_paths        text[],
  submitted_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_moderator() then raise exception 'Moderators only'; end if;

  return query
  select s.user_id, p.username, s.status::text, s.id_status::text,
         s.full_name, s.dob, date_part('year', age(current_date, s.dob))::int,
         s.city, s.postal, s.housing, s.landlord_permission,
         s.household_adults, s.household_children, s.other_pets, s.pets_details,
         s.vet_name, s.vet_phone, s.experience, s.hours_alone,
         s.home_visit_consent, s.cruelty_attestation,
         s.score, s.reasons, s.id_doc_paths, s.updated_at
    from public.adopter_screenings s
    join public.profiles p on p.id = s.user_id
   where s.status in ('pending', 'needs_review')
     and s.user_id <> auth.uid()
   order by s.updated_at asc
   limit 100;
end;
$$;

revoke execute on function public.list_screening_queue() from public, anon;
grant  execute on function public.list_screening_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- 1c. review_adopter_screening — same signature and effects as 0032, plus the
-- guards described in the header.
-- ---------------------------------------------------------------------------
create or replace function public.review_adopter_screening(
  p_user uuid, p_decision text, p_reason text default null
)
returns public.adopter_screenings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result_row public.adopter_screenings;
  v_reason   text := left(nullif(trim(coalesce(p_reason, '')), ''), 300);
begin
  if not public.is_moderator() then raise exception 'Moderators only'; end if;
  if p_user is null then raise exception 'User required'; end if;
  if p_user = auth.uid() then
    raise exception 'You cannot review your own background check';
  end if;
  if p_decision not in ('approved', 'rejected', 'needs_review') then
    raise exception 'Invalid decision';
  end if;

  select * into result_row from public.adopter_screenings where user_id = p_user for update;
  if not found then raise exception 'No screening found for user'; end if;

  if p_decision = 'approved' then
    if date_part('year', age(current_date, result_row.dob)) < 18 then
      raise exception 'Cannot approve an underage applicant';
    end if;
    if not result_row.cruelty_attestation then
      raise exception 'Cannot approve without the animal-cruelty attestation';
    end if;
    if result_row.id_provider = 'manual'
       and coalesce(array_length(result_row.id_doc_paths, 1), 0) = 0 then
      raise exception 'No ID photos were uploaded — ask the applicant for more information instead';
    end if;
  elsif v_reason is null then
    raise exception 'Give the applicant a reason so they know what to fix';
  end if;

  update public.adopter_screenings set
    status = p_decision::screening_status,
    id_status = case when p_decision = 'approved' then 'verified'::screening_id_status
                     when p_decision = 'rejected' then 'failed'::screening_id_status
                     else id_status end,
    reasons = case when v_reason is not null then array_append(reasons, v_reason) else reasons end,
    verified_at = case when p_decision = 'approved' then now() else verified_at end,
    expires_at = case when p_decision = 'approved' then now() + interval '12 months' else expires_at end,
    updated_at = now()
  where user_id = p_user
  returning * into result_row;
  return result_row;
end;
$$;

revoke execute on function public.review_adopter_screening(uuid, text, text) from public, anon;
grant  execute on function public.review_adopter_screening(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2a. express_adoption_interest — as 0032, but a declined request stays
-- declined. A withdrawn one can still be reopened by its owner.
-- ---------------------------------------------------------------------------
create or replace function public.express_adoption_interest(
  p_sighting uuid, p_message text default null
)
returns public.adoption_interest
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  s public.sightings;
  ai public.adoption_interest;
  v_existing text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting;
  if not found then raise exception 'Sighting not found'; end if;
  if s.status <> 'available' then
    raise exception 'This cat is not currently available for adoption';
  end if;
  if uid = coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     or uid = coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'You cannot adopt a cat you are managing';
  end if;

  -- Background-check hard gate.
  if not public.is_adopter_cleared(uid) then
    raise exception 'Background check required — complete screening before adopting'
      using errcode = 'check_violation';
  end if;

  select a.status into v_existing
    from public.adoption_interest a
   where a.sighting_id = p_sighting and a.user_id = uid;
  if v_existing = 'declined' then
    raise exception 'The lister has already responded to your request for this cat';
  end if;

  insert into public.adoption_interest (sighting_id, user_id, message)
  values (p_sighting, uid, p_message)
  on conflict (sighting_id, user_id)
  do update set message = excluded.message, status = 'pending'
  returning * into ai;

  update public.profiles set wants_to_adopt = true where id = uid and wants_to_adopt = false;
  return ai;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2b. approve_adoption — as 0032, but only a PENDING request can be approved.
-- The request row is locked so a concurrent withdraw cannot slip in between
-- the check and the adoption.
-- ---------------------------------------------------------------------------
create or replace function public.approve_adoption(p_interest uuid)
returns public.sightings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  ai public.adoption_interest;
  s public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into ai from public.adoption_interest where id = p_interest for update;
  if not found then raise exception 'Adoption interest not found'; end if;

  select * into s from public.sightings where id = ai.sighting_id for update;
  if not found then raise exception 'Sighting not found'; end if;

  if uid <> coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     and uid <> coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'Only the reporter or the assigned guardian can approve an adoption';
  end if;
  if s.status <> 'available' then
    raise exception 'This cat is not available for adoption';
  end if;
  if ai.user_id = uid then
    raise exception 'You cannot approve your own adoption interest';
  end if;
  if ai.status <> 'pending' then
    raise exception 'This adoption request is no longer open';
  end if;

  -- The applicant must still be cleared at approval time (screenings expire).
  if not public.is_adopter_cleared(ai.user_id) then
    raise exception 'Adopter background check is not cleared (expired or unverified)';
  end if;

  update public.adoption_interest set status = 'approved' where id = p_interest;
  update public.adoption_interest
  set status = 'declined' where sighting_id = ai.sighting_id and id <> p_interest and status = 'pending';

  update public.sightings set status = 'adopted' where id = ai.sighting_id returning * into s;

  insert into public.sighting_updates (sighting_id, author_id, type, old_status, new_status, body)
  values (ai.sighting_id, uid, 'status_change', 'available', 'adopted', 'Found a forever home!');

  -- adopter gets the warm fuzzy; the lister gets matchmaker credit
  perform public.award_points(ai.user_id, 25, 'Adopted a cat', ai.sighting_id);
  update public.profiles set adoptions_count = adoptions_count + 1 where id = uid;
  perform public.award_points(uid, 30, 'Placed a cat in a forever home', ai.sighting_id);

  return s;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2c. decline_adoption_interest — the lister's "no".
-- ---------------------------------------------------------------------------
create or replace function public.decline_adoption_interest(p_interest uuid)
returns public.adoption_interest
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  ai public.adoption_interest;
  s public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into ai from public.adoption_interest where id = p_interest for update;
  if not found then raise exception 'Adoption interest not found'; end if;

  select * into s from public.sightings where id = ai.sighting_id;
  if not found then raise exception 'Sighting not found'; end if;

  if uid <> coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     and uid <> coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'Only the reporter or the assigned guardian can decline an adoption request';
  end if;
  if ai.status <> 'pending' then
    raise exception 'This adoption request is no longer open';
  end if;

  update public.adoption_interest set status = 'declined' where id = p_interest
  returning * into ai;
  return ai;
end;
$$;

revoke execute on function public.decline_adoption_interest(uuid) from public, anon;
grant  execute on function public.decline_adoption_interest(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3a. enqueue_push_event — the 0029 funnel with a versioned envelope. Reads
-- the same private.push_config; trigger-only (no client EXECUTE grant).
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_push_event(
  p_event     text,
  p_recipient uuid,
  p_sighting  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if p_recipient is null then return; end if;

  select c.value into v_url    from private.push_config c where c.key = 'edge_function_url';
  select c.value into v_secret from private.push_config c where c.key = 'webhook_secret';

  if v_url is null or btrim(v_url) = '' or v_secret is null or btrim(v_secret) = '' then
    raise warning 'enqueue_push_event: private.push_config not configured — skipping "%" push', p_event;
    return;
  end if;

  begin
    perform net.http_post(
      url     => v_url,
      headers => jsonb_build_object(
        'Content-Type',          'application/json',
        'x-push-webhook-secret', v_secret
      ),
      body    => jsonb_build_object(
        'event',             p_event,
        'recipient_user_id', p_recipient,
        'about_sighting_id', p_sighting
      ),
      timeout_milliseconds => 5000
    );
  exception when others then
    raise warning 'enqueue_push_event: failed to enqueue "%" push: %', p_event, sqlerrm;
  end;
end;
$$;

revoke execute on function public.enqueue_push_event(text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Background check decided (by a moderator or the provider webhook).
-- The applicant's own submissions and lazy expiry run as the applicant, so
-- they never push. Fires when the status OR the reasons change, so asking an
-- already-flagged applicant for more information still reaches them.
-- ---------------------------------------------------------------------------
create or replace function public.on_screening_decision_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from auth.uid()
     and new.status in ('approved', 'rejected', 'needs_review') then
    perform public.enqueue_push_event('screening_decided', new.user_id, null);
  end if;
  return new;
end;
$$;

revoke execute on function public.on_screening_decision_push() from public, anon, authenticated;

drop trigger if exists adopter_screening_decision_push on public.adopter_screenings;
create trigger adopter_screening_decision_push
  after update on public.adopter_screenings
  for each row
  when (old.status is distinct from new.status or old.reasons is distinct from new.reasons)
  execute function public.on_screening_decision_push();

-- ---------------------------------------------------------------------------
-- 3c. Adoption request answered, or a withdrawn request reopened.
-- Auto-declines issued by approve_adoption() reach each other applicant too.
-- ---------------------------------------------------------------------------
create or replace function public.on_adoption_interest_status_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lister uuid;
begin
  if new.status = 'approved' and new.user_id is distinct from auth.uid() then
    perform public.enqueue_push_event('adoption_approved', new.user_id, new.sighting_id);
  elsif new.status = 'declined' and new.user_id is distinct from auth.uid() then
    perform public.enqueue_push_event('adoption_declined', new.user_id, new.sighting_id);
  elsif new.status = 'pending' and old.status = 'withdrawn' then
    select coalesce(s.claimed_by, s.reporter_id) into v_lister
      from public.sightings s where s.id = new.sighting_id;
    if v_lister is not null and v_lister is distinct from auth.uid() then
      perform public.enqueue_push_notification('adoption_interest', new.sighting_id, v_lister);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.on_adoption_interest_status_push() from public, anon, authenticated;

drop trigger if exists adoption_interest_status_push on public.adoption_interest;
create trigger adoption_interest_status_push
  after update of status on public.adoption_interest
  for each row
  when (old.status is distinct from new.status)
  execute function public.on_adoption_interest_status_push();

-- ---------------------------------------------------------------------------
-- 3d. New comment → the reporter and the assigned Guardian (not the author,
-- and not anyone who has blocked the author).
-- ---------------------------------------------------------------------------
create or replace function public.on_comment_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporter uuid;
  v_guardian uuid;
  v_recipient uuid;
begin
  select s.reporter_id, s.claimed_by into v_reporter, v_guardian
    from public.sightings s where s.id = new.sighting_id;

  for v_recipient in
    select distinct r.id
      from unnest(array[v_reporter, v_guardian]) as r(id)
     where r.id is not null
       and r.id is distinct from new.author_id
       and not exists (
         select 1 from public.user_blocks b
          where b.blocker_id = r.id and b.blocked_id = new.author_id
       )
  loop
    perform public.enqueue_push_event('new_comment', v_recipient, new.sighting_id);
  end loop;
  return new;
end;
$$;

revoke execute on function public.on_comment_push() from public, anon, authenticated;

drop trigger if exists sighting_comment_push on public.sighting_updates;
create trigger sighting_comment_push
  after insert on public.sighting_updates
  for each row
  when (new.type = 'comment')
  execute function public.on_comment_push();
