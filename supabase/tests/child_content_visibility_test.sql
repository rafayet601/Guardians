begin;
select no_plan();
-- Creating a sighting also writes a 'system' timeline row, so the positive
-- comment checks below count type='comment' only.
insert into auth.users(id,email) values
 ('41000001-0000-0000-0000-000000000001','parent-reporter@example.test'),
 ('41000001-0000-0000-0000-000000000002','parent-guardian@example.test'),
 ('41000001-0000-0000-0000-000000000003','parent-stranger@example.test'),
 ('41000001-0000-0000-0000-000000000004','parent-moderator@example.test');
update public.profiles set is_moderator=true
where id='41000001-0000-0000-0000-000000000004';
insert into public.sightings(id,reporter_id,claimed_by,location,is_hidden) values
 ('41000002-0000-0000-0000-000000000001','41000001-0000-0000-0000-000000000001',
  '41000001-0000-0000-0000-000000000002',st_setsrid(st_makepoint(-73,40),4326),true),
 ('41000002-0000-0000-0000-000000000002','41000001-0000-0000-0000-000000000001',
  null,st_setsrid(st_makepoint(-73,40),4326),false);
insert into public.sighting_photos(sighting_id,uploaded_by,url)
select id,'41000001-0000-0000-0000-000000000001','https://example.test/synthetic.jpg'
from public.sightings where id in
 ('41000002-0000-0000-0000-000000000001','41000002-0000-0000-0000-000000000002');
insert into public.sighting_updates(sighting_id,author_id,type,body)
select id,'41000001-0000-0000-0000-000000000001','comment','Synthetic comment'
from public.sightings where id in
 ('41000002-0000-0000-0000-000000000001','41000002-0000-0000-0000-000000000002');

set local role anon;
select is((select count(*)::int from public.sighting_photos where sighting_id in
 ('41000002-0000-0000-0000-000000000001','41000002-0000-0000-0000-000000000002')),0,
 'anonymous callers cannot enumerate photo rows');
select is((select count(*)::int from public.sighting_updates where sighting_id in
 ('41000002-0000-0000-0000-000000000001','41000002-0000-0000-0000-000000000002')),0,
 'anonymous callers cannot enumerate comment rows');
select throws_matching($$select public.can_access_sighting_content('41000002-0000-0000-0000-000000000001')$$,
 'permission denied','anonymous callers cannot execute the visibility helper');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','41000001-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.sighting_photos
 where sighting_id='41000002-0000-0000-0000-000000000001'),0,'stranger cannot enumerate hidden-parent photos');
select is((select count(*)::int from public.sighting_updates
 where sighting_id='41000002-0000-0000-0000-000000000001'),0,'stranger cannot enumerate hidden-parent comments');
select is((select count(*)::int from public.sighting_photos
 where sighting_id='41000002-0000-0000-0000-000000000002'),1,'visible-parent photos still load');
select is((select count(*)::int from public.sighting_updates
 where type='comment' and sighting_id='41000002-0000-0000-0000-000000000002'),1,'visible-parent comments still load');
select throws_matching($$insert into public.sighting_photos(sighting_id,uploaded_by,url)
 values('41000002-0000-0000-0000-000000000001','41000001-0000-0000-0000-000000000003',
 'https://example.test/rejected.jpg')$$,'row-level security','stranger cannot attach to a hidden report');
select throws_matching($$insert into public.sighting_updates(sighting_id,author_id,type,body)
 values('41000002-0000-0000-0000-000000000001','41000001-0000-0000-0000-000000000003',
 'comment','Rejected comment')$$,'row-level security','stranger cannot comment on a hidden report');

select set_config('request.jwt.claim.sub','41000001-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.sighting_photos
 where sighting_id='41000002-0000-0000-0000-000000000001'),1,'reporter can read hidden-parent photos');
select is((select count(*)::int from public.sighting_updates
 where type='comment' and sighting_id='41000002-0000-0000-0000-000000000001'),1,'reporter can read hidden-parent comments');
select set_config('request.jwt.claim.sub','41000001-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.sighting_photos
 where sighting_id='41000002-0000-0000-0000-000000000001'),1,'assigned Guardian can read hidden-parent photos');
select is((select count(*)::int from public.sighting_updates
 where type='comment' and sighting_id='41000002-0000-0000-0000-000000000001'),1,'assigned Guardian can read hidden-parent comments');
select set_config('request.jwt.claim.sub','41000001-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.sighting_photos
 where sighting_id='41000002-0000-0000-0000-000000000001'),1,'moderator can inspect hidden-parent photos');
select is((select count(*)::int from public.sighting_updates
 where type='comment' and sighting_id='41000002-0000-0000-0000-000000000001'),1,'moderator can inspect hidden-parent comments');

select set_config('request.jwt.claim.sub','41000001-0000-0000-0000-000000000003',true);
insert into public.user_blocks(blocker_id,blocked_id) values
 ('41000001-0000-0000-0000-000000000003','41000001-0000-0000-0000-000000000001');
select is((select count(*)::int from public.sighting_photos
 where sighting_id='41000002-0000-0000-0000-000000000002'),0,'blocking reporter hides photos by parent');
select is((select count(*)::int from public.sighting_updates
 where sighting_id='41000002-0000-0000-0000-000000000002'),0,'blocking reporter hides comments by parent');
select throws_matching($$insert into public.sighting_updates(sighting_id,author_id,type,body)
 values('41000002-0000-0000-0000-000000000002','41000001-0000-0000-0000-000000000003',
 'comment','Rejected blocked-parent comment')$$,'row-level security','blocked-parent comment insertion is denied');
reset role;

select ok(not has_function_privilege('authenticated','public.enforce_photo_cap()','EXECUTE'),
 'photo-limit trigger is not a client RPC');
select * from finish();
rollback;
