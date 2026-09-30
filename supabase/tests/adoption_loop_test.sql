-- pgTAP tests for the adoption loop (migration 0038):
--   1. the adoption request lifecycle: a withdrawn or declined request can no
--      longer be approved, listers can decline, a declined request stays
--      declined, a withdrawn one can be reopened;
--   2. the moderator background-check queue and review guards, and moderator
--      read access to ID photos;
--   3. who gets pushed about what (asserted on pg_net's request queue, which
--      the push funnel writes to inside this transaction).
--
-- Run with:  supabase test db

begin;
select plan(40);

-- ── Helpers (called as postgres, before `set role`) ─────────────────────────
create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, true);
  select set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Pushes queued for one recipient. v1 events (0029) name themselves in
-- `type`, v2 events (0038) in `event`.
create function pg_temp.pushes(p_event text, p_recipient uuid) returns int language sql as $$
  select count(*)::int
    from net.http_request_queue q,
         lateral (select convert_from(q.body, 'UTF8')::jsonb as b) x
   where coalesce(x.b->>'event', x.b->>'type') = p_event
     and x.b->>'recipient_user_id' = p_recipient::text;
$$;

-- Point the funnel at a dummy endpoint so events are actually enqueued. Nothing
-- is sent: pg_net only picks the queue up after commit, and this rolls back.
update private.push_config set value = 'http://push.invalid/functions/v1/send-push'
 where key = 'edge_function_url';
update private.push_config set value = 'test-secret' where key = 'webhook_secret';
delete from net.http_request_queue;

-- Comments are rate-limited to 8 per 30 s per person, and every row here shares
-- one transaction timestamp. The limiter is not under test.
alter table public.sighting_updates disable trigger sighting_updates_rate;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- 1 lister, 2 adopter A, 3 adopter B, 4 moderator, 5 outsider, 6 pending
-- applicant P, 7 flagged applicant Q (no ID photos), 8 underage applicant U,
-- 9 guardian G.
insert into auth.users (id, email) values
  ('a0a0a0a0-0000-0000-0000-000000000001', 'al-lister@example.test'),
  ('a0a0a0a0-0000-0000-0000-000000000002', 'al-adopter-a@example.test'),
  ('a0a0a0a0-0000-0000-0000-000000000003', 'al-adopter-b@example.test'),
  ('a0a0a0a0-0000-0000-0000-000000000004', 'al-mod@example.test'),
  ('a0a0a0a0-0000-0000-0000-000000000005', 'al-outsider@example.test'),
  ('a0a0a0a0-0000-0000-0000-000000000006', 'al-pending@example.test'),
  ('a0a0a0a0-0000-0000-0000-000000000007', 'al-flagged@example.test'),
  ('a0a0a0a0-0000-0000-0000-000000000008', 'al-underage@example.test'),
  ('a0a0a0a0-0000-0000-0000-000000000009', 'al-guardian@example.test')
  on conflict do nothing;
insert into public.profiles (id, username)
select u.id, 'al_' || right(u.id::text, 1) from auth.users u
 where u.id::text like 'a0a0a0a0-%'
  on conflict do nothing;
update public.profiles set is_moderator = true where id = 'a0a0a0a0-0000-0000-0000-000000000004';

-- S1 is ready to adopt; S2 is claimed by the guardian (for comment pushes).
insert into public.sightings (id, reporter_id, claimed_by, location, status) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'a0a0a0a0-0000-0000-0000-000000000001', null,
   st_setsrid(st_makepoint(-73.5, 40.5), 4326)::geography, 'available'),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'a0a0a0a0-0000-0000-0000-000000000001',
   'a0a0a0a0-0000-0000-0000-000000000009',
   st_setsrid(st_makepoint(-73.6, 40.6), 4326)::geography, 'claimed');

