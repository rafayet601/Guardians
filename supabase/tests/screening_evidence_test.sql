begin;
select plan(9);
insert into auth.users(id,email) values
 ('66666666-1111-1111-1111-111111111111','screening@example.test');
insert into public.adopter_screenings(
 user_id,full_name,dob,phone,address_line,city,postal,housing,
 status,id_status,verified_at,expires_at,id_session_id,id_doc_paths
) values (
 '66666666-1111-1111-1111-111111111111','Test Applicant','1990-01-01','555-0100',
 '1 Main St','Test City','12345','own','approved','verified',now(),now()+interval '1 year',
 'session-old',array['66666666-1111-1111-1111-111111111111/id.jpg']
);
select ok(public.is_adopter_cleared('66666666-1111-1111-1111-111111111111'),'initial approval is valid');
update public.adopter_screenings set consent_at=now(),updated_at=now();
select ok(public.is_adopter_cleared('66666666-1111-1111-1111-111111111111'),'timestamp-only update preserves approval');
update public.adopter_screenings set address_line='2 Main St';
select is((select status::text from public.adopter_screenings where user_id='66666666-1111-1111-1111-111111111111'),'pending','address edit resets approval');
select is((select id_status::text from public.adopter_screenings where user_id='66666666-1111-1111-1111-111111111111'),'pending','address edit resets verification');
select ok((select verified_at is null and expires_at is null and id_session_id is null from public.adopter_screenings where user_id='66666666-1111-1111-1111-111111111111'),'stale verification metadata is cleared');
update public.adopter_screenings set status='approved',id_status='verified',verified_at=now(),expires_at=now()+interval '1 year',id_session_id='session-new';
select ok(public.is_adopter_cleared('66666666-1111-1111-1111-111111111111'),'moderator can approve unchanged evidence');
update public.adopter_screenings set id_doc_paths=array['66666666-1111-1111-1111-111111111111/replacement.jpg'];
select ok(not public.is_adopter_cleared('66666666-1111-1111-1111-111111111111'),'document replacement invalidates clearance');
update public.adopter_screenings set status='approved',id_status='verified',verified_at=now(),expires_at=now()+interval '1 year';
update public.adopter_screenings set household_children=1;
select ok(not public.is_adopter_cleared('66666666-1111-1111-1111-111111111111'),'household change invalidates clearance');
update public.adopter_screenings set status='rejected',cruelty_attestation=false,phone='555-0200';
select is((select status::text from public.adopter_screenings where user_id='66666666-1111-1111-1111-111111111111'),'rejected','evidence reset never promotes a rejection');
select * from finish();
rollback;
