-- Who may call which database function (RPC), and the fixes from DB_PLAN.md (M5, M7).
-- Run: npm run test:db   (= npx supabase test db supabase/tests/database)
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.act(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function pg_temp.n(uid uuid, q text) returns text language plpgsql as $$
declare r bigint;
begin
  perform pg_temp.act(uid);
  begin
    execute format('with x as (%s) select count(*) from x', q) into r;
  exception when others then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return 'ERR ' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r::text;
end $$;

/* ---------- Fixtures: demo customer A, ordinary customer B, staff S ---------- */

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-a@test.local',
   '{"account_type":"customer","full_name":"Test A","mobile_no":"+639990000101","terms_accepted":true}'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-b@test.local',
   '{"account_type":"customer","full_name":"Test B","mobile_no":"+639990000102","terms_accepted":true}'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-s@test.local', '{}');
insert into public.staff_user (staff_id, username, email, full_name, cafe_id)
values ('00000000-0000-0000-0000-000000000005', 't-staff', 't-s@test.local', 'Test Staff', (select min(settings_id) from public.store_settings));
update public.customer set is_demo = true where customer_id = '00000000-0000-0000-0000-00000000000a';
update public.store_settings set demo_mode = true;

create temp table fx (k text primary key, id text);
grant select on fx to anon, authenticated;
insert into fx values ('A', '00000000-0000-0000-0000-00000000000a'), ('B', '00000000-0000-0000-0000-00000000000b'),
                      ('S', '00000000-0000-0000-0000-000000000005');
insert into fx
select 'no_' || k, (public.create_order(jsonb_build_object(
  'idempotency_key', gen_random_uuid(), 'cafe_id', (select min(settings_id) from public.store_settings),
  'customer_id', id, 'customer_name', 'Test ' || k, 'customer_mobile', '+639990000100',
  'fulfillment', 'pickup', 'subtotal', 10000, 'total', 10000, 'eta', now() + interval '10 minutes',
  'lines', jsonb_build_array(jsonb_build_object('item_name', 'Latte', 'unit_price', 10000, 'quantity', 1)),
  'payment', jsonb_build_object('method', 'counter', 'method_label', 'Pay at counter', 'amount', 10000, 'status', 'pending', 'provider_ref', 'T-REF-' || k)
))).order_no::text
from fx where k in ('A', 'B');

create or replace function pg_temp.as_(who text, t text) returns text language sql as $$
  select pg_temp.n(case who when 'anon' then null else (select id::uuid from fx where k = who) end,
    replace(replace(t, ':NOA', (select id from fx where k = 'no_A')), ':NOB', (select id from fx where k = 'no_B'))) $$;

/* ---------- Grants ---------- */

select ok(not has_function_privilege('anon', f, 'execute'), 'anon cannot call ' || f)
from unnest(array[
  'public.create_order(jsonb)', 'public.sync_order_no_seq()', 'public.housekeeping()',
  'public.demo_set_order_state(bigint, public.order_status, public.fulfillment_type)', 'public.demo_set_points(integer)',
  'public.redeem_reward(text)', 'public.check_promo_code(text)', 'public.staff_payments()', 'public.staff_payments_for(uuid[])',
  'public.staff_order_payments(uuid)', 'public.current_actor()'
]) f;
select ok(not has_function_privilege('authenticated', f, 'execute'), 'signed-in users cannot call ' || f)
from unnest(array['public.create_order(jsonb)', 'public.sync_order_no_seq()', 'public.housekeeping()']) f;
select ok(has_function_privilege('service_role', f, 'execute'), 'the server can call ' || f)
from unnest(array['public.create_order(jsonb)', 'public.sync_order_no_seq()', 'public.login_failed(text, public.login_audience)']) f;
-- Still granted to anon until the follow-up migration M6b (cached app versions call them). The current
-- app signs in through the sign-in Edge Function instead.
select ok(has_function_privilege('anon', 'public.login_failed(text, public.login_audience)', 'execute'),
          'login RPCs stay callable by anon until M6b (update this test when M6b lands)');

/* ---------- Demo tools (M5) ---------- */

select is(pg_temp.as_('B', 'select public.demo_set_order_state(:NOA, ''Cancelled'')'), 'ERR P0002', 'a customer cannot demo-rewrite another customer''s order');
select is((select status::text from public.orders where order_no = (select id::bigint from fx where k = 'no_A')), 'Received', 'that order is unchanged');
select is(pg_temp.as_('A', 'select public.demo_set_order_state(:NOA, ''Preparing'')'), '1', 'a customer can set their own order (screen index)');
select is((select status::text from public.orders where order_no = (select id::bigint from fx where k = 'no_A')), 'Preparing', 'own order moved');
select is(pg_temp.as_('S', 'select public.demo_set_order_state(:NOB, ''Ready'')'), '1', 'staff can set any order');
select is(pg_temp.as_('B', 'select public.demo_set_points(99999)'), 'ERR 42501', 'an ordinary customer cannot set their points');
select is((select points_balance from public.customer where customer_id = '00000000-0000-0000-0000-00000000000b'), 0, 'their balance is unchanged');
select is(pg_temp.as_('A', 'select public.demo_set_points(250)'), '1', 'a demo customer can set their points');
select is((select points_balance from public.customer where customer_id = '00000000-0000-0000-0000-00000000000a'), 250, 'demo balance set');
select is((select sum(points)::int from public.points_txn where customer_id = '00000000-0000-0000-0000-00000000000a'), 250, 'balance still equals the ledger');

update public.store_settings set demo_mode = false;
select is(pg_temp.as_('A', 'select public.demo_set_points(10)'), 'ERR 42501', 'demo tools are off when demo mode is off');
select is(pg_temp.as_('S', 'select public.demo_set_order_state(:NOB, ''Completed'')'), 'ERR 42501', 'even for staff');
update public.store_settings set demo_mode = true;

/* ---------- Staff payment references (M7) ---------- */

select is(pg_temp.as_('B', 'select * from public.staff_payments_for(array(select order_id from public.orders))'), 'ERR 42501', 'customers cannot read payment references');
select is(pg_temp.as_('S', 'select * from public.staff_payments_for(array(select order_id from public.orders where order_no in (:NOA, :NOB)))'), '2', 'staff get references for the orders asked for');
select is(pg_temp.as_('S', 'select * from public.staff_payments_for(array[]::uuid[])'), '0', 'and nothing else');
select is(pg_temp.as_('B', 'select * from public.staff_payments()'), 'ERR 42501', 'the old staff_payments() is still staff only');

/* ---------- Other customer RPCs ---------- */

select is(pg_temp.as_('B', 'select public.redeem_reward((select min(reward_id) from public.reward))'), 'ERR 23514', 'redeeming without enough points fails');
select is(pg_temp.as_('anon', 'select public.is_mobile_registered(''+639990000101'')'), '1', 'anon may check whether a number is registered (SRS 3.2.1.5)');

select * from finish();
rollback;
