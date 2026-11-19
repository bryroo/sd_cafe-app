-- RLS per table and role: anon, customer A (owner), customer B (another customer), staff S.
-- Run: npm run test:db   (= npx supabase test db supabase/tests/database)
-- Self-contained: creates its own users and orders and rolls everything back, so it works on an empty
-- database or on top of the demo seed.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

/* ---------- Helpers ---------- */

-- Acts as anon (uid null) or a signed-in user
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

-- Runs a query (or DML ... returning) as that person: the number of rows, or 'ERR <sqlstate>'
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

/* ---------- Fixtures (as the server) ---------- */

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-a@test.local',
   '{"account_type":"customer","full_name":"Test A","mobile_no":"+639990000101","terms_accepted":true}'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-b@test.local',
   '{"account_type":"customer","full_name":"Test B","mobile_no":"+639990000102","terms_accepted":true}'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-s@test.local', '{}');
insert into public.staff_user (staff_id, username, email, full_name, cafe_id)
values ('00000000-0000-0000-0000-000000000005', 't-staff', 't-s@test.local', 'Test Staff', (select min(settings_id) from public.store_settings));

create temp table fx (k text primary key, id text);
grant select on fx to anon, authenticated;
insert into fx values ('A', '00000000-0000-0000-0000-00000000000a'), ('B', '00000000-0000-0000-0000-00000000000b'),
                      ('S', '00000000-0000-0000-0000-000000000005');

insert into public.address (customer_id, recipient_name, street, barangay, city)
select id::uuid, 'Test', '1 Test St', 'Test', 'Test City' from fx where k in ('A', 'B');
insert into public.payment_method (customer_id, type, provider_token, last4)
select id::uuid, 'card', 'tok_t_' || k, '4242' from fx where k in ('A', 'B');

insert into fx
select 'order_' || k, (public.create_order(jsonb_build_object(
  'idempotency_key', gen_random_uuid(), 'cafe_id', (select min(settings_id) from public.store_settings),
  'customer_id', id, 'customer_name', 'Test ' || k, 'customer_mobile', '+63999000010' || case k when 'A' then '1' else '2' end,
  'fulfillment', 'pickup', 'subtotal', 10000, 'total', 10000, 'eta', now() + interval '10 minutes',
  'lines', jsonb_build_array(jsonb_build_object('item_name', 'Latte', 'unit_price', 10000, 'quantity', 1,
    'options', jsonb_build_array(jsonb_build_object('group_title', 'Size', 'label', '12 oz', 'price', 0)))),
  'payment', jsonb_build_object('method', 'counter', 'method_label', 'Pay at counter', 'amount', 10000, 'status', 'pending', 'provider_ref', 'T-REF-' || k)
))).order_id::text
from fx where k in ('A', 'B');

insert into public.points_txn (customer_id, type, points, description) select id::uuid, 'adjust', 100, 'test' from fx where k in ('A', 'B');
insert into public.customer_reward (customer_id, reward_id, expires_on)
select id::uuid, (select min(reward_id) from public.reward), now() + interval '30 days' from fx where k = 'A';
insert into public.promotion_redemption (promotion_id, customer_id, order_id)
-- On B's order: A cancels their own order below, and cancelling gives a promo use back (TBD-12)
select (select min(promotion_id) from public.promotion), (select id::uuid from fx where k = 'B'), (select id::uuid from fx where k = 'order_B');
insert into public.internal_note (order_id, staff_id, author_name, body) select id::uuid, null, 'Test Staff', 'Fixture note' from fx where k = 'order_A';
insert into public.automated_order (cafe_id, source, rule, customer_id, customer_name, contents)
select (select min(settings_id) from public.store_settings), 'Test', 'Test rule', id::uuid, 'Test A', '[]' from fx where k = 'A';
insert into public.audit_log (actor_type, action, entity, entity_id) values ('system', 'test', 'test', 'test');
-- One inactive menu item (hidden from customers, visible to staff)
insert into fx select 'inactive_item', min(item_id) from public.menu_item;
update public.menu_item set is_active = false where item_id = (select id from fx where k = 'inactive_item');

