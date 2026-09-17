-- ============================================================================
-- Guardians — 0032_adopter_screening
-- Standard background check for adopters: ID + home/pet questionnaire.
--
-- Model:
--   adopter_screenings holds ONE row per user (upsert on user_id; re-submits
--   overwrite). PII (dob, address, phone, full_name) lives here, owner-readable
--   ONLY via the get_my_screening() RPC. Listers see only is_adopter_cleared(user).
--   ID document images live in the private `screening-docs` storage bucket
--   under "{uid}/..." — never in the table.
--
-- Gating (hard):
--   express_adoption_interest + approve_adoption both require the applicant
--   to be cleared (approved + ID verified + unexpired). This preserves the
--   AGENTS.md rule: score/status columns mutate ONLY via SECURITY DEFINER RPCs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type screening_status as enum
    ('draft', 'pending', 'needs_review', 'approved', 'rejected', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type screening_id_status as enum
    ('unverified', 'pending', 'verified', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.adopter_screenings (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references public.profiles (id) on delete cascade,
  status                screening_status not null default 'pending',
  id_status             screening_id_status not null default 'pending',
  -- Identity (PII — owner-only via RPC, never exposed to listers)
  full_name             text not null,
  dob                   date not null,
  phone                 text not null,
  address_line          text not null,
  city                  text not null,
  postal                text not null,
  -- Home & pets
  housing               text not null check (housing in ('own', 'rent', 'other')),
  landlord_permission   boolean,
  household_adults      integer not null default 1 check (household_adults between 1 and 20),
  household_children    integer not null default 0 check (household_children between 0 and 20),
  other_pets            boolean not null default false,
  pets_details          text,
  vet_name              text,
  vet_phone             text,
  experience            text,
  hours_alone           integer not null default 4 check (hours_alone between 0 and 24),
  home_visit_consent    boolean not null default false,
  cruelty_attestation   boolean not null default false,
  -- Consent + audit
  consent               boolean not null default false,
  consent_at            timestamptz,
  consent_version       text not null default 'v1',
  score                 integer not null default 0,
  reasons               text[] not null default '{}',
  id_provider           text not null default 'manual',
  id_session_id         text,
  id_doc_paths          text[] not null default '{}',
  verified_at           timestamptz,
  expires_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists adopter_screenings_user_idx on public.adopter_screenings (user_id);
create index if not exists adopter_screenings_status_idx on public.adopter_screenings (status, expires_at);

-- ---------------------------------------------------------------------------
-- RLS: default-deny. No direct INSERT/UPDATE/DELETE policies — all writes go
-- through SECURITY DEFINER RPCs. Owners can SELECT their own row (needed for
-- the RPC? RPCs bypass RLS, but the policy documents intent and covers any
-- future direct-read path).
-- ---------------------------------------------------------------------------
alter table public.adopter_screenings enable row level security;

drop policy if exists "owners read their screening" on public.adopter_screenings;
create policy "owners read their screening"
  on public.adopter_screenings for select to authenticated
  using (user_id = auth.uid());

-- Lock down direct writes (defense in depth — no policies = denied).
revoke insert, update, delete on public.adopter_screenings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private storage bucket for ID documents: "{uid}/..." owner-only.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('screening-docs', 'screening-docs', false)
on conflict (id) do nothing;

drop policy if exists "owners upload screening docs" on storage.objects;
create policy "owners upload screening docs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'screening-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "owners read screening docs" on storage.objects;
create policy "owners read screening docs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'screening-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "owners manage screening docs" on storage.objects;
create policy "owners manage screening docs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'screening-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "owners delete screening docs" on storage.objects;
create policy "owners delete screening docs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'screening-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Helper: is this user cleared to adopt right now?
-- Cleared = latest screening approved + ID verified + not expired.
-- Listers call this (boolean only — no PII leaks).
-- ---------------------------------------------------------------------------
create or replace function public.is_adopter_cleared(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.adopter_screenings s
    where s.user_id = p_user
      and s.status = 'approved'
      and s.id_status = 'verified'
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

-- ---------------------------------------------------------------------------
-- Submit (or re-submit) the caller's screening questionnaire.
-- Deterministic auto-scoring; ID verification stays async (manual or provider).
-- ---------------------------------------------------------------------------
create or replace function public.submit_adopter_screening(p_payload jsonb)
returns public.adopter_screenings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid            uuid := auth.uid();
  v_full_name    text := nullif(trim(coalesce(p_payload->>'full_name', '')), '');
  v_dob          date := nullif(trim(coalesce(p_payload->>'dob', '')), '')::date;
  v_phone        text := nullif(trim(coalesce(p_payload->>'phone', '')), '');
  v_address      text := nullif(trim(coalesce(p_payload->>'address_line', '')), '');
  v_city         text := nullif(trim(coalesce(p_payload->>'city', '')), '');
  v_postal       text := nullif(trim(coalesce(p_payload->>'postal', '')), '');
  v_housing      text := coalesce(p_payload->>'housing', '');
  v_landlord     boolean := (p_payload->>'landlord_permission')::boolean;
  v_adults       int := coalesce((p_payload->>'household_adults')::int, 1);
  v_children     int := coalesce((p_payload->>'household_children')::int, 0);
  v_other_pets   boolean := coalesce((p_payload->>'other_pets')::boolean, false);
  v_pets_details text := nullif(trim(coalesce(p_payload->>'pets_details', '')), '');
  v_vet_name     text := nullif(trim(coalesce(p_payload->>'vet_name', '')), '');
  v_vet_phone    text := nullif(trim(coalesce(p_payload->>'vet_phone', '')), '');
  v_experience   text := nullif(trim(coalesce(p_payload->>'experience', '')), '');
  v_hours        int := coalesce((p_payload->>'hours_alone')::int, 4);
  v_home_visit   boolean := coalesce((p_payload->>'home_visit_consent')::boolean, false);
  v_attest       boolean := coalesce((p_payload->>'cruelty_attestation')::boolean, false);
  v_consent      boolean := coalesce((p_payload->>'consent')::boolean, false);
  v_docs         text[] := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(coalesce(p_payload->'id_doc_paths', '[]'::jsonb)) x),
    '{}'
  );
  v_age          int;
  v_reasons      text[] := '{}';
  v_score        int := 0;
  v_status       screening_status := 'pending';
  result_row     public.adopter_screenings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if v_full_name is null then raise exception 'Full legal name is required'; end if;
  if v_dob is null then raise exception 'Date of birth is required (YYYY-MM-DD)'; end if;
  if v_phone is null then raise exception 'Phone number is required'; end if;
  if v_address is null or v_city is null or v_postal is null then
    raise exception 'Full address is required';
  end if;
  if v_housing not in ('own', 'rent', 'other') then raise exception 'Housing is required'; end if;
  if not v_consent then raise exception 'Background-check consent is required'; end if;

  v_age := date_part('year', age(current_date, v_dob))::int;
  if v_age < 18 then
    v_reasons := array_append(v_reasons, 'must be 18 or older');
  end if;
  if not v_attest then
    v_reasons := array_append(v_reasons, 'animal-cruelty attestation required');
  end if;
  if v_housing = 'rent' and v_landlord is distinct from true then
    v_reasons := array_append(v_reasons, 'landlord permission required when renting');
  end if;
  if not v_home_visit then
    v_reasons := array_append(v_reasons, 'home-visit consent required for auto-approval');
  end if;
  if v_hours > 10 then
    v_reasons := array_append(v_reasons, 'long hours alone — needs review');
  end if;
  if v_other_pets and v_vet_name is null then
    v_reasons := array_append(v_reasons, 'vet reference required when other pets in home');
  end if;

  -- Score: start at 100, deduct for review signals.
  v_score := 100 - coalesce(array_length(v_reasons, 1), 0) * 20;
  if v_score < 0 then v_score := 0; end if;

  if not v_attest or v_age < 18 then
    v_status := 'rejected';
  elsif coalesce(array_length(v_reasons, 1), 0) > 0 then
    v_status := 'needs_review';
  else
    -- Questionnaire passed; ID verification still pending (manual/provider).
    v_status := 'pending';
  end if;

  insert into public.adopter_screenings (
    user_id, status, id_status,
    full_name, dob, phone, address_line, city, postal,
    housing, landlord_permission, household_adults, household_children,
    other_pets, pets_details, vet_name, vet_phone, experience, hours_alone,
    home_visit_consent, cruelty_attestation,
    consent, consent_at, consent_version, score, reasons, id_provider, id_doc_paths,
    updated_at
  ) values (
    uid, v_status, 'pending',
    v_full_name, v_dob, v_phone, v_address, v_city, v_postal,
    v_housing, v_landlord, v_adults, v_children,
    v_other_pets, v_pets_details, v_vet_name, v_vet_phone, v_experience, v_hours,
    v_home_visit, v_attest,
    true, now(), 'v1', v_score, v_reasons, 'manual', v_docs,
    now()
  )
  on conflict (user_id) do update set
    status = case
      -- Re-submits that change nothing material keep a live approval, so a
      -- cleared adopter who edits an unrelated field is not needlessly gated.
      when public.adopter_screenings.full_name = excluded.full_name
       and public.adopter_screenings.dob = excluded.dob
       and public.adopter_screenings.status = 'approved'
       and public.adopter_screenings.id_status = 'verified'
       and excluded.status = 'pending'
      then 'approved'::screening_status else excluded.status
    end,
    id_status = case
      -- A fresh submission resets ID verification unless previously verified
      -- and the identity fields are unchanged.
      when public.adopter_screenings.full_name = excluded.full_name
       and public.adopter_screenings.dob = excluded.dob
       and public.adopter_screenings.id_status = 'verified'
      then 'verified'::screening_id_status else 'pending'::screening_id_status
    end,
    full_name = excluded.full_name, dob = excluded.dob, phone = excluded.phone,
    address_line = excluded.address_line, city = excluded.city, postal = excluded.postal,
    housing = excluded.housing, landlord_permission = excluded.landlord_permission,
    household_adults = excluded.household_adults, household_children = excluded.household_children,
    other_pets = excluded.other_pets, pets_details = excluded.pets_details,
    vet_name = excluded.vet_name, vet_phone = excluded.vet_phone,
    experience = excluded.experience, hours_alone = excluded.hours_alone,
    home_visit_consent = excluded.home_visit_consent,
    cruelty_attestation = excluded.cruelty_attestation,
    consent = true, consent_at = now(), consent_version = 'v1',
    score = excluded.score, reasons = excluded.reasons,
    id_provider = 'manual', id_doc_paths = excluded.id_doc_paths,
    verified_at = case
      when public.adopter_screenings.full_name = excluded.full_name
       and public.adopter_screenings.dob = excluded.dob
       and public.adopter_screenings.id_status = 'verified'
      then public.adopter_screenings.verified_at else null
    end,
    expires_at = case
      when public.adopter_screenings.full_name = excluded.full_name
       and public.adopter_screenings.dob = excluded.dob
       and public.adopter_screenings.id_status = 'verified'
      then public.adopter_screenings.expires_at else null
    end,
    updated_at = now()
  returning * into result_row;

  -- Expire stale approvals opportunistically on read path elsewhere; nothing
  -- to do here for a fresh submission.

  return result_row;
exception
  when invalid_text_representation or invalid_datetime_format then
  raise exception 'Invalid details — check date of birth (YYYY-MM-DD) and numeric fields';
end;
$$;

-- ---------------------------------------------------------------------------
-- Read my own screening (PII stays owner-only).
-- ---------------------------------------------------------------------------
create or replace function public.get_my_screening()
returns public.adopter_screenings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result_row public.adopter_screenings;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into result_row from public.adopter_screenings where user_id = auth.uid();
  if not found then return null; end if;
  -- Lazy-expiry: surface expired approvals as expired without a cron job.
  if result_row.status = 'approved' and result_row.expires_at is not null and result_row.expires_at <= now() then
    update public.adopter_screenings set status = 'expired', updated_at = now()
    where user_id = auth.uid() returning * into result_row;
  end if;
  return result_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual review (moderators/admins): verify ID and approve/reject.
-- Provider webhooks (service role) bypass this and write directly.
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
begin
  if not public.is_moderator() then raise exception 'Moderators only'; end if;
  if p_user is null then raise exception 'User required'; end if;
  if p_decision not in ('approved', 'rejected', 'needs_review') then
    raise exception 'Invalid decision';
  end if;

  select * into result_row from public.adopter_screenings where user_id = p_user;
  if not found then raise exception 'No screening found for user'; end if;
  if result_row.status = 'rejected' and p_decision = 'approved' and result_row.reasons @> array['must be 18 or older'] then
    raise exception 'Cannot approve an underage applicant';
  end if;

  update public.adopter_screenings set
    status = p_decision::screening_status,
    id_status = case when p_decision = 'approved' then 'verified'::screening_id_status
                     when p_decision = 'rejected' then 'failed'::screening_id_status
                     else id_status end,
    reasons = case when p_reason is not null then array_append(reasons, p_reason) else reasons end,
    verified_at = case when p_decision = 'approved' then now() else verified_at end,
    expires_at = case when p_decision = 'approved' then now() + interval '12 months' else expires_at end,
    updated_at = now()
  where user_id = p_user
  returning * into result_row;
  return result_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least-privilege EXECUTE grants.
-- ---------------------------------------------------------------------------
revoke execute on function public.is_adopter_cleared(uuid) from public;
grant  execute on function public.is_adopter_cleared(uuid) to authenticated;

revoke execute on function public.submit_adopter_screening(jsonb) from public;
grant  execute on function public.submit_adopter_screening(jsonb) to authenticated;

revoke execute on function public.get_my_screening() from public;
grant  execute on function public.get_my_screening() to authenticated;

revoke execute on function public.review_adopter_screening(uuid, text, text) from public;
grant  execute on function public.review_adopter_screening(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Anti-spam: cap screening resubmissions (the trigger reads auth.uid(), so it
-- applies to SECURITY DEFINER RPC inserts too).
-- ---------------------------------------------------------------------------
drop trigger if exists adopter_screenings_rate on public.adopter_screenings;
create trigger adopter_screenings_rate before insert on public.adopter_screenings
  for each row execute function public.enforce_insert_rate_limit('1 hour', '5', 'user_id');

-- ---------------------------------------------------------------------------
-- HARD GATE: adoption now requires a cleared screening.
-- Both entry points enforce it so neither side can bypass vetting.
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

  insert into public.adoption_interest (sighting_id, user_id, message)
  values (p_sighting, uid, p_message)
  on conflict (sighting_id, user_id)
  do update set message = excluded.message, status = 'pending'
  returning * into ai;

  update public.profiles set wants_to_adopt = true where id = uid and wants_to_adopt = false;
  return ai;
end;
$$;

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

  select * into ai from public.adoption_interest where id = p_interest;
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
