-- pgTAP tests for scheduled jobs, claim leases and urgent escalation
-- (migration 0042; PRD-2.0 R1.7, R1.1, R1.2):
--   1. a claim is a lease: 24 h, 72 h in rescue, renewed by the Guardian's own
--      activity, extended on request inside the warning window;
--   2. the lapse happens at the boundary and not before, exactly once, and
--      tells the Guardian and the reporter;
--   3. an unclaimed urgent report climbs the ladder at 20 and 60 minutes,
--      once per step, and restarts (within a cap) when it reopens;
--   4. the wider ring reaches only devices the base alert did not;
--   5. every job run is logged, a failure alerts the operators once, and no
--      client can run a job or write the lease.
--
-- Pushes are asserted on pg_net's request queue, which the funnel writes to
-- inside this transaction. Time moves through each job's p_now argument.
--
-- Run with:  supabase test db

begin;
select plan(77);

-- ── Helpers (called as postgres, before `set role`) ─────────────────────────
create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, true);
  select set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Person-addressed pushes queued for one recipient.
create function pg_temp.pushes(p_event text, p_recipient uuid) returns int language sql as $$
  select count(*)::int
    from net.http_request_queue q,
         lateral (select convert_from(q.body, 'UTF8')::jsonb as b) x
   where x.b->>'event' = p_event
     and x.b->>'recipient_user_id' = p_recipient::text;
$$;

-- Urgent broadcasts queued by the ladder for one report at one step.
create function pg_temp.broadcasts(p_sighting uuid, p_step int) returns int language sql as $$
  select count(*)::int
    from net.http_request_queue q,
         lateral (select convert_from(q.body, 'UTF8')::jsonb as b) x
   where x.b->>'type' = 'urgent_sighting'
     and x.b->>'sighting_id' = p_sighting::text
     and (x.b->>'escalation_step')::int = p_step;
$$;

update private.push_config set value = 'http://push.invalid/functions/v1/send-push'
 where key = 'edge_function_url';
update private.push_config set value = 'test-secret' where key = 'webhook_secret';
delete from net.http_request_queue;

-- The comment limiter is not under test, and every row here shares one
-- transaction timestamp.
alter table public.sighting_updates disable trigger sighting_updates_rate;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- 1 reporter R, 2 guardian G, 3 moderator M, 4 stranger X.
insert into auth.users (id, email) values
  ('42000000-0000-0000-0000-000000000001', 'cl-reporter@example.test'),
  ('42000000-0000-0000-0000-000000000002', 'cl-guardian@example.test'),
  ('42000000-0000-0000-0000-000000000003', 'cl-moderator@example.test'),
  ('42000000-0000-0000-0000-000000000004', 'cl-stranger@example.test')
  on conflict do nothing;
update public.profiles set is_moderator = (id = '42000000-0000-0000-0000-000000000003')
 where id::text like '42000000-%';
-- Other moderators in the seed would also be told; keep the counts exact.
update public.profiles set is_moderator = false
 where is_moderator and id::text not like '42000000-%';

-- Since 0043 a broadcast is queued only when someone is in its audience: the
-- stranger lives at the reports (base radius), the moderator ~12 km north
-- (wider ring only).
insert into public.alert_preferences (user_id, home_location) values
  ('42000000-0000-0000-0000-000000000004', st_setsrid(st_makepoint(-73, 40), 4326)),
  ('42000000-0000-0000-0000-000000000003', st_setsrid(st_makepoint(-73, 40.11), 4326))
  on conflict (user_id) do update set home_location = excluded.home_location;

-- Seeded reports are not under test; park them at the last step so the
-- ladder counts below are exact.
update public.sightings set escalation_step = 3;