-- Shorthands used in the queries below
create or replace function pg_temp.q(t text) returns text language sql as $$ select replace(replace(replace(replace(replace(replace(t,
  ':A', quote_literal((select id from fx where k = 'A'))), ':B', quote_literal((select id from fx where k = 'B'))),
  ':OA', quote_literal((select id from fx where k = 'order_A'))), ':OB', quote_literal((select id from fx where k = 'order_B'))),
  ':S', quote_literal((select id from fx where k = 'S'))), ':ITEM', quote_literal((select id from fx where k = 'inactive_item'))) $$;
create or replace function pg_temp.as_(who text, t text) returns text language sql as $$
  select pg_temp.n(case who when 'anon' then null else (select id::uuid from fx where k = who) end, pg_temp.q(t)) $$;

/* ---------- Schema-wide ---------- */

select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0::bigint,
          'every public table has RLS enabled');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), 0::bigint,
          'every SECURITY DEFINER function fixes search_path');
-- A wrapped call deparses as "( SELECT is_staff() AS is_staff)"; anything left after removing those is per-row
select is((select count(*) from pg_policies where schemaname = 'public'
            and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '\( SELECT is_staff\(\) AS is_staff\)', '', 'g') ~ 'is_staff\(\)'), 0::bigint,
          'policies evaluate is_staff() once per query');

/* ---------- Catalog: public reads, staff-only writes ---------- */

select is(pg_temp.as_('anon', 'select 1 from public.store_settings'), (select count(*)::text from public.store_settings), 'anon reads store settings');
select is(pg_temp.as_('anon', 'update public.store_settings set accepting_orders = accepting_orders returning 1'), 'ERR 42501', 'anon cannot update store settings');
select is(pg_temp.as_('A', 'update public.store_settings set accepting_orders = accepting_orders returning 1'), '0', 'customer cannot update store settings');
select is(pg_temp.as_('S', 'update public.store_settings set accepting_orders = accepting_orders returning 1'), (select count(*)::text from public.store_settings), 'staff update store settings');
select is(pg_temp.as_('S', 'update public.store_settings set demo_mode = demo_mode, points_per_peso = 2 returning 1'), 'ERR 42501', 'staff cannot change points_per_peso (no column grant)');

select is(pg_temp.as_('anon', 'select 1 from public.tier'), (select count(*)::text from public.tier), 'anon reads tiers');
select is(pg_temp.as_('anon', 'select 1 from public.option_value'), (select count(*)::text from public.option_value), 'anon reads option values');
select is(pg_temp.as_('anon', 'select 1 from public.reward'), (select count(*)::text from public.reward where is_active), 'anon reads active rewards only');
select is(pg_temp.as_('anon', 'select 1 from public.menu_category'), (select count(*)::text from public.menu_category where is_active), 'anon reads active categories only');
select is(pg_temp.as_('anon', 'select 1 from public.menu_item where item_id = :ITEM'), '0', 'anon cannot see an inactive item');
select is(pg_temp.as_('A', 'select 1 from public.menu_item where item_id = :ITEM'), '0', 'customer cannot see an inactive item');
select is(pg_temp.as_('S', 'select 1 from public.menu_item where item_id = :ITEM'), '1', 'staff see an inactive item');
select is(pg_temp.as_('A', 'update public.menu_item set is_available = is_available where item_id = :ITEM returning 1'), '0', 'customer cannot change availability');
select is(pg_temp.as_('S', 'update public.menu_item set is_available = is_available where item_id = :ITEM returning 1'), '1', 'staff change availability');
select is(pg_temp.as_('S', 'update public.menu_item set name = name where item_id = :ITEM returning 1'), 'ERR 42501', 'staff cannot rename items (no column grant)');

select is(pg_temp.as_('anon', 'select 1 from public.promotion'), (select count(*)::text from public.promotion where is_published and code is null), 'anon sees published offers without codes only');
select is(pg_temp.as_('anon', 'select code from public.promotion'), 'ERR 42501', 'promo codes are never readable');
select is(pg_temp.as_('A', 'select code from public.promotion'), 'ERR 42501', 'promo codes are never readable by customers');

/* ---------- customer ---------- */