-- Screenings: A and B cleared; P pending with ID photos; Q flagged without;
-- U under 18; the moderator has a pending one of their own.
insert into public.adopter_screenings (
  user_id, full_name, dob, phone, address_line, city, postal, housing,
  status, id_status, verified_at, expires_at, id_doc_paths, cruelty_attestation,
  reasons, updated_at
) values
  ('a0a0a0a0-0000-0000-0000-000000000002', 'Adopter A', '1990-01-01', '555-0102',
   '2 Main St', 'Town', '10002', 'own', 'approved', 'verified', now(), now() + interval '1 year',
   array['a0a0a0a0-0000-0000-0000-000000000002/id.jpg'], true, '{}', now() - interval '9 days'),
  ('a0a0a0a0-0000-0000-0000-000000000003', 'Adopter B', '1991-01-01', '555-0103',
   '3 Main St', 'Town', '10003', 'own', 'approved', 'verified', now(), now() + interval '1 year',
   array['a0a0a0a0-0000-0000-0000-000000000003/id.jpg'], true, '{}', now() - interval '9 days'),
  ('a0a0a0a0-0000-0000-0000-000000000006', 'Pending Person', '1985-05-05', '555-0106',
   '6 Main St', 'Town', '10006', 'own', 'pending', 'pending', null, null,
   array['a0a0a0a0-0000-0000-0000-000000000006/id.jpg'], true, '{}', now() - interval '3 days'),
  ('a0a0a0a0-0000-0000-0000-000000000007', 'Flagged Person', '1980-07-07', '555-0107',
   '7 Main St', 'Town', '10007', 'rent', 'needs_review', 'pending', null, null,
   '{}', true, array['landlord permission required when renting'], now() - interval '2 days'),
  ('a0a0a0a0-0000-0000-0000-000000000008', 'Young Person', (current_date - interval '16 years')::date,
   '555-0108', '8 Main St', 'Town', '10008', 'own', 'needs_review', 'pending', null, null,
   array['a0a0a0a0-0000-0000-0000-000000000008/id.jpg'], true, '{}', now() - interval '1 day'),
  ('a0a0a0a0-0000-0000-0000-000000000004', 'The Moderator', '1975-04-04', '555-0104',
   '4 Main St', 'Town', '10004', 'own', 'pending', 'pending', null, null,
   array['a0a0a0a0-0000-0000-0000-000000000004/id.jpg'], true, '{}', now() - interval '5 days');

-- An ID photo in the private bucket.
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('screening-docs', 'a0a0a0a0-0000-0000-0000-000000000006/id.jpg',
   'a0a0a0a0-0000-0000-0000-000000000006', 'a0a0a0a0-0000-0000-0000-000000000006');

-- ═════════════════════ 1. Adoption request lifecycle ════════════════════════

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000002');
set role authenticated;
select lives_ok(
  $$select public.express_adoption_interest('a1a1a1a1-0000-0000-0000-000000000001', 'Adopter A here')$$,
  'a cleared adopter can ask to adopt');
reset role;

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000003');
set role authenticated;
select lives_ok(
  $$select public.express_adoption_interest('a1a1a1a1-0000-0000-0000-000000000001', 'Adopter B here')$$,
  'a second cleared adopter can ask too');
reset role;

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000002');
set role authenticated;
select lives_ok(
  $$select public.withdraw_adoption_interest('a1a1a1a1-0000-0000-0000-000000000001')$$,
  'adopter A withdraws their request');
reset role;

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000001');
set role authenticated;
select throws_like(
  $$select public.approve_adoption((select id from public.adoption_interest
      where user_id = 'a0a0a0a0-0000-0000-0000-000000000002'))$$,
  '%no longer open%',
  'a withdrawn request cannot be approved');
reset role;
select is(
  (select status::text from public.sightings where id = 'a1a1a1a1-0000-0000-0000-000000000001'),
  'available', 'the cat is still available after the refused approval');

-- A withdrawn request can be reopened by its owner, and that tells the lister.
select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000002');
set role authenticated;
select lives_ok(
  $$select public.express_adoption_interest('a1a1a1a1-0000-0000-0000-000000000001', 'Changed my mind')$$,
  'a withdrawn request can be reopened');
reset role;
select is(
  (select status from public.adoption_interest where user_id = 'a0a0a0a0-0000-0000-0000-000000000002'),
  'pending', 'the reopened request is pending again');
select is(
  pg_temp.pushes('adoption_interest', 'a0a0a0a0-0000-0000-0000-000000000001'),
  3, 'the lister is told about both new requests and the reopened one');

-- Declining is the lister's call only.
-- (An outsider cannot even see the row, so resolve its id as postgres first.)
select set_config('al.b_interest', (select id::text from public.adoption_interest
  where user_id = 'a0a0a0a0-0000-0000-0000-000000000003'), true);