-- S1, S2: ordinary reports. U1..U5: urgent ones. N1: marked urgent later.
insert into public.sightings (id, reporter_id, location, needs_urgent_help, is_hidden, created_at) values
  ('42000001-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326), false, false, now()),
  ('42000001-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326), false, false, now()),
  ('42000001-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326), true, false, now()),
  ('42000001-0000-0000-0000-0000000000a2', '42000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326), true, false, now()),
  ('42000001-0000-0000-0000-0000000000a3', '42000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326), true, false, now() - interval '2 days'),
  ('42000001-0000-0000-0000-0000000000a4', '42000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326), true, true, now()),
  ('42000001-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326), false, false, now());

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The lease
-- ═════════════════════════════════════════════════════════════════════════════
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  null, 'an unclaimed report has no lease');

set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.claim_sighting('42000001-0000-0000-0000-000000000001')$$,
  'the Guardian claims the report');
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() + interval '24 hours', 'a claim starts a 24 hour lease');

select throws_ok(
  $$update public.sightings set claim_expires_at = now() + interval '10 years'
     where id = '42000001-0000-0000-0000-000000000001'$$,
  '42501', null, 'the Guardian cannot write the lease directly');
select throws_ok(
  $$select private.expire_stale_claims()$$,
  '42501', null, 'a client cannot run the expiry job');
select throws_ok(
  $$select private.run_job('claim_leases')$$,
  '42501', null, 'a client cannot run a scheduled job');
select throws_ok(
  $$select * from public.get_job_health()$$,
  'P0001', 'Moderators only', 'job health is for moderators');

-- Far from the lapse there is nothing to extend, and nothing is written.
select lives_ok(
  $$select public.extend_claim('42000001-0000-0000-0000-000000000001')$$,
  'extending early is accepted');
reset role;
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() + interval '24 hours', 'extending early leaves the lease unchanged');
select is(
  (select count(*)::int from public.sighting_updates
    where sighting_id = '42000001-0000-0000-0000-000000000001'
      and body like 'The Guardian confirmed%'),
  0, 'extending early writes nothing to the timeline');

-- The warning: 6 hours before the lapse, once. Park "last activity" in the
-- past first: only a real change to the case may move it.
update public.sightings set updated_at = now() - interval '3 days'
 where id = '42000001-0000-0000-0000-000000000001';
select is(
  (select updated_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() - interval '3 days', 'last activity can be parked in the past for this test');
select is(
  private.warn_expiring_claims(now() + interval '17 hours 59 minutes')->>'warned',
  '0', 'no warning before the 18 hour mark');
select is(
  private.warn_expiring_claims(now() + interval '18 hours')->>'warned',
  '1', 'the Guardian is warned at the 18 hour mark');
select is(
  pg_temp.pushes('claim_expiring', '42000000-0000-0000-0000-000000000002'),
  1, 'the warning is pushed to the Guardian');
select is(
  private.warn_expiring_claims(now() + interval '19 hours')->>'warned',
  '0', 'the warning is not repeated');
select is(
  (select updated_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() - interval '3 days', 'a lease warning is not activity on the case');
update public.sightings set title = 'Tabby by the canal'
 where id = '42000001-0000-0000-0000-000000000001';
select is(
  (select updated_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now(), 'a real change to the case still is');

-- Inside the window the Guardian can extend with one tap.
update public.sightings set claim_expires_at = now() + interval '2 hours'
 where id = '42000001-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.extend_claim('42000001-0000-0000-0000-000000000001')$$,
  'P0001', 'You are not the assigned Guardian for this cat',
  'a stranger cannot extend someone else''s claim');
select pg_temp.act_as('42000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.extend_claim('42000001-0000-0000-0000-000000000001')$$,
  'the Guardian extends inside the warning window');
reset role;
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() + interval '24 hours', 'extending restores a full lease');
select is(
  (select claim_warned_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  null, 'extending clears the warning so the next one can be sent');
select is(
  (select count(*)::int from public.sighting_updates
    where sighting_id = '42000001-0000-0000-0000-000000000001'
      and body like 'The Guardian confirmed%'),
  1, 'the extension is on the timeline for the reporter to see');

-- The Guardian's own activity renews the lease; anyone else's does not.
update public.sightings set claim_expires_at = now() + interval '1 hour', claim_warned_at = now()
 where id = '42000001-0000-0000-0000-000000000001';
insert into public.sighting_updates (sighting_id, author_id, type, body) values
  ('42000001-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001',
   'comment', 'Any news?');
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() + interval '1 hour', 'the reporter''s comment does not renew the lease');
insert into public.sighting_updates (sighting_id, author_id, type, body) values
  ('42000001-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000002',
   'comment', 'Setting a trap tonight.');
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() + interval '24 hours', 'the Guardian''s comment renews the lease');
select is(
  (select claim_warned_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  null, 'and clears the warning');

update public.sightings set claim_expires_at = now() + interval '1 hour'
 where id = '42000001-0000-0000-0000-000000000001';
insert into public.sighting_photos (sighting_id, uploaded_by, url) values
  ('42000001-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000002',
   'https://example.test/trap.jpg');
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() + interval '24 hours', 'the Guardian''s photo renews the lease');

-- An updated claim is not released.
update public.sightings set claim_expires_at = now() + interval '1 minute'
 where id = '42000001-0000-0000-0000-000000000001';
insert into public.sighting_updates (sighting_id, author_id, type, body) values
  ('42000001-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000002',
   'comment', 'Still here.');
select is(
  private.expire_stale_claims(now() + interval '2 minutes')->>'expired',
  '0', 'a claim updated before the lapse is not released');
select is(
  (select status::text from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  'claimed', 'and stays claimed');

-- In rescue: 72 hours.
set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.update_sighting_status('42000001-0000-0000-0000-000000000001', 'in_rescue')$$,
  'the Guardian starts the rescue');
reset role;
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  now() + interval '72 hours', 'a rescue in progress has a 72 hour lease');

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The lapse
-- ═════════════════════════════════════════════════════════════════════════════
select is(
  private.expire_stale_claims(now() + interval '72 hours' - interval '1 second')->>'expired',
  '0', 'nothing lapses one second before the boundary');
select is(
  (select status::text from public.sightings where id = '42000001-0000-0000-0000-000000000001'),
  'in_rescue', 'the rescue is still the Guardian''s');
select is(
  private.expire_stale_claims(now() + interval '72 hours')->>'expired',
  '1', 'the claim lapses at the boundary');
select results_eq(
  $$select status::text, claimed_by, claimed_at, claim_expires_at
      from public.sightings where id = '42000001-0000-0000-0000-000000000001'$$,
  $$values ('spotted', null::uuid, null::timestamptz, null::timestamptz)$$,
  'the cat is back in the pool with no Guardian and no lease');
select is(
  (select count(*)::int from public.sighting_updates
    where sighting_id = '42000001-0000-0000-0000-000000000001'
      and type = 'system' and author_id is null
      and old_status = 'in_rescue' and new_status = 'spotted'),
  1, 'the lapse is on the timeline with the reason');
select is(
  pg_temp.pushes('claim_expired', '42000000-0000-0000-0000-000000000002'),
  1, 'the former Guardian is told');
select is(
  pg_temp.pushes('claim_reopened', '42000000-0000-0000-0000-000000000001'),
  1, 'the reporter is told');
select is(
  private.expire_stale_claims(now() + interval '80 hours')->>'expired',
  '0', 'running the job again does nothing');
select is(
  pg_temp.pushes('claim_expired', '42000000-0000-0000-0000-000000000002')
    + pg_temp.pushes('claim_reopened', '42000000-0000-0000-0000-000000000001'),
  2, 'and sends nothing more');

-- A cat that reached safety is no longer on a lease.
set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000002');
select public.claim_sighting('42000001-0000-0000-0000-000000000002');
select public.update_sighting_status('42000001-0000-0000-0000-000000000002', 'in_rescue');
select public.update_sighting_status('42000001-0000-0000-0000-000000000002', 'safe');
reset role;
select is(
  (select claim_expires_at from public.sightings where id = '42000001-0000-0000-0000-000000000002'),
  null, 'a safe cat has no lease');
select is(
  private.expire_stale_claims(now() + interval '1 year')->>'expired',
  '0', 'a safe cat is never taken from its Guardian');
select is(
  (select claimed_by from public.sightings where id = '42000001-0000-0000-0000-000000000002'),
  '42000000-0000-0000-0000-000000000002'::uuid, 'the Guardian keeps the safe cat');

-- The reporter and the moderator see the lease through the detail RPC.
set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000001');
select ok(
  public.get_sighting_detail('42000001-0000-0000-0000-000000000002') ? 'claim_expires_at'
  and public.get_sighting_detail('42000001-0000-0000-0000-000000000002') ? 'escalation_step',
  'the detail read carries the lease and the ladder step');
reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. The ladder
-- ═════════════════════════════════════════════════════════════════════════════
delete from net.http_request_queue;

select is(
  private.escalate_unclaimed_urgent(now() + interval '19 minutes'),
  '{"base": 0, "ring": 0, "operators": 0}'::jsonb, 'nothing escalates before 20 minutes');
select is(
  private.escalate_unclaimed_urgent(now() + interval '20 minutes'),
  '{"base": 0, "ring": 2, "operators": 0}'::jsonb,
  'at 20 minutes the two open urgent reports reach the wider ring');
select is(
  pg_temp.broadcasts('42000001-0000-0000-0000-0000000000a1', 2),
  1, 'one wider-ring broadcast for the report');
select is(
  private.escalate_unclaimed_urgent(now() + interval '25 minutes'),
  '{"base": 0, "ring": 0, "operators": 0}'::jsonb, 'the ring is alerted once');
select is(
  pg_temp.broadcasts('42000001-0000-0000-0000-0000000000a3', 2)
    + pg_temp.broadcasts('42000001-0000-0000-0000-0000000000a4', 2),
  0, 'a report open for two days and a hidden report are never escalated');

-- A claim stops the ladder.
set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000002');
select public.claim_sighting('42000001-0000-0000-0000-0000000000a2');
reset role;

select is(
  private.escalate_unclaimed_urgent(now() + interval '59 minutes'),
  '{"base": 0, "ring": 0, "operators": 0}'::jsonb, 'nothing more before 60 minutes');
select is(
  private.escalate_unclaimed_urgent(now() + interval '60 minutes'),
  '{"base": 0, "ring": 0, "operators": 1}'::jsonb,
  'at 60 minutes only the still-unclaimed report reaches the operators');
select is(
  pg_temp.pushes('urgent_unclaimed', '42000000-0000-0000-0000-000000000003'),
  1, 'the moderator is told');
select is(
  pg_temp.pushes('urgent_no_responder', '42000000-0000-0000-0000-000000000001'),
  1, 'the reporter is told what has happened');
select is(
  (select count(*)::int from public.sighting_updates
    where sighting_id = '42000001-0000-0000-0000-0000000000a1'
      and type = 'system' and body like 'No Guardian has been able to respond yet%'),
  1, 'the report''s timeline says so and points to local help');
select is(
  (select escalation_step::int from public.sightings where id = '42000001-0000-0000-0000-0000000000a1'),
  3, 'the report is at the last step');
select is(
  private.escalate_unclaimed_urgent(now() + interval '3 hours'),
  '{"base": 0, "ring": 0, "operators": 0}'::jsonb, 'the last step happens once');
select is(
  pg_temp.pushes('urgent_unclaimed', '42000000-0000-0000-0000-000000000003')
    + pg_temp.pushes('urgent_no_responder', '42000000-0000-0000-0000-000000000001'),
  2, 'and nobody is told twice');

-- Reopening restarts the ladder with a fresh base alert, twice at most.
set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000002');
select public.update_sighting_status('42000001-0000-0000-0000-0000000000a2', 'spotted');
reset role;
select is(
  (select escalation_step::int from public.sightings where id = '42000001-0000-0000-0000-0000000000a2'),
  0, 'a released urgent report is owed a base alert');
select is(
  private.escalate_unclaimed_urgent(now()),
  '{"base": 1, "ring": 0, "operators": 0}'::jsonb, 'the base alert goes out again');
select is(
  pg_temp.broadcasts('42000001-0000-0000-0000-0000000000a2', 1),
  1, 'as a base-radius broadcast');
select is(
  private.escalate_unclaimed_urgent(now()),
  '{"base": 0, "ring": 0, "operators": 0}'::jsonb, 'once');

set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000002');
select public.claim_sighting('42000001-0000-0000-0000-0000000000a2');
select public.update_sighting_status('42000001-0000-0000-0000-0000000000a2', 'spotted');
reset role;
select private.escalate_unclaimed_urgent(now());
set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000002');
select public.claim_sighting('42000001-0000-0000-0000-0000000000a2');
select public.update_sighting_status('42000001-0000-0000-0000-0000000000a2', 'spotted');
reset role;
select is(
  private.escalate_unclaimed_urgent(now()),
  '{"base": 0, "ring": 0, "operators": 0}'::jsonb,
  'a third reopening does not broadcast again');
select is(
  pg_temp.broadcasts('42000001-0000-0000-0000-0000000000a2', 1),
  2, 'claim and release cannot be used to broadcast without limit');

-- An open report that is marked urgent later gets its base alert.
update public.sightings set needs_urgent_help = true
 where id = '42000001-0000-0000-0000-0000000000b1';
select is(
  private.escalate_unclaimed_urgent(now())->>'base',
  '1', 'a report newly marked urgent gets its base alert');
select is(
  pg_temp.broadcasts('42000001-0000-0000-0000-0000000000b1', 1),
  1, 'exactly one');

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. The wider ring's audience
-- ═════════════════════════════════════════════════════════════════════════════
-- About 111 km per degree of latitude. A sits on the report, B 12 km out,
-- C 30 km out, D 12 km out but wants no escalated alerts, E 5 km out with a
-- 3 km radius for ordinary alerts, F 12 km out with push switched off.
delete from public.device_push_tokens where user_id::text like '42000000-%';
insert into public.device_push_tokens
  (user_id, token, last_known_location, notify_radius_m, escalation_radius_m, push_enabled) values
  ('42000000-0000-0000-0000-000000000002', 'ExpoPushToken[cl-A]',
   st_setsrid(st_makepoint(-73, 40.000), 4326)::geography, 8000, 20000, true),
  ('42000000-0000-0000-0000-000000000002', 'ExpoPushToken[cl-B]',
   st_setsrid(st_makepoint(-73, 40.108), 4326)::geography, 8000, 20000, true),
  ('42000000-0000-0000-0000-000000000002', 'ExpoPushToken[cl-C]',
   st_setsrid(st_makepoint(-73, 40.270), 4326)::geography, 8000, 20000, true),
  ('42000000-0000-0000-0000-000000000003', 'ExpoPushToken[cl-D]',
   st_setsrid(st_makepoint(-73, 40.108), 4326)::geography, 8000, 8000, true),
  ('42000000-0000-0000-0000-000000000003', 'ExpoPushToken[cl-E]',
   st_setsrid(st_makepoint(-73, 40.045), 4326)::geography, 3000, 20000, true),
  ('42000000-0000-0000-0000-000000000004', 'ExpoPushToken[cl-F]',
   st_setsrid(st_makepoint(-73, 40.108), 4326)::geography, 8000, 20000, false);

select results_eq(
  $$select token from public.tokens_in_ring(40, -73, 8000, 20000, null)
     where token like 'ExpoPushToken[cl-%' order by token$$,
  $$values ('ExpoPushToken[cl-B]'), ('ExpoPushToken[cl-E]')$$,
  'the ring reaches only devices the base alert missed, as far as each allows');
select results_eq(
  $$select token from public.tokens_in_ring(40, -73, 8000, 20000,
       '42000000-0000-0000-0000-000000000003')
     where token like 'ExpoPushToken[cl-%' order by token$$,
  $$values ('ExpoPushToken[cl-B]')$$,
  'the reporter''s own devices are left out');
select ok(
  not has_function_privilege('authenticated',
    'public.tokens_in_ring(double precision, double precision, integer, integer, uuid)', 'EXECUTE'),
  'clients cannot list devices');

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. The job runner
-- ═════════════════════════════════════════════════════════════════════════════
delete from private.job_runs;
delete from net.http_request_queue;

select lives_ok($$select private.run_job('claim_leases')$$, 'a scheduled job runs');
select results_eq(
  $$select ok, error is null, result ? 'expired' and result ? 'warned'
      from private.job_runs where job = 'claim_leases'$$,
  $$values (true, true, true)$$,
  'the run is logged with its result');

select lives_ok($$select private.run_job('no_such_job')$$, 'a failing job does not raise');
select results_eq(
  $$select ok, error from private.job_runs where job = 'no_such_job'$$,
  $$values (false, 'Unknown job no_such_job')$$,
  'the failure is logged with its error');
select is(
  pg_temp.pushes('ops_job_failed', '42000000-0000-0000-0000-000000000003'),
  1, 'the moderator is alerted when a job fails');
select private.run_job('no_such_job');
select is(
  pg_temp.pushes('ops_job_failed', '42000000-0000-0000-0000-000000000003'),
  1, 'a job that keeps failing alerts once, not on every run');

set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000003');
select results_eq(
  $$select job, last_ok, failures_24h from public.get_job_health() order by job$$,
  $$values ('claim_leases', true, 0::bigint), ('no_such_job', false, 2::bigint)$$,
  'a moderator can see which jobs are healthy');
reset role;

select is(
  (select count(*)::int from cron.job
    where jobname in ('guardians-claim-leases', 'guardians-urgent-escalation',
                      'guardians-prune-job-runs')),
  3, 'the three jobs are scheduled');

select ok(
  not has_function_privilege('authenticated', 'public.maintain_claim_lease()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.renew_claim_on_activity()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.set_sighting_updated_at()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_lease(public.cat_status)', 'EXECUTE'),
  'the lease triggers and settings are not client RPCs');

-- A reporter editing their own report still works through the lease triggers.
set local role authenticated;
select pg_temp.act_as('42000000-0000-0000-0000-000000000001');
select lives_ok(
  $$update public.sightings set description = 'Seen again near the bins'
     where id = '42000001-0000-0000-0000-0000000000a3'$$,
  'a reporter can still edit their own report');
reset role;

select * from finish();
rollback;
