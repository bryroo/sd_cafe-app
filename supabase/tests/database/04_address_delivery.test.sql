-- Delivery addresses and delivery orders: RLS per person, the pinned-location rules, the orders guard.
-- Customers A and B, an anonymous Auth user's token (is_anonymous claim) for A, anon, staff S.
-- Self-contained; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

/* ---------- Helpers ---------- */

create or replace function pg_temp.act(uid uuid, anonymous boolean default false) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', anonymous)::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function pg_temp.n(uid uuid, q text, anonymous boolean default false) returns text language plpgsql as $$
declare r bigint;
begin
  perform pg_temp.act(uid, anonymous);
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

-- Places an order as the server: 'ok' or the error message's code prefix
create or replace function pg_temp.place(customer uuid, fulfillment text, addr jsonb, src text default 'app') returns text language plpgsql as $$
begin
  perform public.create_order(jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'cafe_id', (select min(settings_id) from public.store_settings),
    'customer_id', customer, 'customer_name', 'Test', 'customer_mobile', '+639990000101',
    'fulfillment', fulfillment, 'delivery_address', addr, 'source', src,
    'subtotal', 10000, 'delivery_fee', case when fulfillment = 'delivery' then 2500 else 0 end,
    'total', case when fulfillment = 'delivery' then 12500 else 10000 end, 'eta', now() + interval '30 minutes',
    'lines', jsonb_build_array(jsonb_build_object('item_name', 'Latte', 'unit_price', 10000, 'quantity', 1)),
    'payment', jsonb_build_object('method', 'card', 'method_label', 'Card', 'amount',
       case when fulfillment = 'delivery' then 12500 else 10000 end, 'status', 'authorized')));
  return 'ok';
exception when others then
  return split_part(sqlerrm, ':', 1);
end $$;

/* ---------- Fixtures ---------- */

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd-a@test.local',
   '{"account_type":"customer","full_name":"Delivery A","mobile_no":"+639990000201","terms_accepted":true}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd-b@test.local',
   '{"account_type":"customer","full_name":"Delivery B","mobile_no":"+639990000202","terms_accepted":true}'),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd-s@test.local', '{}');
insert into public.staff_user (staff_id, username, email, full_name, cafe_id)
values ('00000000-0000-0000-0000-0000000000c5', 'd-staff', 'd-s@test.local', 'Delivery Staff', (select min(settings_id) from public.store_settings));

create temp table fx (k text primary key, id text);
grant select on fx to anon, authenticated;
insert into fx values ('A', '00000000-0000-0000-0000-0000000000a1'), ('B', '00000000-0000-0000-0000-0000000000b1'),
                      ('S', '00000000-0000-0000-0000-0000000000c5');
-- A: one pinned Bocaue address (Poblacion) and one legacy address with no pin. B: one pinned address.
with x as (
  insert into public.address (customer_id, recipient_name, street, barangay, city, mobile_no, lat, lng, is_default)
  values ('00000000-0000-0000-0000-0000000000a1', 'Delivery A', '1 Test St', 'Poblacion', 'Bocaue', '+639990000201', 14.7949017, 120.9254911, true)
  returning address_id)
insert into fx select 'addrA', address_id::text from x;
with x as (
  insert into public.address (customer_id, recipient_name, street, barangay, city)
  values ('00000000-0000-0000-0000-0000000000a1', 'Delivery A', '2 Old St', 'San Roque', 'Quezon City')
  returning address_id)
insert into fx select 'legacyA', address_id::text from x;
with x as (
  insert into public.address (customer_id, recipient_name, street, barangay, city, lat, lng)
  values ('00000000-0000-0000-0000-0000000000b1', 'Delivery B', '3 Test St', 'Lolomboy', 'Bocaue', 14.7811638, 120.9353354)
  returning address_id)
insert into fx select 'addrB', address_id::text from x;

create or replace function pg_temp.q(t text) returns text language sql as $$ select replace(replace(replace(replace(replace(t,
  ':ADDRA', quote_literal((select id from fx where k = 'addrA'))), ':ADDRB', quote_literal((select id from fx where k = 'addrB'))),
  ':LEGACYA', quote_literal((select id from fx where k = 'legacyA'))),
  ':A', quote_literal((select id from fx where k = 'A'))), ':B', quote_literal((select id from fx where k = 'B'))) $$;