select is(pg_temp.as_('anon', 'select 1 from public.customer'), 'ERR 42501', 'anon cannot read customers');
select is(pg_temp.as_('A', 'select 1 from public.customer where customer_id = :A'), '1', 'customer reads own profile');
select is(pg_temp.as_('A', 'select 1 from public.customer where customer_id = :B'), '0', 'customer cannot read another profile');
select is(pg_temp.as_('S', 'select 1 from public.customer where customer_id in (:A, :B)'), '2', 'staff read customer profiles');
select is(pg_temp.as_('A', 'update public.customer set full_name = full_name where customer_id = :B returning 1'), '0', 'customer cannot edit another profile');
select is(pg_temp.as_('A', 'update public.customer set full_name = ''Test A2'' where customer_id = :A returning 1'), '1', 'customer edits own profile');
select is(pg_temp.as_('A', 'update public.customer set points_balance = 9999 where customer_id = :A returning 1'), 'ERR 42501', 'customer cannot set own points');
select is(pg_temp.as_('A', 'update public.customer set is_demo = true where customer_id = :A returning 1'), 'ERR 42501', 'customer cannot flag self as demo');
select is(pg_temp.as_('A', 'update public.customer set tier_id = tier_id where customer_id = :A returning 1'), 'ERR 42501', 'customer cannot change own tier');
select is(pg_temp.as_('A', 'update public.customer set mobile_no = mobile_no where customer_id = :A returning 1'), 'ERR 42501', 'customer cannot change own mobile');
select is(pg_temp.as_('A', 'delete from public.customer where customer_id = :A returning 1'), 'ERR 42501', 'customer cannot delete the profile row directly');

/* ---------- address ---------- */

select is(pg_temp.as_('anon', 'select 1 from public.address'), 'ERR 42501', 'anon cannot read addresses');
select is(pg_temp.as_('A', 'select 1 from public.address where customer_id in (:A, :B)'), '1', 'customer reads only own addresses');
select is(pg_temp.as_('S', 'select 1 from public.address where customer_id in (:A, :B)'), '2', 'staff read addresses');
select is(pg_temp.as_('A', 'insert into public.address (customer_id, recipient_name, street, barangay, city) values (:B, ''X'', ''X'', ''X'', ''X'') returning 1'), 'ERR 42501', 'customer cannot add an address for someone else');
select is(pg_temp.as_('A', 'insert into public.address (customer_id, recipient_name, street, barangay, city) values (:A, ''X'', ''X'', ''X'', ''X'') returning 1'), '1', 'customer adds own address');
select is(pg_temp.as_('A', 'update public.address set notes = ''x'' where customer_id = :B returning 1'), '0', 'customer cannot edit another address');
select is(pg_temp.as_('A', 'delete from public.address where customer_id = :B returning 1'), '0', 'customer cannot delete another address');
select is(pg_temp.as_('S', 'update public.address set notes = ''x'' where customer_id = :B returning 1'), '0', 'staff cannot edit addresses');

/* ---------- payment_method (owner only) ---------- */

select is(pg_temp.as_('anon', 'select 1 from public.payment_method'), 'ERR 42501', 'anon cannot read payment methods');
select is(pg_temp.as_('A', 'select 1 from public.payment_method where customer_id in (:A, :B)'), '1', 'customer reads only own payment methods');
select is(pg_temp.as_('S', 'select 1 from public.payment_method where customer_id in (:A, :B)'), '0', 'staff cannot read payment methods');
select is(pg_temp.as_('A', 'insert into public.payment_method (customer_id, type, provider_token, last4) values (:B, ''card'', ''tok_x'', ''1111'') returning 1'), 'ERR 42501', 'customer cannot add a payment method for someone else');
select is(pg_temp.as_('A', 'update public.payment_method set is_default = true where customer_id = :B returning 1'), '0', 'customer cannot edit another payment method');
select is(pg_temp.as_('A', 'delete from public.payment_method where customer_id = :B returning 1'), '0', 'customer cannot delete another payment method');
select is(pg_temp.as_('A', 'update public.payment_method set provider_token = ''x'' where customer_id = :A returning 1'), 'ERR 42501', 'customer cannot change a stored token');

/* ---------- orders and their children ---------- */

