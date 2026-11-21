-- Address lookups (OpenStreetMap Nominatim) go through the `geocode` Edge Function, never straight from
-- phones, because Nominatim's usage policy allows at most 1 request per second for the whole app and asks
-- for results to be cached. This adds:
--   geocode_cache   answers kept for 30 days (keyed by the normalised query or the rounded pin)
--   geocode_call    one row per lookup, for the per-person limit and the app-wide 1 per second
--   geocode_take_slot()  the atomic check both limits go through
-- Server only: RLS on with no policies, functions for service_role only. Nominatim data is ODbL
-- (© OpenStreetMap contributors).
--
-- Rollback:
--   drop function if exists public.geocode_take_slot(uuid, boolean);
--   drop table if exists public.geocode_call;
--   drop table if exists public.geocode_cache;

create table public.geocode_cache (
  cache_key   text        primary key check (length(cache_key) <= 300),
  response    jsonb       not null,
  fetched_at  timestamptz not null default now()
);
comment on table public.geocode_cache is 'Nominatim answers (ODbL, © OpenStreetMap contributors), kept 30 days. Server only.';

create table public.geocode_call (
  call_id    bigint      generated always as identity primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  -- true when this call went to Nominatim (a cache hit doesn't)
  upstream   boolean     not null,
  called_at  timestamptz not null default now()
);
create index geocode_call_user on public.geocode_call (user_id, called_at desc);
create index geocode_call_upstream on public.geocode_call (called_at desc) where upstream;
comment on table public.geocode_call is 'Address lookups per person, for rate limits. Pruned after a day. Server only.';

alter table public.geocode_cache enable row level security;
alter table public.geocode_call enable row level security;

-- 'ok', 'user_limit' (more than 30 lookups in a minute) or 'busy' (another Nominatim request in the last
-- 1.1 s). One transaction-level advisory lock makes the check and the insert atomic across Edge workers.
create or replace function public.geocode_take_slot(p_user uuid, p_upstream boolean)
returns text
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('megs.geocode'));
  if (select count(*) from public.geocode_call where user_id = p_user and called_at > now() - interval '1 minute') >= 30 then
    return 'user_limit';
  end if;
  if p_upstream and exists (
    select 1 from public.geocode_call where upstream and called_at > now() - interval '1100 milliseconds'
  ) then
    return 'busy';
  end if;
  insert into public.geocode_call (user_id, upstream) values (p_user, p_upstream);
  -- Housekeeping: a day of history is plenty for the limits
  delete from public.geocode_call where called_at < now() - interval '1 day';
  delete from public.geocode_cache where fetched_at < now() - interval '30 days';
  return 'ok';
end
$$;
revoke execute on function public.geocode_take_slot(uuid, boolean) from public, anon, authenticated;
grant execute on function public.geocode_take_slot(uuid, boolean) to service_role;
