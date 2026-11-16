-- pgTAP tests for alert preferences, the notification inbox and the
-- reporter's feedback loop (migration 0043; PRD-2.0 R1.3, R1.5, R1.9):
--   1. preferences are the owner's, written only through the RPC, validated,
--      coarsened, and a pinned home is not moved by the device;
--   2. an urgent broadcast reaches exactly the people whose area, radius,
--      duty and alert choices cover it; quiet hours keep the entry but not
--      the push; nobody who blocked the reporter, and never the reporter;
--   3. the wider ring reaches only people the base alert did not;
--   4. every alert lands in the inbox whether or not the person has push, the
--      inbox is private, and read state changes only through the RPC;
--   5. the reporter gets exactly one entry for each state change of their
--      report, and none for their own actions;
--   6. old entries are pruned by the scheduled job.
--
-- Run with:  supabase test db

begin;
select plan(58);

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, true);
  select set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.inbox(p_user uuid, p_kind text, p_sighting uuid) returns int language sql as $$
  select count(*)::int from public.notifications n
   where n.user_id = p_user and n.kind = p_kind and n.sighting_id is not distinct from p_sighting;
$$;

-- Queued calls to send-push for one urgent broadcast step.
create function pg_temp.batch_calls(p_sighting uuid, p_step int) returns int language sql as $$
  select count(*)::int
    from net.http_request_queue q,
         lateral (select convert_from(q.body, 'UTF8')::jsonb as b) x
   where x.b->>'type' = 'urgent_sighting'
     and x.b->>'sighting_id' = p_sighting::text
     and (x.b->>'escalation_step')::int = p_step
     and x.b ? 'batch_id';
$$;

update private.push_config set value = 'http://push.invalid/functions/v1/send-push'
 where key = 'edge_function_url';