select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000005');
set role authenticated;
select throws_like(
  $$select public.decline_adoption_interest(current_setting('al.b_interest')::uuid)$$,
  '%Only the reporter or the assigned guardian%',
  'an outsider cannot decline someone''s request');
reset role;

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000001');
set role authenticated;
select lives_ok(
  $$select public.decline_adoption_interest((select id from public.adoption_interest
      where user_id = 'a0a0a0a0-0000-0000-0000-000000000003'))$$,
  'the lister can decline a request');
select throws_like(
  $$select public.decline_adoption_interest((select id from public.adoption_interest
      where user_id = 'a0a0a0a0-0000-0000-0000-000000000003'))$$,
  '%no longer open%',
  'a request cannot be declined twice');
select throws_like(
  $$select public.approve_adoption((select id from public.adoption_interest
      where user_id = 'a0a0a0a0-0000-0000-0000-000000000003'))$$,
  '%no longer open%',
  'a declined request cannot be approved');
reset role;
select is(
  pg_temp.pushes('adoption_declined', 'a0a0a0a0-0000-0000-0000-000000000003'),
  1, 'the declined adopter is told');

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000003');
set role authenticated;
select throws_like(
  $$select public.express_adoption_interest('a1a1a1a1-0000-0000-0000-000000000001', 'Please?')$$,
  '%already responded%',
  'a declined adopter cannot reset their request to pending');
reset role;

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000001');
set role authenticated;
select lives_ok(
  $$select public.approve_adoption((select id from public.adoption_interest
      where user_id = 'a0a0a0a0-0000-0000-0000-000000000002'))$$,
  'the lister approves the pending request');
reset role;
select is(
  (select status::text from public.sightings where id = 'a1a1a1a1-0000-0000-0000-000000000001'),
  'adopted', 'the cat is adopted');
select is(
  pg_temp.pushes('adoption_approved', 'a0a0a0a0-0000-0000-0000-000000000002'),
  1, 'the approved adopter is told');
select is(
  pg_temp.pushes('adoption_declined', 'a0a0a0a0-0000-0000-0000-000000000002'),
  0, 'the approved adopter is not also told they were declined');

-- ═════════════════════ 2. Background-check review ═══════════════════════════

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000005');
set role authenticated;
select throws_like($$select * from public.list_screening_queue()$$, '%Moderators only%',
  'only moderators can see the review queue');
reset role;

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000004');
set role authenticated;
select is(
  (select array_agg(q.user_id order by ord)
     from public.list_screening_queue() with ordinality as q(user_id, username, status, id_status,
       full_name, dob, age, city, postal, housing, landlord_permission, household_adults,
       household_children, other_pets, pets_details, vet_name, vet_phone, experience,
       hours_alone, home_visit_consent, cruelty_attestation, score, reasons, id_doc_paths,
       submitted_at, ord)
    where q.user_id::text like 'a0a0a0a0-%'),
  array['a0a0a0a0-0000-0000-0000-000000000006'::uuid,
        'a0a0a0a0-0000-0000-0000-000000000007'::uuid,
        'a0a0a0a0-0000-0000-0000-000000000008'::uuid],
  'the queue lists waiting applicants oldest first, not cleared ones, not the moderator''s own');
select is(
  (select q.age from public.list_screening_queue() q
    where q.user_id = 'a0a0a0a0-0000-0000-0000-000000000008'),
  16, 'the queue gives the reviewer the applicant''s age');
reset role;

select ok(
  pg_get_function_result('public.list_screening_queue()'::regprocedure) !~ '\m(phone|address_line)\M',
  'the queue never returns the applicant''s phone number or street address');

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000004');
set role authenticated;
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'screening-docs' and name = 'a0a0a0a0-0000-0000-0000-000000000006/id.jpg'),
  1, 'a moderator can read an applicant''s ID photo (to sign a URL for review)');
select throws_like(
  $$select public.review_adopter_screening('a0a0a0a0-0000-0000-0000-000000000004', 'approved')$$,
  '%your own background check%',
  'a moderator cannot clear themselves');
select throws_like(
  $$select public.review_adopter_screening('a0a0a0a0-0000-0000-0000-000000000007', 'approved')$$,
  '%No ID photos%',
  'an applicant with no ID photos cannot be approved');
