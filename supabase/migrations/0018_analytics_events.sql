-- ============================================================================
-- Guardians — 0018_analytics_events
-- Lightweight self-hosted analytics: a single append-only events table written
-- only through a SECURITY DEFINER RPC. Gives a queryable funnel (report/claim/
-- rescue/redeem) without any third-party analytics dependency. Applied to the
-- live DB via MCP; `track()` (src/lib/observability.ts) forwards events to it.
-- ============================================================================
create table if not exists public.analytics_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete set null,
  event      text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_event_idx
  on public.analytics_events (event, created_at desc);

alter table public.analytics_events enable row level security;
-- No client SELECT/INSERT policy: events are private and written only via the RPC.

create or replace function public.track_event(p_event text, p_props jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return; end if;
  if p_event is null or length(p_event) = 0 then return; end if;
  insert into public.analytics_events (user_id, event, props)
  values (auth.uid(), left(p_event, 80), coalesce(p_props, '{}'::jsonb));
end;
$$;

revoke execute on function public.track_event(text, jsonb) from public, anon;
grant  execute on function public.track_event(text, jsonb) to authenticated;