select is(pg_temp.as_('anon', 'select 1 from public.orders'), 'ERR 42501', 'anon cannot read orders');
select is(pg_temp.as_('A', 'select 1 from public.orders where order_id in (:OA, :OB)'), '1', 'customer reads only own orders');
select is(pg_temp.as_('B', 'select 1 from public.orders where order_id in (:OA, :OB)'), '1', 'the other customer reads only theirs');
select is(pg_temp.as_('S', 'select 1 from public.orders where order_id in (:OA, :OB)'), '2', 'staff read all orders');
select is(pg_temp.as_('A', 'insert into public.orders (idempotency_key, cafe_id, customer_name, customer_mobile, fulfillment, subtotal, total, eta) values (gen_random_uuid(), 1, ''x'', ''x'', ''pickup'', 0, 0, now()) returning 1'), 'ERR 42501', 'customers cannot insert orders');
select is(pg_temp.as_('A', 'update public.orders set status = ''Cancelled'' where order_id = :OB returning 1'), '0', 'customer cannot cancel another customer''s order');
select is(pg_temp.as_('A', 'update public.orders set total = 1 where order_id = :OA returning 1'), 'ERR 42501', 'customer cannot change totals');
select is(pg_temp.as_('A', 'update public.orders set status = ''Cancelled'' where order_id = :OA returning 1'), '1', 'customer cancels own order');
select is(pg_temp.as_('S', 'update public.orders set status = ''Accepted'' where order_id = :OB returning 1'), '1', 'staff accept an order');
select is(pg_temp.as_('A', 'delete from public.orders where order_id = :OA returning 1'), 'ERR 42501', 'customer cannot delete orders');

select is(pg_temp.as_('A', 'select 1 from public.order_line where order_id in (:OA, :OB)'), '1', 'customer reads only own order lines');
select is(pg_temp.as_('S', 'select 1 from public.order_line where order_id in (:OA, :OB)'), '2', 'staff read all order lines');
select is(pg_temp.as_('A', 'select 1 from public.order_line_option o join public.order_line l using (line_id) where l.order_id in (:OA, :OB)'), '1', 'customer reads only own line options');
select is(pg_temp.as_('S', 'select 1 from public.order_line_option o join public.order_line l using (line_id) where l.order_id in (:OA, :OB)'), '2', 'staff read all line options');
select is(pg_temp.as_('A', 'insert into public.order_line (order_id, item_name, unit_price, quantity) values (:OA, ''x'', 1, 1) returning 1'), 'ERR 42501', 'customer cannot add order lines');
select is(pg_temp.as_('A', 'select 1 from public.order_status_event where order_id = :OB'), '0', 'customer cannot read another order''s timeline');
select isnt(pg_temp.as_('A', 'select 1 from public.order_status_event where order_id = :OA'), '0', 'customer reads own order timeline');
select is(pg_temp.as_('A', 'select 1 from public.payment where order_id in (:OA, :OB)'), '1', 'customer reads only own payments');
select is(pg_temp.as_('S', 'select 1 from public.payment where order_id in (:OA, :OB)'), '2', 'staff read all payments');
select is(pg_temp.as_('A', 'select provider_ref from public.payment'), 'ERR 42501', 'customer cannot read payment references');
select is(pg_temp.as_('S', 'select provider_ref from public.payment'), 'ERR 42501', 'payment references only through staff RPCs');

/* ---------- loyalty ---------- */

select is(pg_temp.as_('anon', 'select 1 from public.points_txn'), 'ERR 42501', 'anon cannot read points');
select is(pg_temp.as_('A', 'select 1 from public.points_txn where customer_id = :B'), '0', 'customer cannot read another ledger');
select isnt(pg_temp.as_('A', 'select 1 from public.points_txn where customer_id = :A'), '0', 'customer reads own ledger');
select isnt(pg_temp.as_('S', 'select 1 from public.points_txn where customer_id = :B'), '0', 'staff read ledgers');
select is(pg_temp.as_('A', 'insert into public.points_txn (customer_id, type, points, description) values (:A, ''adjust'', 1000, ''x'') returning 1'), 'ERR 42501', 'customer cannot write points');
select is(pg_temp.as_('B', 'select 1 from public.customer_reward where customer_id = :A'), '0', 'customer cannot read another''s vouchers');
select is(pg_temp.as_('A', 'select 1 from public.customer_reward where customer_id = :A'), '1', 'customer reads own vouchers');
select is(pg_temp.as_('S', 'select 1 from public.customer_reward where customer_id = :A'), '1', 'staff read vouchers');
select is(pg_temp.as_('A', 'update public.customer_reward set status = ''unused'' returning 1'), 'ERR 42501', 'customer cannot change vouchers');
select is(pg_temp.as_('A', 'select 1 from public.promotion_redemption where customer_id = :B'), '0', 'customer cannot read another''s promo uses');
select is(pg_temp.as_('B', 'select 1 from public.promotion_redemption where customer_id = :B'), '1', 'customer reads own promo uses');
select is(pg_temp.as_('S', 'select 1 from public.promotion_redemption where customer_id = :B'), '1', 'staff read promo uses');
select is(pg_temp.as_('A', 'delete from public.promotion_redemption returning 1'), 'ERR 42501', 'customer cannot give a promo use back');

