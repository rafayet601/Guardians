-- 0044: no SECURITY DEFINER function of ours is callable without signing in.
begin;
select plan(5);

select ok(not has_function_privilege('anon', 'public.get_my_screening()', 'EXECUTE'),
  'anon cannot read a screening');
select ok(not has_function_privilege('anon', 'public.submit_adopter_screening(jsonb)', 'EXECUTE'),
  'anon cannot submit a screening');
select ok(not has_function_privilege('anon', 'public.is_adopter_cleared(uuid)', 'EXECUTE'),
  'anon cannot ask whether someone is cleared');
select ok(has_function_privilege('authenticated', 'public.get_my_screening()', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.submit_adopter_screening(jsonb)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.is_adopter_cleared(uuid)', 'EXECUTE'),
  'signed-in users keep all three');

-- The general rule, so a future migration cannot reopen it unnoticed.
-- Extension-owned functions (PostGIS st_estimatedextent) are not ours.
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  0, 'no SECURITY DEFINER function of ours is callable by anon');

select * from finish();
rollback;
