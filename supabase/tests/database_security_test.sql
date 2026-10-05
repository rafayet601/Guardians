-- Behavioral regressions for 0039. All fixtures are rolled back.
begin;
select no_plan();

insert into auth.users(id, email) values
 ('39000001-0000-0000-0000-000000000001','security-one@example.test'),
 ('39000001-0000-0000-0000-000000000002','security-two@example.test'),
 ('39000001-0000-0000-0000-000000000003','security-mod@example.test'),
 ('39000001-0000-0000-0000-000000000004','security-rate@example.test');
update public.profiles set is_moderator = true where id = '39000001-0000-0000-0000-000000000003';
insert into public.sightings(id, reporter_id, location, is_hidden) values
 ('39000002-0000-0000-0000-000000000001','39000001-0000-0000-0000-000000000002',st_setsrid(st_makepoint(-73,40),4326),false),
 ('39000002-0000-0000-0000-000000000002','39000001-0000-0000-0000-000000000002',st_setsrid(st_makepoint(-73,40),4326),true),
 ('39000002-0000-0000-0000-000000000003','39000001-0000-0000-0000-000000000002',st_setsrid(st_makepoint(-73,40),4326),false);
insert into public.adopter_screenings(
 user_id, full_name, dob, phone, address_line, city, postal, housing,
 status, id_status, verified_at, expires_at, id_doc_paths
) values (
 '39000001-0000-0000-0000-000000000001','Security One','1990-01-01','555-0100',
 '1 Main St','Town','12345','own','approved','verified',now(),now()+interval '1 year',
 array['39000001-0000-0000-0000-000000000001/id.jpg']
);
insert into storage.objects(bucket_id,name,owner,owner_id) values
 ('screening-docs','39000001-0000-0000-0000-000000000001/id.jpg','39000001-0000-0000-0000-000000000001','39000001-0000-0000-0000-000000000001'),
 ('screening-docs','39000001-0000-0000-0000-000000000001/unused.jpg','39000001-0000-0000-0000-000000000001','39000001-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','39000001-0000-0000-0000-000000000001',true);
select throws_matching($$insert into public.sightings(reporter_id,location,status,claimed_by,created_at)
 values ('39000001-0000-0000-0000-000000000001',st_setsrid(st_makepoint(-73,40),4326),'adopted',
 '39000001-0000-0000-0000-000000000001',now()-interval '2 days')$$,
 'permission denied','a client cannot forge lifecycle and timestamps through table INSERT');
select throws_matching($$insert into public.lost_cats(owner_id,location,photo_url,last_seen_at,status)
 values ('39000001-0000-0000-0000-000000000001',st_setsrid(st_makepoint(-73,40),4326),'https://example.test/cat.jpg',now(),'matched')$$,
 'permission denied','a client cannot bypass lost-cat status through table INSERT');
select lives_ok($$select public.create_sighting(40,-73,'Normal report')$$,'the sighting creation RPC still works');
select lives_ok($$select public.create_lost_cat(40,-73,now(),'Lost cat',null,'https://example.test/cat.jpg')$$,
 'the lost-cat creation RPC still works');
select throws_matching($$insert into public.sighting_updates(sighting_id,author_id,type,body,created_at)
 values ('39000002-0000-0000-0000-000000000001','39000001-0000-0000-0000-000000000001','comment','backdated',now()-interval '2 days')$$,
 'permission denied','comments cannot backdate their rate-limit timestamps');
select lives_ok($$insert into public.sighting_updates(sighting_id,author_id,type,body)
 values ('39000002-0000-0000-0000-000000000001','39000001-0000-0000-0000-000000000001','comment','Normal comment')$$,
 'normal app comment columns remain writable');
select lives_ok($$insert into public.sighting_photos(sighting_id,uploaded_by,url)
 values ('39000002-0000-0000-0000-000000000001','39000001-0000-0000-0000-000000000001','https://example.test/cat.jpg')$$,
 'normal app photo columns remain writable');
select throws_matching($$insert into public.sighting_photos(sighting_id,uploaded_by,url,created_at)
 values ('39000002-0000-0000-0000-000000000001','39000001-0000-0000-0000-000000000001','https://example.test/cat.jpg',now()-interval '2 days')$$,
 'permission denied','photo timestamps remain server-owned');

select throws_ok($$select public.claim_sighting('39000002-0000-0000-0000-000000000002')$$,
 'Sighting not found','a stranger cannot claim a hidden report to obtain its precise coordinates');
select lives_ok($$select public.claim_sighting('39000002-0000-0000-0000-000000000001')$$,
 'a guardian can still claim a visible report');
