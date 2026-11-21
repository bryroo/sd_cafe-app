-- Address lookup limits (geocode Edge Function): 30 lookups a minute per person, Nominatim at most once
-- every 1.1 s for the whole app, and nobody but the server can touch the tables or the function.
-- Self-contained; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-a@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-b@test.local');
delete from public.geocode_call;

select is(public.geocode_take_slot('00000000-0000-0000-0000-0000000000e1', true), 'ok', 'the first Nominatim call goes through');
select is(public.geocode_take_slot('00000000-0000-0000-0000-0000000000e2', true), 'busy', 'a second one within 1.1 s, from anyone, waits');
select is(public.geocode_take_slot('00000000-0000-0000-0000-0000000000e2', false), 'ok', 'cached answers are not held back');

-- Make the earlier calls a few seconds old, then fill A's minute
update public.geocode_call set called_at = now() - interval '5 seconds';
insert into public.geocode_call (user_id, upstream, called_at)
select '00000000-0000-0000-0000-0000000000e1', false, now() - interval '10 seconds' from generate_series(1, 29);
select is(public.geocode_take_slot('00000000-0000-0000-0000-0000000000e1', false), 'user_limit', 'more than 30 lookups a minute are refused');
select is(public.geocode_take_slot('00000000-0000-0000-0000-0000000000e2', true), 'ok', 'other people are not affected');

select ok(not has_function_privilege('authenticated', 'public.geocode_take_slot(uuid, boolean)', 'execute'), 'customers cannot call the limiter');
select ok(not has_function_privilege('anon', 'public.geocode_take_slot(uuid, boolean)', 'execute'), 'guests cannot call the limiter');
select ok(not has_table_privilege('authenticated', 'public.geocode_cache', 'select'), 'customers cannot read the cache');
select ok(not has_table_privilege('authenticated', 'public.geocode_call', 'select'), 'customers cannot read who looked up what');
select ok(not has_table_privilege('anon', 'public.geocode_cache', 'select'), 'guests cannot read the cache');

select * from finish();
rollback;