create or replace function pg_temp.as_(who text, t text) returns text language sql as $$
  select case who
    when 'anon' then pg_temp.n(null, pg_temp.q(t))
    when 'A-anonymous' then pg_temp.n((select id::uuid from fx where k = 'A'), pg_temp.q(t), true)
    else pg_temp.n((select id::uuid from fx where k = who), pg_temp.q(t)) end $$;

/* ---------- Reading: own rows only ---------- */

select is(pg_temp.as_('A', 'select 1 from public.address'), '2', 'A reads their two addresses');
select is(pg_temp.as_('A', 'select 1 from public.address where address_id = :ADDRB'), '0', 'A cannot read B''s address');
select is(pg_temp.as_('B', 'select 1 from public.address'), '1', 'B reads only their own');
select is(pg_temp.as_('anon', 'select 1 from public.address'), 'ERR 42501', 'guests (anon) cannot read addresses');
select is(pg_temp.as_('A-anonymous', 'select 1 from public.address'), '0', 'an anonymous Auth token sees no addresses');
select is(pg_temp.as_('S', 'select 1 from public.address where customer_id in (:A, :B)'), '3', 'staff read addresses to deliver');

/* ---------- Writing: own rows only ---------- */

select is(pg_temp.as_('B', 'update public.address set notes = ''x'' where address_id = :ADDRA returning 1'), '0', 'B cannot edit A''s address');
select is(pg_temp.as_('B', 'delete from public.address where address_id = :ADDRA returning 1'), '0', 'B cannot delete A''s address');
select is(pg_temp.as_('B', 'insert into public.address (customer_id, recipient_name, street, barangay, city) values (:A, ''x'', ''x'', ''x'', ''x'') returning 1'),
  'ERR 42501', 'B cannot add an address to A''s account');
select is(pg_temp.as_('A-anonymous', 'insert into public.address (customer_id, recipient_name, street, barangay, city, lat, lng) values (:A, ''x'', ''x'', ''x'', ''x'', 14.7949, 120.9255) returning 1'),
  'ERR 42501', 'an anonymous Auth token cannot add addresses');
select is(pg_temp.as_('A-anonymous', 'update public.address set notes = ''x'' where address_id = :ADDRA returning 1'), '0', 'an anonymous Auth token cannot edit addresses');
select is(pg_temp.as_('A-anonymous', 'delete from public.address where address_id = :ADDRA returning 1'), '0', 'an anonymous Auth token cannot delete addresses');
select is(pg_temp.as_('anon', 'insert into public.address (customer_id, recipient_name, street, barangay, city) values (:A, ''x'', ''x'', ''x'', ''x'') returning 1'),
  'ERR 42501', 'guests cannot add addresses');
select is(pg_temp.as_('A', 'update public.address set notes = ''Gate is blue'' where address_id = :ADDRA returning 1'), '1', 'A edits their own address');

/* ---------- The pin ---------- */

select is(pg_temp.as_('A', 'insert into public.address (customer_id, recipient_name, street, barangay, city, lat, lng) values (:A, ''A'', ''4 Test St'', ''Turo'', ''Bocaue'', 14.8081205, 120.9424684) returning 1'),
  '1', 'A saves a pin inside Bocaue');
select is(pg_temp.as_('A', 'insert into public.address (customer_id, recipient_name, street, barangay, city, lat, lng) values (:A, ''A'', ''5 Test St'', ''x'', ''Marilao'', 14.770195, 120.957623) returning 1'),
  'ERR 23514', 'a pin in Marilao is refused (no waitlist)');
select is(pg_temp.as_('A', 'insert into public.address (customer_id, recipient_name, street, barangay, city, lat) values (:A, ''A'', ''6 Test St'', ''x'', ''Bocaue'', 14.79) returning 1'),
  'ERR 23514', 'a latitude without a longitude is refused');