update private.push_config set value = 'test-secret' where key = 'webhook_secret';
delete from net.http_request_queue;
alter table public.sighting_updates disable trigger sighting_updates_rate;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- 01 reporter R, 02 guardian G, 03 quiet Q, 04 off duty O, 05 far F,
-- 06 opted out of urgent U, 07 blocked the reporter B, 08 small radius S,
-- 09 ring W. Nobody here has a push token.
insert into auth.users (id, email)
select ('43000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'ai-' || i || '@example.test'
from generate_series(1, 9) i
on conflict do nothing;

-- Reports sit at (40, -73). 0.03° of latitude is ~3.3 km, 0.11° ~12 km,
-- 0.5° ~55 km.
insert into public.alert_preferences
  (user_id, home_location, radius_m, wider_radius_m, on_duty, urgent_alerts, quiet_start, quiet_end, time_zone)
values
  ('43000000-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-73, 40), 4326),    8000, 20000, true,  true,  null, null, 'UTC'),
  ('43000000-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-73, 40), 4326),    8000, 20000, true,  true,  null, null, 'UTC'),
  ('43000000-0000-0000-0000-000000000003', st_setsrid(st_makepoint(-73, 40), 4326),    8000, 20000, true,  true,
     ((now() at time zone 'UTC') - interval '1 hour')::time,
     ((now() at time zone 'UTC') + interval '1 hour')::time, 'UTC'),
  ('43000000-0000-0000-0000-000000000004', st_setsrid(st_makepoint(-73, 40), 4326),    8000, 20000, false, true,  null, null, 'UTC'),
  ('43000000-0000-0000-0000-000000000005', st_setsrid(st_makepoint(-73, 40.5), 4326),  8000, 20000, true,  true,  null, null, 'UTC'),
  ('43000000-0000-0000-0000-000000000006', st_setsrid(st_makepoint(-73, 40), 4326),    8000, 20000, true,  false, null, null, 'UTC'),
  ('43000000-0000-0000-0000-000000000007', st_setsrid(st_makepoint(-73, 40), 4326),    8000, 20000, true,  true,  null, null, 'UTC'),
  ('43000000-0000-0000-0000-000000000008', st_setsrid(st_makepoint(-73, 40.03), 4326), 1000, 20000, true,  true,  null, null, 'UTC'),
  ('43000000-0000-0000-0000-000000000009', st_setsrid(st_makepoint(-73, 40.11), 4326), 8000, 20000, true,  true,  null, null, 'UTC')
on conflict (user_id) do update set
  home_location = excluded.home_location, radius_m = excluded.radius_m,
  wider_radius_m = excluded.wider_radius_m, on_duty = excluded.on_duty,
  urgent_alerts = excluded.urgent_alerts, quiet_start = excluded.quiet_start,
  quiet_end = excluded.quiet_end, time_zone = excluded.time_zone;

insert into public.user_blocks (blocker_id, blocked_id)
values ('43000000-0000-0000-0000-000000000007', '43000000-0000-0000-0000-000000000001');

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Preferences
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.act_as('43000000-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.alert_preferences),
  1, 'a user sees only their own preferences');
select throws_ok(
  $$update public.alert_preferences set radius_m = 50000$$,
  '42501', null, 'preferences cannot be written directly');
select throws_ok(
  $$insert into public.alert_preferences (user_id) values ('43000000-0000-0000-0000-000000000005')$$,
  '42501', null, 'nobody can create preferences for someone else');
select throws_ok(
  $$select public.set_alert_preferences(true, true, 100, 20000, 'UTC')$$,
  'P0001', 'Alert radius must be between 0.5 and 50 km', 'a radius below 500 m is refused');
select throws_ok(
  $$select public.set_alert_preferences(true, true, 8000, 20000, 'UTC', '22:00', null)$$,
  'P0001', 'Quiet hours need both a start and an end', 'half a quiet window is refused');
select throws_ok(
  $$select public.set_alert_preferences(true, true, 8000, 20000, 'Mars/Olympus', '22:00', '07:00')$$,
  'P0001', 'Unknown time zone', 'an unknown time zone is refused when quiet hours need it');
select is(
  (select time_zone from public.set_alert_preferences(true, true, 8000, 20000, 'Mars/Olympus')),
  'UTC', 'without quiet hours an unknown time zone saves as UTC');
select throws_ok(
  $$select public.set_alert_preferences(true, true, 8000, 20000, 'UTC', null, null, 95, 0)$$,
  'P0001', 'Invalid coordinates', 'impossible coordinates are refused');

select lives_ok(
  $$select public.set_alert_preferences(true, true, 5000, 15000, 'America/New_York',
      '22:00', '07:00', 40.123456, -73.987654)$$,
  'a Guardian sets their alert area, radius and quiet hours');
select is(
  (select array[home_lat, home_lng] from public.alert_preferences),
  array[40.123::float8, -73.988::float8], 'the home area is rounded to ~110 m');
select is(
  (select home_source from public.alert_preferences), 'manual',
  'a home area chosen by the user is pinned');

-- The device reports a new location: a pinned home stays put.
select lives_ok(
  $$select public.upsert_push_token('ExponentPushToken[alertinbox02]', 41.5, -74.5)$$,
  'the device registers for push from elsewhere');
select is(
  (select home_lat from public.alert_preferences), 40.123::float8,
  'a pinned home area is not moved by the device');

-- Setting preferences without a location keeps the pinned home.
select lives_ok(
  $$select public.set_alert_preferences(true, true, 8000, 20000, 'UTC')$$,
  'preferences saved without a location');
select is(
  (select array[home_lat, home_lng] from public.alert_preferences),
  array[40.123::float8, -73.988::float8], 'saving without a location keeps the home area');
reset role;

-- A user who never pinned a home follows their device.
set local role authenticated;
select pg_temp.act_as('43000000-0000-0000-0000-000000000006');
select lives_ok(
  $$select public.upsert_push_token('ExponentPushToken[alertinbox06]', 40.0001, -73.0001)$$,
  'a device registers for push');
select is(
  (select array[home_lat, home_lng] from public.alert_preferences),
  array[40.0::float8, -73.0::float8], 'an unpinned home follows the device');
reset role;

-- Put G back at the reports for the broadcast tests.
update public.alert_preferences
   set home_location = st_setsrid(st_makepoint(-73, 40), 4326), radius_m = 8000, wider_radius_m = 20000
 where user_id = '43000000-0000-0000-0000-000000000002';

select ok(private.in_quiet_hours('22:00', '07:00', 'UTC', '2026-11-15 23:30+00'),
  'a window across midnight covers the late evening');
select ok(private.in_quiet_hours('22:00', '07:00', 'UTC', '2026-11-15 06:59+00'),
  'a window across midnight covers the early morning');
select ok(not private.in_quiet_hours('22:00', '07:00', 'UTC', '2026-11-15 12:00+00'),
  'a window across midnight does not cover midday');
select ok(private.in_quiet_hours('22:00', '07:00', 'America/New_York', '2026-11-16 04:00+00'),
  'quiet hours are read in the person''s own time zone');
select ok(not private.in_quiet_hours('09:00', '09:00', 'UTC', '2026-11-15 09:00+00'),
  'an empty window is never quiet');

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The base broadcast
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.sightings (id, reporter_id, location, needs_urgent_help, title)
values ('43000001-0000-0000-0000-0000000000a1', '43000000-0000-0000-0000-000000000001',
        st_setsrid(st_makepoint(-73, 40), 4326), true, 'Hurt tabby');

select is(
  (select array_agg(user_id order by user_id)::text[] from public.notifications
    where sighting_id = '43000001-0000-0000-0000-0000000000a1' and kind = 'urgent_sighting'),
  array['43000000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-000000000003'],
  'the base alert reaches exactly the on-duty, opted-in people in range who did not block the reporter');
select is(pg_temp.inbox('43000000-0000-0000-0000-000000000001', 'urgent_sighting',
  '43000001-0000-0000-0000-0000000000a1'), 0, 'the reporter is not alerted about their own report');
select is(pg_temp.inbox('43000000-0000-0000-0000-000000000004', 'urgent_sighting',
  '43000001-0000-0000-0000-0000000000a1'), 0, 'a Guardian off duty gets nothing');
select is(pg_temp.inbox('43000000-0000-0000-0000-000000000006', 'urgent_sighting',
  '43000001-0000-0000-0000-0000000000a1'), 0, 'a Guardian who turned urgent alerts off gets nothing');
select is(pg_temp.inbox('43000000-0000-0000-0000-000000000007', 'urgent_sighting',
  '43000001-0000-0000-0000-0000000000a1'), 0, 'someone who blocked the reporter gets nothing');
select is(pg_temp.inbox('43000000-0000-0000-0000-000000000008', 'urgent_sighting',
  '43000001-0000-0000-0000-0000000000a1'), 0, 'someone whose own radius does not reach gets nothing');
select is(pg_temp.inbox('43000000-0000-0000-0000-000000000005', 'urgent_sighting',
  '43000001-0000-0000-0000-0000000000a1'), 0, 'someone far away gets nothing');
select is(
  (select silent from public.notifications
    where user_id = '43000000-0000-0000-0000-000000000003'
      and sighting_id = '43000001-0000-0000-0000-0000000000a1'),
  true, 'inside quiet hours the alert is kept in the inbox without a push');
select is(
  (select silent from public.notifications
    where user_id = '43000000-0000-0000-0000-000000000002'
      and sighting_id = '43000001-0000-0000-0000-0000000000a1'),
  false, 'outside quiet hours the alert is pushed');
select is(pg_temp.batch_calls('43000001-0000-0000-0000-0000000000a1', 1), 1,
  'one call asks send-push to deliver the batch');
select is(
  (select count(distinct batch_id)::int from public.notifications
    where sighting_id = '43000001-0000-0000-0000-0000000000a1'),
  1, 'every entry of one broadcast shares the batch send-push delivers');

-- Nobody in range: nothing to record, nothing to send.
insert into public.sightings (id, reporter_id, location, needs_urgent_help)
values ('43000001-0000-0000-0000-0000000000a2', '43000000-0000-0000-0000-000000000001',
        st_setsrid(st_makepoint(10, 10), 4326), true);
select is(pg_temp.batch_calls('43000001-0000-0000-0000-0000000000a2', 1), 0,
  'a broadcast with no audience queues no call');

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. The wider ring
-- ═════════════════════════════════════════════════════════════════════════════
select private.post_push(jsonb_build_object(
  'type', 'urgent_sighting', 'sighting_id', '43000001-0000-0000-0000-0000000000a1', 'escalation_step', 2));
select is(
  (select array_agg(user_id order by user_id)::text[] from public.notifications
    where sighting_id = '43000001-0000-0000-0000-0000000000a1'
      and kind = 'urgent_sighting' and detail->>'step' = '2'),
  array['43000000-0000-0000-0000-000000000008', '43000000-0000-0000-0000-000000000009'],
  'the ring reaches only people the base alert did not, within their wider radius');

-- send-push delivers a batch to the devices of everyone not in quiet hours.
insert into public.device_push_tokens (user_id, token, push_enabled, urgent_opt_in)
values ('43000000-0000-0000-0000-000000000003', 'ExponentPushToken[alertinbox03]', true, true);
select is(
  (select array_agg(token order by token)::text[] from public.batch_push_tokens((
     select batch_id from public.notifications
      where sighting_id = '43000001-0000-0000-0000-0000000000a1' and detail->>'step' = '1' limit 1))),
  array['ExponentPushToken[alertinbox02]'],
  'a batch is pushed to everyone in it except those in quiet hours');
set local role authenticated;
select throws_ok(
  $$select * from public.batch_push_tokens(gen_random_uuid())$$,
  '42501', null, 'a client cannot list the devices of a broadcast');
reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. The inbox
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.act_as('43000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.notifications), 1,
  'a person with no push token still sees the alert sent to them');
select throws_ok(
  $$update public.notifications set read_at = now()$$,
  '42501', null, 'read state cannot be written directly');
select throws_ok(
  $$insert into public.notifications (user_id, kind) values ('43000000-0000-0000-0000-000000000003', 'new_comment')$$,
  '42501', null, 'nobody can write to an inbox');
select is(public.mark_notifications_read(), 1, 'marking all read changes the unread entry');
select is(public.mark_notifications_read(), 0, 'marking again changes nothing');

select pg_temp.act_as('43000000-0000-0000-0000-000000000009');
select is(
  public.mark_notifications_read(array(
    select id from public.notifications)),
  1, 'a person can mark their own entries read');
reset role;
select is(
  (select count(*)::int from public.notifications
    where user_id = '43000000-0000-0000-0000-000000000002' and read_at is not null),
  0, 'marking read never touches someone else''s inbox');

set local role authenticated;
select pg_temp.act_as('43000000-0000-0000-0000-000000000009');
select is(
  public.mark_notifications_read(array(
    select id from public.notifications where false
    union all
    select '00000000-0000-0000-0000-000000000000'::uuid)),
  0, 'an id that is not yours changes nothing');
select throws_ok(
  $$select private.post_push('{}'::jsonb)$$,
  '42501', null, 'a client cannot send a notification');
reset role;

-- An unconfigured push endpoint loses the push, never the entry.
update private.push_config set value = '' where key = 'edge_function_url';
select private.post_push(jsonb_build_object(
  'event', 'new_comment', 'recipient_user_id', '43000000-0000-0000-0000-000000000004',
  'about_sighting_id', '43000001-0000-0000-0000-0000000000a1'));
select is(pg_temp.inbox('43000000-0000-0000-0000-000000000004', 'new_comment',
  '43000001-0000-0000-0000-0000000000a1'), 1, 'an entry is kept when the push cannot be sent');
update private.push_config set value = 'http://push.invalid/functions/v1/send-push'
 where key = 'edge_function_url';

-- An entry that cannot be recorded never costs the push.
delete from net.http_request_queue;
select private.post_push(jsonb_build_object(
  'event', 'not_an_inbox_kind', 'recipient_user_id', '43000000-0000-0000-0000-000000000004'));
select is((select count(*)::int from net.http_request_queue
           where convert_from(body, 'UTF8')::jsonb->>'event' = 'not_an_inbox_kind'),
  1, 'the push still goes when the entry cannot be recorded');

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. The reporter hears about every state change, once
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.sightings (id, reporter_id, location) values
  ('43000001-0000-0000-0000-0000000000b1', '43000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326)),
  ('43000001-0000-0000-0000-0000000000b2', '43000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326)),
  ('43000001-0000-0000-0000-0000000000b3', '43000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326)),
  ('43000001-0000-0000-0000-0000000000b4', '43000000-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73, 40), 4326));

set local role authenticated;
select pg_temp.act_as('43000000-0000-0000-0000-000000000002');
select public.claim_sighting('43000001-0000-0000-0000-0000000000b1');
select public.update_sighting_status('43000001-0000-0000-0000-0000000000b1', 'in_rescue');
select public.update_sighting_status('43000001-0000-0000-0000-0000000000b1', 'safe');
select public.update_sighting_status('43000001-0000-0000-0000-0000000000b1', 'available');
reset role;
-- Adoption approval is its own RPC; the trigger under test sees the same row change.
select pg_temp.act_as('43000000-0000-0000-0000-000000000002');
update public.sightings set status = 'adopted' where id = '43000001-0000-0000-0000-0000000000b1';

select is(
  (select array_agg(coalesce(detail->>'status', kind) order by coalesce(detail->>'status', kind))::text[]
     from public.notifications
    where user_id = '43000000-0000-0000-0000-000000000001'
      and sighting_id = '43000001-0000-0000-0000-0000000000b1'),
  array['adopted', 'available', 'in_rescue', 'rescue_completed', 'sighting_claimed'],
  'the reporter is told once about each step from claim to adoption (one transaction, so compared as a set)');

set local role authenticated;
select pg_temp.act_as('43000000-0000-0000-0000-000000000002');
select public.claim_sighting('43000001-0000-0000-0000-0000000000b2');
select public.update_sighting_status('43000001-0000-0000-0000-0000000000b2', 'spotted');
select public.claim_sighting('43000001-0000-0000-0000-0000000000b3');
select public.update_sighting_status('43000001-0000-0000-0000-0000000000b3', 'archived');
reset role;

select is(pg_temp.inbox('43000000-0000-0000-0000-000000000001', 'case_status',
  '43000001-0000-0000-0000-0000000000b2'), 1, 'the reporter is told when the Guardian lets the cat go');
select is(
  (select detail->>'status' from public.notifications
    where user_id = '43000000-0000-0000-0000-000000000001'
      and sighting_id = '43000001-0000-0000-0000-0000000000b3' and kind = 'case_status'),
  'archived', 'the reporter is told when the case is closed');

-- A lapse is told by the lease job alone, not twice.
set local role authenticated;
select pg_temp.act_as('43000000-0000-0000-0000-000000000002');
select public.claim_sighting('43000001-0000-0000-0000-0000000000b4');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
select private.expire_stale_claims(now() + interval '25 hours');
select is(
  (select array_agg(kind order by kind)::text[] from public.notifications
    where user_id = '43000000-0000-0000-0000-000000000001'
      and sighting_id = '43000001-0000-0000-0000-0000000000b4'),
  array['claim_reopened', 'sighting_claimed'], 'a lapsed claim reaches the reporter once');
select is(pg_temp.inbox('43000000-0000-0000-0000-000000000002', 'claim_expired',
  '43000001-0000-0000-0000-0000000000b4'), 1, 'the Guardian finds the lapse in the inbox');

-- The reporter's own action is not news to them.
set local role authenticated;
select pg_temp.act_as('43000000-0000-0000-0000-000000000001');
select public.update_sighting_status('43000001-0000-0000-0000-0000000000b4', 'archived');
reset role;
select is(
  (select count(*)::int from public.notifications
    where user_id = '43000000-0000-0000-0000-000000000001'
      and sighting_id = '43000001-0000-0000-0000-0000000000b4' and kind = 'case_status'),
  0, 'the reporter is not told about their own change');

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Retention
-- ═════════════════════════════════════════════════════════════════════════════
update public.notifications set created_at = now() - interval '91 days'
 where user_id = '43000000-0000-0000-0000-000000000003';
select is(private.run_job('prune_notifications')->>'pruned', '1',
  'the scheduled job removes entries older than 90 days');
select is(
  (select count(*)::int from public.notifications where user_id = '43000000-0000-0000-0000-000000000009'),
  1, 'newer entries stay');
select ok(
  (select ok from private.job_runs where job = 'prune_notifications' order by id desc limit 1),
  'the prune run is logged as healthy');
select is(
  (select count(*)::int from cron.job where jobname = 'guardians-prune-notifications'),
  1, 'the prune job is scheduled');

select * from finish();
rollback;