select throws_like(
  $$select public.review_adopter_screening('a0a0a0a0-0000-0000-0000-000000000008', 'approved')$$,
  '%underage%',
  'an under-18 applicant cannot be approved');
select throws_like(
  $$select public.review_adopter_screening('a0a0a0a0-0000-0000-0000-000000000007', 'needs_review')$$,
  '%reason%',
  'asking for more information needs a reason');
select lives_ok(
  $$select public.review_adopter_screening('a0a0a0a0-0000-0000-0000-000000000007', 'needs_review',
      'Please upload a photo of your ID and your landlord''s written permission.')$$,
  'a moderator can ask a flagged applicant for more information');
select lives_ok(
  $$select public.review_adopter_screening('a0a0a0a0-0000-0000-0000-000000000006', 'approved')$$,
  'a moderator can clear an applicant whose ID they have seen');
reset role;

select ok(public.is_adopter_cleared('a0a0a0a0-0000-0000-0000-000000000006'),
  'the approved applicant is now cleared to adopt');
select is(pg_temp.pushes('screening_decided', 'a0a0a0a0-0000-0000-0000-000000000006'),
  1, 'the approved applicant is told');
select is(pg_temp.pushes('screening_decided', 'a0a0a0a0-0000-0000-0000-000000000007'),
  1, 'the flagged applicant is told, although their status did not change');

-- The applicant's own actions never push them: expiry runs as the applicant.
update public.adopter_screenings set expires_at = now() - interval '1 minute'
 where user_id = 'a0a0a0a0-0000-0000-0000-000000000006';
select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000006');
set role authenticated;
select is((public.get_my_screening()).status::text, 'expired',
  'an approval past its expiry reads as expired');
reset role;
select is(pg_temp.pushes('screening_decided', 'a0a0a0a0-0000-0000-0000-000000000006'),
  1, 'the applicant is not pushed about their own screening changing');

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000005');
set role authenticated;
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'screening-docs' and name = 'a0a0a0a0-0000-0000-0000-000000000006/id.jpg'),
  0, 'an ordinary user still cannot read someone else''s ID photo');
reset role;

-- ═════════════════════ 3. Comment pushes ════════════════════════════════════

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000005');
set role authenticated;
insert into public.sighting_updates (sighting_id, author_id, type, body)
values ('a1a1a1a1-0000-0000-0000-000000000002', 'a0a0a0a0-0000-0000-0000-000000000005',
        'comment', 'I saw it by the bins this morning');
reset role;

select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000009');
set role authenticated;
insert into public.sighting_updates (sighting_id, author_id, type, body)
values ('a1a1a1a1-0000-0000-0000-000000000002', 'a0a0a0a0-0000-0000-0000-000000000009',
        'comment', 'Thanks, heading there now');
reset role;

select is(pg_temp.pushes('new_comment', 'a0a0a0a0-0000-0000-0000-000000000001'),
  2, 'the reporter hears about both comments');
select is(pg_temp.pushes('new_comment', 'a0a0a0a0-0000-0000-0000-000000000009'),
  1, 'the guardian hears about the outsider''s comment but not their own');

-- The reporter blocks the outsider; the outsider's next comment reaches only
-- the guardian.
insert into public.user_blocks (blocker_id, blocked_id)
values ('a0a0a0a0-0000-0000-0000-000000000001', 'a0a0a0a0-0000-0000-0000-000000000005');
select pg_temp.act_as('a0a0a0a0-0000-0000-0000-000000000005');
set role authenticated;
insert into public.sighting_updates (sighting_id, author_id, type, body)
values ('a1a1a1a1-0000-0000-0000-000000000002', 'a0a0a0a0-0000-0000-0000-000000000005',
        'comment', 'Still there');
reset role;
select is(pg_temp.pushes('new_comment', 'a0a0a0a0-0000-0000-0000-000000000001'),
  2, 'a reporter who blocked the author is not pushed about their comment');
select is(pg_temp.pushes('new_comment', 'a0a0a0a0-0000-0000-0000-000000000009'),
  2, 'the guardian still is');

select ok(
  not exists (
    select 1 from net.http_request_queue q
     where convert_from(q.body, 'UTF8')::jsonb ->> 'event' = 'new_comment'
       and convert_from(q.body, 'UTF8') like '%bins%'),
  'comment pushes never carry the comment text');

select * from finish();
rollback;