select is(pg_temp.as_('A', 'update public.address set lat = 14.5896, lng = 120.9817 where address_id = :ADDRA returning 1'),
  'ERR 23514', 'moving a pin to Manila is refused');
select is(pg_temp.as_('A', 'update public.address set notes = ''Call on arrival'' where address_id = :LEGACYA returning 1'), '1', 'an unpinned (old) address can still be edited');
select ok((select location_set_at is not null from public.address where address_id = (select id::uuid from fx where k = 'addrA')), 'the server stamps when a pin was set');

/* ---------- Default address ---------- */

select is(pg_temp.as_('A', 'select public.set_default_address(:LEGACYA)'), '1', 'A makes another address the default');
select is((select count(*)::int from public.address where customer_id = (select id::uuid from fx where k = 'A') and is_default), 1, 'exactly one default');
select ok((select is_default from public.address where address_id = (select id::uuid from fx where k = 'legacyA')), 'and it is the one chosen');
select is(pg_temp.as_('B', 'select public.set_default_address(:ADDRA)'), 'ERR P0002', 'B cannot touch A''s default');
select is(pg_temp.as_('anon', 'select public.set_default_address(:ADDRA)'), 'ERR 42501', 'guests cannot call it');

/* ---------- Delivery orders (create_order is server-only; the guard backs place-order up) ---------- */

select is(pg_temp.place((select id::uuid from fx where k = 'A'), 'delivery',
  '{"recipient_name":"A","street":"1 Test St","barangay":"Poblacion","city":"Bocaue","lat":14.7949017,"lng":120.9254911}'), 'ok', 'a delivery inside Bocaue is placed');
select is(pg_temp.place((select id::uuid from fx where k = 'A'), 'delivery',
  '{"recipient_name":"A","street":"x","barangay":"x","city":"Marilao","lat":14.770195,"lng":120.957623}'), 'OUT_OF_AREA', 'a delivery to Marilao is refused');
select is(pg_temp.place((select id::uuid from fx where k = 'A'), 'delivery',
  '{"recipient_name":"A","street":"2 Old St","barangay":"San Roque","city":"Quezon City"}'), 'ADDRESS_NEEDS_PIN', 'a delivery with no pin is refused');
select is(pg_temp.place((select id::uuid from fx where k = 'A'), 'delivery',
  '{"recipient_name":"A","street":"x","barangay":"x","city":"x","lat":"north","lng":120.9}'), 'ADDRESS_NEEDS_PIN', 'a malformed pin is refused');
select is(pg_temp.place((select id::uuid from fx where k = 'A'), 'pickup', null), 'ok', 'pickup is unchanged');
select is(pg_temp.place((select id::uuid from fx where k = 'A'), 'delivery',
  '{"recipient_name":"A","street":"Office","barangay":"—","city":"—"}', 'automated'), 'ok', 'automated orders are left as they were');
select is(pg_temp.as_('A', 'insert into public.orders (idempotency_key, cafe_id, customer_name, customer_mobile, fulfillment, subtotal, total, eta) values (gen_random_uuid(), 1, ''x'', ''x'', ''pickup'', 0, 0, now()) returning 1'),
  'ERR 42501', 'customers cannot insert orders');

/* ---------- Orders: own rows only ---------- */

select is(pg_temp.as_('A', 'select 1 from public.orders where customer_id = :A and fulfillment = ''delivery'''), '2', 'A sees their delivery orders');
select is(pg_temp.as_('B', 'select 1 from public.orders where customer_id = :A'), '0', 'B cannot see A''s orders');
select is(pg_temp.as_('A-anonymous', 'select 1 from public.orders'), (select count(*)::text from public.orders where customer_id = (select id::uuid from fx where k = 'A')),
  'order reads are unchanged for the same account (anonymous accounts never have orders: place-order refuses them)');
select is(pg_temp.as_('B', 'update public.orders set status = ''Cancelled'' where customer_id = :A returning 1'), '0', 'B cannot cancel A''s order');
select is(pg_temp.as_('A', 'update public.orders set delivery_address = ''{}'' where customer_id = :A returning 1'), 'ERR 42501', 'nobody rewrites the delivery snapshot from the app');

select * from finish();
rollback;
