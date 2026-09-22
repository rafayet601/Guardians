-- A physical token belongs to one account. Remove legacy ambiguous ownership;
-- those devices must opt in again before receiving alerts.
delete from public.device_push_tokens where token in (
  select token from public.device_push_tokens group by token having count(*) > 1
);
-- Legacy registrations have no account-scoped consent record on the device.
-- Require an explicit opt-in from the updated client before delivery resumes.
update public.device_push_tokens set push_enabled=false;
create unique index device_push_tokens_token_unique on public.device_push_tokens(token);
-- Registration must use the RPC so clients cannot bypass token reassignment.
revoke insert, update on public.device_push_tokens from authenticated;

create or replace function public.upsert_push_token(
  p_token text, p_lat double precision default null, p_lng double precision default null
) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := auth.uid(); geo geography(Point, 4326);
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'
    or length(p_token) > 256 then raise exception 'Invalid push token'; end if;
  if (p_lat is null) <> (p_lng is null) or
    (p_lat is not null and not (p_lat between -90 and 90 and p_lng between -180 and 180))
    then raise exception 'Invalid coordinates'; end if;
  if p_lat is not null then
    geo := st_setsrid(st_makepoint(round(p_lng::numeric,3)::float8, round(p_lat::numeric,3)::float8),4326)::geography;
  end if;
  insert into public.device_push_tokens(user_id,token,last_known_location,push_enabled,urgent_opt_in,updated_at)
  values(uid,p_token,geo,true,true,now())
  on conflict(token) do update set user_id=excluded.user_id,
    last_known_location=excluded.last_known_location, push_enabled=true, urgent_opt_in=true,
    notify_radius_m=8000, updated_at=now();
  delete from public.device_push_tokens where user_id=uid and token not in (
    select token from public.device_push_tokens where user_id=uid order by updated_at desc, token limit 10
  );
end $$;
revoke execute on function public.upsert_push_token(text,float8,float8) from public,anon;
grant execute on function public.upsert_push_token(text,float8,float8) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from public.device_push_tokens where user_id=auth.uid() and token=p_token;
end $$;
revoke execute on function public.unregister_push_token(text) from public,anon;
grant execute on function public.unregister_push_token(text) to authenticated;