/* ---------- notifications (owner only) ---------- */

select is(pg_temp.as_('anon', 'select 1 from public.notification'), 'ERR 42501', 'anon cannot read notifications');
select is(pg_temp.as_('A', 'select 1 from public.notification where customer_id = :B'), '0', 'customer cannot read another''s notifications');
select isnt(pg_temp.as_('A', 'select 1 from public.notification where customer_id = :A'), '0', 'customer reads own notifications');
select is(pg_temp.as_('S', 'select 1 from public.notification where customer_id in (:A, :B)'), '0', 'staff cannot read customer notifications');
select is(pg_temp.as_('A', 'update public.notification set read_at = now() where customer_id = :B returning 1'), '0', 'customer cannot mark another''s notification');
select is(pg_temp.as_('A', 'update public.notification set body = ''x'' where customer_id = :A returning 1'), 'ERR 42501', 'customer can only change read_at');

/* ---------- staff-only tables ---------- */

select is(pg_temp.as_('A', 'select 1 from public.internal_note where order_id = :OA'), '0', 'customer cannot read internal notes on own order');
select isnt(pg_temp.as_('S', 'select 1 from public.internal_note where order_id = :OA'), '0', 'staff read internal notes');
select is(pg_temp.as_('A', 'insert into public.internal_note (order_id, body) values (:OA, ''x'') returning 1'), 'ERR 42501', 'customer cannot add internal notes');
select is(pg_temp.as_('S', 'insert into public.internal_note (order_id, body) values (:OB, ''Checked'') returning 1'), '1', 'staff add internal notes');
select is(pg_temp.as_('anon', 'select 1 from public.staff_user'), 'ERR 42501', 'anon cannot read staff');
select is(pg_temp.as_('A', 'select 1 from public.staff_user where staff_id = :S'), '0', 'customer cannot read staff');
select is(pg_temp.as_('S', 'select 1 from public.staff_user where staff_id = :S'), '1', 'staff read staff');
select is(pg_temp.as_('A', 'select 1 from public.response_template'), '0', 'customer cannot read templates');
select is(pg_temp.as_('S', 'select 1 from public.response_template'), (select count(*)::text from public.response_template), 'staff read templates');
select is(pg_temp.as_('A', 'update public.response_template set enabled = enabled returning 1'), '0', 'customer cannot edit templates');
select is(pg_temp.as_('S', 'update public.response_template set is_critical = false returning 1'), 'ERR 42501', 'staff cannot clear the critical flag (no column grant)');
select is(pg_temp.as_('A', 'select 1 from public.automated_order where customer_id = :A'), '0', 'customer cannot read automated orders');
select isnt(pg_temp.as_('S', 'select 1 from public.automated_order where customer_id = :A'), '0', 'staff read automated orders');
select is(pg_temp.as_('A', 'select 1 from public.audit_log'), '0', 'customer cannot read the audit log');
select isnt(pg_temp.as_('S', 'select 1 from public.audit_log'), '0', 'staff read the audit log');
select is(pg_temp.as_('S', 'delete from public.audit_log returning 1'), 'ERR 42501', 'staff cannot delete audit entries');
select is(pg_temp.as_('anon', 'select 1 from public.login_attempt'), 'ERR 42501', 'anon cannot read sign-in attempts');
select is(pg_temp.as_('S', 'select 1 from public.login_attempt'), 'ERR 42501', 'staff cannot read sign-in attempts');

select * from finish();
rollback;
