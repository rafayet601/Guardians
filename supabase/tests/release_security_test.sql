begin;
select plan(10);
insert into auth.users(id,email) values
 ('44444444-1111-1111-1111-111111111111','release-a@example.test'),
 ('44444444-2222-2222-2222-222222222222','release-b@example.test');
set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-1111-1111-1111-111111111111',true);
select lives_ok($$select public.upsert_push_token('ExpoPushToken[release-device]',40,-73)$$,'register A');
select set_config('request.jwt.claim.sub','44444444-2222-2222-2222-222222222222',true);
select lives_ok($$select public.upsert_push_token('ExpoPushToken[release-device]',null,null)$$,'register B on same device');
reset role;
select is((select count(*)::int from public.device_push_tokens where token='ExpoPushToken[release-device]'),1,'one owner per device');
select is((select user_id from public.device_push_tokens where token='ExpoPushToken[release-device]'),'44444444-2222-2222-2222-222222222222'::uuid,'new owner replaces old');
select ok((select last_known_location is null from public.device_push_tokens where token='ExpoPushToken[release-device]'),'no previous owner location inherited');
set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-1111-1111-1111-111111111111',true);
select public.unregister_push_token('ExpoPushToken[release-device]');
reset role;
select is((select count(*)::int from public.device_push_tokens where token='ExpoPushToken[release-device]'),1,'old owner cannot unregister new owner');
set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-2222-2222-2222-222222222222',true);
select public.unregister_push_token('ExpoPushToken[release-device]');
reset role;
select is((select count(*)::int from public.device_push_tokens where token='ExpoPushToken[release-device]'),0,'current owner can unregister');
select ok(not has_table_privilege('authenticated','public.device_push_tokens','INSERT'),'direct registration cannot bypass RPC');
insert into public.sightings(id,reporter_id,location) values
 ('55555555-1111-1111-1111-111111111111','44444444-1111-1111-1111-111111111111',st_setsrid(st_makepoint(-73,40),4326));
insert into public.embeddings(owner_type,owner_id,kind) values('sighting','55555555-1111-1111-1111-111111111111','photo');
delete from auth.users where id='44444444-1111-1111-1111-111111111111';
select is((select count(*)::int from public.sightings where id='55555555-1111-1111-1111-111111111111'),0,'account deletion removes authored reports');
select is((select count(*)::int from public.embeddings where owner_id='55555555-1111-1111-1111-111111111111'),0,'account deletion removes derived embeddings');
select * from finish();
rollback;