select ok((public.get_sighting_detail('39000002-0000-0000-0000-000000000001')->>'is_precise')::boolean,
 'the assigned guardian still sees the exact rescue location');
insert into public.user_blocks(blocker_id,blocked_id) values
 ('39000001-0000-0000-0000-000000000001','39000001-0000-0000-0000-000000000002');
select throws_ok($$select public.get_sighting_detail('39000002-0000-0000-0000-000000000003')$$,
 'Sighting not found','detail RPC honors blocked reporters');
select throws_ok($$select public.claim_sighting('39000002-0000-0000-0000-000000000003')$$,
 'Sighting not found','claim RPC honors blocked reporters');
select set_config('request.jwt.claim.sub','39000001-0000-0000-0000-000000000003',true);
select lives_ok($$select public.get_sighting_detail('39000002-0000-0000-0000-000000000002')$$,
 'moderators retain access to hidden details');
select set_config('request.jwt.claim.sub','39000001-0000-0000-0000-000000000002',true);
select lives_ok($$select public.claim_sighting('39000002-0000-0000-0000-000000000002')$$,
 'a reporter can still coordinate their own hidden report');

-- Each call consumes a reservation even if no provider usage is ever logged.
select set_config('request.jwt.claim.sub','39000001-0000-0000-0000-000000000001',true);
select ok(public.check_ai_rate_limit('adoption_copy',1),'first AI request reserves capacity');
select ok(not public.check_ai_rate_limit('adoption_copy',1),'a second AI request is denied before any usage is logged');
select ok(public.check_ai_rate_limit('report_autofill',1),'different AI features have independent capacity');
select ok(not public.check_ai_rate_limit('unrecognized_feature',120),'unrecognized features cannot allocate quota rows');
select ok(not public.check_ai_rate_limit('embed',null),'null limits fail closed');
select ok(not public.check_ai_rate_limit('embed',0),'nonpositive limits fail closed');
select set_config('request.jwt.claim.sub','39000001-0000-0000-0000-000000000002',true);
select ok(public.check_ai_rate_limit('adoption_copy',1),'one account cannot consume another account quota');
select is((select count(*)::integer from generate_series(1,12)
 where public.check_ai_rate_limit('adoption_copy',1000)),9,
 'a caller-supplied ceiling cannot exceed the server feature ceiling of ten');
select throws_matching($$delete from private.request_rate_windows$$,'permission denied','clients cannot reset quota reservations');
select throws_matching($$select public.submit_adopter_screening(jsonb_build_object(
 'full_name','Security Two','dob','1990-01-01','phone','555-0100',
 'address_line','2 Main St','city','Town','postal','12345','housing','own',
 'consent',true,'cruelty_attestation',true,'home_visit_consent',true,
 'id_doc_paths',jsonb_build_array('39000001-0000-0000-0000-000000000001/id.jpg')))
 $$,'valid paths in your own upload folder','the public questionnaire RPC rejects another applicant document');
select lives_ok($$select public.submit_adopter_screening(jsonb_build_object(
 'full_name','Security Two','dob','1990-01-01','phone','555-0100',
 'address_line','2 Main St','city','Town','postal','12345','housing','own',
 'consent',true,'cruelty_attestation',true,'home_visit_consent',true,
 'id_doc_paths','[]'::jsonb))$$,'an incomplete questionnaire can still be saved before uploading documents');
reset role;
select is((select count(*)::integer from public.ai_usage),0,'quota reservation does not forge billing telemetry');
update private.request_rate_windows set arrivals = array[now()-interval '2 hours']
 where user_id='39000001-0000-0000-0000-000000000001' and action='ai:adoption_copy';
set local role authenticated;
select set_config('request.jwt.claim.sub','39000001-0000-0000-0000-000000000001',true);
select ok(public.check_ai_rate_limit('adoption_copy',1),'expired quota capacity becomes available');
reset role;
select is((select cardinality(arrivals) from private.request_rate_windows
 where user_id='39000001-0000-0000-0000-000000000001' and action='ai:adoption_copy'),1,
 'expired timestamps are removed instead of accumulating');

-- Validation applies to trusted writes as well as the public questionnaire RPC.
set local role service_role;
select throws_matching($$update public.adopter_screenings
 set id_doc_paths=array['39000001-0000-0000-0000-000000000002/id.jpg']
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'valid paths in your own upload folder','service-role writes cannot attach another applicant ID document');
select throws_matching($$update public.adopter_screenings
 set id_doc_paths=array['39000001-0000-0000-0000-000000000001/../other.jpg']
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'valid paths in your own upload folder','path traversal is rejected');
select throws_matching($$update public.adopter_screenings
 set id_doc_paths=array['39000001-0000-0000-0000-000000000001/%2e%2e/other.jpg']
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'valid paths in your own upload folder','encoded paths are rejected');
select throws_matching($$update public.adopter_screenings
 set id_doc_paths=array['39000001-0000-0000-0000-000000000001//id.jpg']
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'valid paths in your own upload folder','empty path segments are rejected');
select throws_matching($$update public.adopter_screenings
 set id_doc_paths=array['39000001-0000-0000-0000-000000000001/id.jpg?alias']
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'valid paths in your own upload folder','query delimiters cannot alias a different storage object');
select throws_matching($$update public.adopter_screenings
 set id_doc_paths=array['39000001-0000-0000-0000-000000000001/id.jpg#alias']
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'valid paths in your own upload folder','fragment delimiters cannot alias a different storage object');
select throws_matching($$update public.adopter_screenings
 set id_doc_paths=array['39000001-0000-0000-0000-000000000001/id.jpg ']
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'valid paths in your own upload folder','trailing spaces cannot alias a different storage object');
select throws_matching($$update public.adopter_screenings set id_doc_paths=array[null::text]
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'valid paths in your own upload folder','null document entries are rejected');
select throws_matching($$update public.adopter_screenings
 set id_doc_paths=array_fill('39000001-0000-0000-0000-000000000001/id.jpg'::text,array[5])
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'At most four','document arrays are bounded');
reset role;

-- Storage API sets this flag before applying its DELETE query.
select set_config('storage.allow_delete_query','true',true);
set local role authenticated;
update storage.objects set metadata='{"modified":true}'::jsonb
 where bucket_id='screening-docs' and name='39000001-0000-0000-0000-000000000001/id.jpg';
select ok((select metadata is null from storage.objects
 where bucket_id='screening-docs' and name='39000001-0000-0000-0000-000000000001/id.jpg'),
 'referenced ID uploads cannot be overwritten in place');
delete from storage.objects
 where bucket_id='screening-docs' and name='39000001-0000-0000-0000-000000000001/id.jpg';
select is((select count(*)::integer from storage.objects
 where bucket_id='screening-docs' and name='39000001-0000-0000-0000-000000000001/id.jpg'),1,
 'referenced ID uploads cannot be deleted by the applicant');
delete from storage.objects
 where bucket_id='screening-docs' and name='39000001-0000-0000-0000-000000000001/unused.jpg';
select is((select count(*)::integer from storage.objects
 where bucket_id='screening-docs' and name='39000001-0000-0000-0000-000000000001/unused.jpg'),0,
 'unused uploads can still be cleaned up');
reset role;
set local role service_role;
select lives_ok($$update public.adopter_screenings
 set id_doc_paths=array['39000001-0000-0000-0000-000000000001/replacement.jpg']
 where user_id='39000001-0000-0000-0000-000000000001'$$,
 'trusted writes can store valid replacement evidence');
reset role;
select ok(not public.is_adopter_cleared('39000001-0000-0000-0000-000000000001'),
 'replacement evidence resets the existing approval');
set local role service_role;
insert into storage.objects(bucket_id,name) values ('screening-docs','39000001-0000-0000-0000-000000000001/replacement.jpg');
delete from storage.objects
 where bucket_id='screening-docs' and name='39000001-0000-0000-0000-000000000001/replacement.jpg';
select is((select count(*)::integer from storage.objects
 where bucket_id='screening-docs' and name='39000001-0000-0000-0000-000000000001/replacement.jpg'),0,
 'service-role account cleanup still removes referenced uploads');
reset role;

-- Deleting reports must not refund the limit while their earned points remain.
select set_config('request.jwt.claim.sub','39000001-0000-0000-0000-000000000004',true);
set local role authenticated;
do $$ declare n integer; s public.sightings; begin
 for n in 1..5 loop
   s := public.create_sighting(40,-73,'Rate test');
   delete from public.sightings where id=s.id;
 end loop;
end $$;
select throws_matching($$select public.create_sighting(40,-73,'Sixth report')$$,
 'Too many requests','deleting reports does not bypass the report quota');
reset role;
select set_config('request.jwt.claim.sub','',true);
delete from auth.users where id='39000001-0000-0000-0000-000000000004';
select is((select count(*)::integer from private.request_rate_windows
 where user_id='39000001-0000-0000-0000-000000000004'),0,'account deletion removes quota state');

select * from finish();
rollback;
