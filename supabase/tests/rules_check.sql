-- Checks the database rules against the SRS, acting as each role in turn (guest, customer, staff,
-- server). Runs in one transaction and rolls everything back, so it is safe on any database.
-- Run locally:  npx supabase db query --local -f supabase/tests/rules_check.sql
-- Prints one row per check; any failed check raises an exception and stops the run.

begin;

create temp table results (n serial, check_name text, ok boolean) on commit drop;
grant all on results to anon, authenticated;
grant usage on sequence results_n_seq to anon, authenticated;

-- Acts as a signed-in user (or the anon guest when uid is null)
create or replace function pg_temp.act(uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  if uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

-- Back to the server (service role / postgres: auth.uid() is null)
create or replace function pg_temp.server() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  insert into results (check_name, ok) values (name, coalesce(cond, false));
  if not coalesce(cond, false) then raise exception 'FAILED: %', name; end if;
end $$;

-- Expects the statement to fail
create or replace function pg_temp.fails(name text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    insert into results (check_name, ok) values (name || ' -> ' || left(sqlerrm, 90), true);
    return;
  end;
  insert into results (check_name, ok) values (name, false);
  raise exception 'FAILED (should have been rejected): %', name;
end $$;

-- New functions are not executable by PUBLIC (20261107120400), so the helpers are granted explicitly
grant execute on function pg_temp.ok(text, boolean), pg_temp.fails(text, text), pg_temp.act(uuid), pg_temp.server()
  to anon, authenticated;

/* ---------- Accounts ---------- */

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '639171234567@phone.megs.local',
   '{"account_type":"customer","full_name":"Maria Santos","mobile_no":"+639171234567","terms_accepted":true}', now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '639175550123@phone.megs.local',
   '{"account_type":"customer","full_name":"Ana Cruz","mobile_no":"+639175550123","terms_accepted":true}', now(), now()),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff@megscafe.ph', '{"account_type":"staff"}', now(), now());

insert into public.staff_user (staff_id, username, email, full_name, cafe_id)
values ('00000000-0000-0000-0000-0000000000a1', 'staff', 'staff@megscafe.ph', 'Rina Bautista', 1);

select pg_temp.ok('FR-ACC-02 sign-up creates the customer at the Regular tier',
  (select t.name from public.customer c join public.tier t using (tier_id) where c.customer_id = '00000000-0000-0000-0000-0000000000c1') = 'Regular');
select pg_temp.ok('Staff metadata never creates a customer row',
  not exists (select 1 from public.customer where customer_id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.fails('FR-ACC-02 sign-up without accepting the terms',
  $s$insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
     (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@phone.megs.local',
      '{"account_type":"customer","full_name":"X","mobile_no":"+639170000000"}')$s$);
select pg_temp.fails('SRS 3.8 mobile number must be E.164',
  $s$insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
     (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'y@phone.megs.local',
      '{"account_type":"customer","full_name":"Y","mobile_no":"0917 123 4567","terms_accepted":true}')$s$);

/* ---------- Guest ---------- */

select pg_temp.act(null);
select pg_temp.ok('FR-ACC-01 guests can browse the menu', (select count(*) from public.menu_item) = 72);
select pg_temp.ok('FR-PRO-08 promo codes are never listed', not exists (select 1 from public.promotion where promotion_id = 'promo-megs10'));
select pg_temp.ok('Guests see the automatic offers', (select count(*) from public.promotion) = 5);
select pg_temp.fails('Guests cannot read orders', 'select 1 from public.orders');
select pg_temp.fails('Housekeeping runs from cron only', 'select public.housekeeping()');
select pg_temp.fails('Guests cannot redeem rewards', $s$select public.redeem_reward('free-drink')$s$);
select pg_temp.server();

/* ---------- Orders are placed by the server only ---------- */

select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
select pg_temp.fails('Customers cannot insert orders directly',
  $s$insert into public.orders (idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment, subtotal, total, eta)
     values (gen_random_uuid(), 1, '00000000-0000-0000-0000-0000000000c1', 'Maria', '+639171234567', 'pickup', 100, 100, now())$s$);
select pg_temp.server();

-- Order #1: pickup, counter payment, ₱480 subtotal, 5% tier discount
insert into public.orders (order_id, idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment,
  subtotal, tier_name, tier_discount, total, points_to_earn, eta)
values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000e1', 1,
  '00000000-0000-0000-0000-0000000000c1', 'Maria Santos', '+639171234567', 'pickup',
  48000, 'Regular', 2400, 45600, 456, now() + interval '10 minutes');
insert into public.order_line (order_id, item_id, item_name, unit_price, quantity)
values ('00000000-0000-0000-0000-00000000f001', 'carbonara', 'Carbonara', 18000, 1);
insert into public.payment (order_id, method, method_label, amount, status, provider_ref)
values ('00000000-0000-0000-0000-00000000f001', 'counter', 'Pay at counter', 45600, 'pending', 'REF-SECRET-1');

select pg_temp.ok('SRS 3.8 order numbers start at #1001 or later',
  (select order_no from public.orders where order_id = '00000000-0000-0000-0000-00000000f001') >= 1001);
select pg_temp.fails('IR-08 a retried submission never makes a second order',
  $s$insert into public.orders (idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment, subtotal, total, eta)
     values ('00000000-0000-0000-0000-0000000000e1', 1, '00000000-0000-0000-0000-0000000000c1', 'Maria', '+639171234567', 'pickup', 100, 100, now())$s$);
select pg_temp.fails('FR-CHK-04 totals must add up',
  $s$insert into public.orders (idempotency_key, cafe_id, customer_name, customer_mobile, fulfillment, subtotal, total, eta)
     values (gen_random_uuid(), 1, 'X', '+639170000000', 'pickup', 10000, 9000, now())$s$);
select pg_temp.fails('FR-CHK-03 no delivery fee on pickup',
  $s$insert into public.orders (idempotency_key, cafe_id, customer_name, customer_mobile, fulfillment, subtotal, delivery_fee, total, eta)
     values (gen_random_uuid(), 1, 'X', '+639170000000', 'pickup', 10000, 2500, 12500, now())$s$);
select pg_temp.fails('FR-CHK-02 delivery needs an address',
  $s$insert into public.orders (idempotency_key, cafe_id, customer_name, customer_mobile, fulfillment, subtotal, delivery_fee, total, eta)
     values (gen_random_uuid(), 1, 'X', '+639170000000', 'delivery', 10000, 2500, 12500, now())$s$);
select pg_temp.ok('Placing records the first status event',
  (select count(*) from public.order_status_event where order_id = '00000000-0000-0000-0000-00000000f001' and to_status = 'Received') = 1);
select pg_temp.ok('FR-TRK-03 the customer gets the "received" message',
  exists (select 1 from public.notification where order_id = '00000000-0000-0000-0000-00000000f001' and body like '%#' || (select order_no from public.orders where order_id = '00000000-0000-0000-0000-00000000f001') || '%'));

/* ---------- Customer view of the order ---------- */

select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok('Customers read their own order', (select count(*) from public.orders) = 1);
select pg_temp.ok('Customers see their payment status', (select status from public.payment) = 'pending');
select pg_temp.fails('IR-03 customers cannot read payment references', 'select provider_ref from public.payment');
select pg_temp.ok('IR-03 customers see no internal notes', (select count(*) from public.internal_note) = 0);
select pg_temp.fails('IR-02 customers cannot move an order on',
  $s$update public.orders set status = 'Accepted' where order_id = '00000000-0000-0000-0000-00000000f001'$s$);
select pg_temp.fails('SRS 3.8 customers cannot change totals',
  $s$update public.orders set total = 1 where order_id = '00000000-0000-0000-0000-00000000f001'$s$);
select pg_temp.fails('Customers cannot set their own points',
  $s$update public.customer set points_balance = 99999$s$);
select pg_temp.fails('FR-PRF-02 the mobile number is read-only',
  $s$update public.customer set mobile_no = '+639179999999'$s$);
update public.customer set notify_promotions = true;
select pg_temp.ok('OR-03 promotional consent is time-stamped', (select promo_consent_at is not null from public.customer));

select pg_temp.act('00000000-0000-0000-0000-0000000000c2');
select pg_temp.ok('Customers cannot see other customers'' orders', (select count(*) from public.orders) = 0);
select pg_temp.ok('Customers cannot see other customers'' profiles', (select count(*) from public.customer) = 1);
select pg_temp.server();

/* ---------- Staff work the queue (Table 3-1) ---------- */

select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok('Staff see the queue', (select count(*) from public.orders) = 1);
select pg_temp.fails('FR-STF-06 Received cannot jump to Preparing',
  $s$update public.orders set status = 'Preparing' where order_id = '00000000-0000-0000-0000-00000000f001'$s$);
select pg_temp.fails('FR-STF-08 a Received order cannot be delayed',
  $s$update public.orders set is_delayed = true, eta = now() + interval '20 minutes' where order_id = '00000000-0000-0000-0000-00000000f001'$s$);
update public.orders set status = 'Accepted' where order_id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.ok('Accept stamps the time', (select accepted_at is not null from public.orders where order_id = '00000000-0000-0000-0000-00000000f001'));
update public.orders set status = 'Received' where order_id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.ok('FR-STF-06 Accept can be undone at once', (select status from public.orders where order_id = '00000000-0000-0000-0000-00000000f001') = 'Received');
update public.orders set status = 'Accepted' where order_id = '00000000-0000-0000-0000-00000000f001';
update public.orders set is_delayed = true, eta = now() + interval '25 minutes' where order_id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.ok('FR-STF-08 an Accepted order can be delayed', (select is_delayed from public.orders where order_id = '00000000-0000-0000-0000-00000000f001'));
update public.orders set status = 'Preparing' where order_id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.ok('Table 3-1 Delayed clears when the status advances', (select not is_delayed from public.orders where order_id = '00000000-0000-0000-0000-00000000f001'));
insert into public.internal_note (order_id, body) values ('00000000-0000-0000-0000-00000000f001', 'Regular: extra napkins');
select pg_temp.ok('FR-STF-10 notes carry the author', (select author_name from public.internal_note) = 'Rina Bautista');
select pg_temp.ok('Staff read payment references through the staff function',
  (select provider_ref from public.staff_order_payments('00000000-0000-0000-0000-00000000f001')) = 'REF-SECRET-1');
select pg_temp.fails('Staff cannot change totals', $s$update public.orders set total = 1 where order_id = '00000000-0000-0000-0000-00000000f001'$s$);
update public.orders set status = 'Ready' where order_id = '00000000-0000-0000-0000-00000000f001';
update public.orders set status = 'Completed' where order_id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.fails('Completed is final', $s$update public.orders set status = 'Cancelled', cancel_reason_code = 'other', cancel_reason = 'x' where order_id = '00000000-0000-0000-0000-00000000f001'$s$);
select pg_temp.server();

select pg_temp.ok('FR-LOY-01 points credited on Completed',
  (select points_balance from public.customer where customer_id = '00000000-0000-0000-0000-0000000000c1') = 456);
select pg_temp.ok('SRS 3.8 balance equals the ledger sum',
  (select points_balance from public.customer where customer_id = '00000000-0000-0000-0000-0000000000c1')
  = (select sum(points) from public.points_txn where customer_id = '00000000-0000-0000-0000-0000000000c1'));
select pg_temp.fails('IR-05 an order earns points only once',
  $s$insert into public.points_txn (customer_id, type, points, order_id, description)
     values ('00000000-0000-0000-0000-0000000000c1', 'earn', 456, '00000000-0000-0000-0000-00000000f001', 'again')$s$);
select pg_temp.ok('Pay at counter is captured on completion',
  (select status from public.payment where order_id = '00000000-0000-0000-0000-00000000f001') = 'captured');
select pg_temp.ok('ORDER_STATUS_EVENT records every step (placed, accepted, undo, accepted, delayed, preparing, ready, completed)',
  (select count(*) from public.order_status_event where order_id = '00000000-0000-0000-0000-00000000f001') = 8);
select pg_temp.ok('NFR-SEC-06 staff status changes are audited',
  (select count(*) from public.audit_log where entity = 'orders' and entity_id = (select order_no::text from public.orders where order_id = '00000000-0000-0000-0000-00000000f001')) >= 5);
select pg_temp.ok('FR-TRK-03 Ready message names the counter',
  exists (select 1 from public.notification where order_id = '00000000-0000-0000-0000-00000000f001' and body like '%ready at the counter%'));

/* ---------- Rewards (FR-LOY-05, FR-LOY-06) ---------- */

select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
select public.redeem_reward('free-pastry');
select pg_temp.ok('FR-LOY-05 redeeming takes the points and issues a voucher',
  (select points_balance from public.customer) = 336 and (select count(*) from public.customer_reward where status = 'unused') = 1);
select pg_temp.ok('FR-LOY-05 the voucher expires 30 days after redemption',
  (select expires_on::date - redeemed_at::date from public.customer_reward) = 30);
select pg_temp.fails('3.2.7.5 a repeated redeem does not spend twice', $s$select public.redeem_reward('free-pastry')$s$);
select pg_temp.fails('FR-LOY-06 not enough points', $s$select public.redeem_reward('drink-pastry')$s$);
select pg_temp.ok('Failed redeems spent nothing', (select points_balance from public.customer) = 336);
select pg_temp.server();

/* ---------- Voucher + promo code on an order, then the customer cancels (FR-TRK-05, TBD-12) ---------- */

insert into public.orders (order_id, idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment,
  delivery_address, subtotal, tier_discount, promotion_id, promotion_label, promo_discount,
  customer_reward_id, reward_name, reward_discount, delivery_fee, total, points_to_earn, eta)
select '00000000-0000-0000-0000-00000000f002', gen_random_uuid(), 1, '00000000-0000-0000-0000-0000000000c1', 'Maria Santos',
  '+639171234567', 'delivery', '{"street":"12 Mabini St","barangay":"San Roque","city":"Quezon City"}',
  30000, 1500, 'promo-megs10', 'Promo MEGS10', 2850, cr.customer_reward_id, 'Free snack', 11000, 2500, 17150, 171,
  now() + interval '35 minutes'
from public.customer_reward cr where cr.customer_id = '00000000-0000-0000-0000-0000000000c1';
insert into public.payment (order_id, method, method_label, amount, status, provider_ref, authorized_at, captured_at)
values ('00000000-0000-0000-0000-00000000f002', 'card', 'Card ending 4242', 17150, 'captured', 'REF-2', now(), now());

select pg_temp.ok('The voucher is marked used with the order', (select status from public.customer_reward) = 'used');
select pg_temp.ok('The promo code use is recorded', (select count(*) from public.promotion_redemption) = 1);
select pg_temp.fails('TBD-12 MEGS10 once per customer',
  $s$insert into public.orders (idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment, subtotal,
     promotion_id, promo_discount, total, eta)
     values (gen_random_uuid(), 1, '00000000-0000-0000-0000-0000000000c1', 'Maria', '+639171234567', 'pickup', 30000,
     'promo-megs10', 3000, 27000, now())$s$);
select pg_temp.fails('IR-04 a used voucher cannot pay for another order',
  $s$insert into public.orders (idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment, subtotal,
     customer_reward_id, reward_discount, total, eta)
     select gen_random_uuid(), 1, '00000000-0000-0000-0000-0000000000c1', 'Maria', '+639171234567', 'pickup', 30000,
     customer_reward_id, 11000, 19000, now() from public.customer_reward$s$);

select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
update public.orders set status = 'Cancelled' where order_id = '00000000-0000-0000-0000-00000000f002';
select pg_temp.server();

select pg_temp.ok('FR-TRK-04 the customer cancelled while Received',
  (select status = 'Cancelled' and cancelled_by = 'customer' from public.orders where order_id = '00000000-0000-0000-0000-00000000f002'));
select pg_temp.ok('FR-TRK-05 the in-app payment is refunded',
  (select status from public.payment where order_id = '00000000-0000-0000-0000-00000000f002') = 'refunded');
select pg_temp.ok('FR-TRK-05 the voucher is restored', (select status from public.customer_reward) = 'unused');
select pg_temp.ok('TBD-12 the promo code use is given back', (select count(*) from public.promotion_redemption) = 0);
select pg_temp.ok('IR-05 a cancelled order earns no points',
  not exists (select 1 from public.points_txn where order_id = '00000000-0000-0000-0000-00000000f002'));
select pg_temp.ok('NFR-SEC-06 cancellations are audited',
  exists (select 1 from public.audit_log where action = 'order.cancel' and entity_id = (select order_no::text from public.orders where order_id = '00000000-0000-0000-0000-00000000f002')));

/* ---------- Customer cannot cancel once Preparing (IR-02); staff need a reason (FR-STF-07) ---------- */

insert into public.orders (order_id, idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment, subtotal, total, eta)
values ('00000000-0000-0000-0000-00000000f003', gen_random_uuid(), 1, '00000000-0000-0000-0000-0000000000c1',
  'Maria Santos', '+639171234567', 'pickup', 12000, 12000, now() + interval '10 minutes');
select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
update public.orders set status = 'Accepted' where order_id = '00000000-0000-0000-0000-00000000f003';
update public.orders set status = 'Preparing' where order_id = '00000000-0000-0000-0000-00000000f003';
select pg_temp.fails('FR-STF-07 staff must give a cancel reason', $s$update public.orders set status = 'Cancelled' where order_id = '00000000-0000-0000-0000-00000000f003'$s$);
select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
select pg_temp.fails('IR-02 no customer cancel once Preparing', $s$update public.orders set status = 'Cancelled' where order_id = '00000000-0000-0000-0000-00000000f003'$s$);
select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
update public.orders set status = 'Cancelled', cancel_reason_code = 'out_of_stock' where order_id = '00000000-0000-0000-0000-00000000f003';
select pg_temp.server();
select pg_temp.ok('FR-STF-07 the reason is filled from the code',
  (select cancel_reason from public.orders where order_id = '00000000-0000-0000-0000-00000000f003') = 'Out of stock');
select pg_temp.ok('Cancelled-by-cafe message carries the reason',
  exists (select 1 from public.notification n join public.orders o using (order_id) where o.order_id = '00000000-0000-0000-0000-00000000f003' and n.body like '%out of stock%'));

/* ---------- Templates, settings, availability (FR-ART, FR-OPS, NFR-SEC-06) ---------- */

select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails('IR-07 critical templates cannot be disabled',
  $s$update public.response_template set enabled = false where event = 'order_accepted'$s$);
select pg_temp.fails('FR-ART-03 unknown variables are rejected',
  $s$update public.response_template set body = 'Hi {first_name}' where event = 'order_preparing'$s$);
select pg_temp.fails('FR-ART-02 push messages are 160 characters at most',
  $s$update public.response_template set body = repeat('a', 161) where event = 'order_cancelled_customer'$s$);
update public.response_template set body = 'We''re making order #{order_number} now.' where event = 'order_preparing';
select pg_temp.ok('Template edits record who and when',
  (select last_edited_by_name from public.response_template where event = 'order_preparing') = 'Rina Bautista');
update public.store_settings set accepting_orders = false;
update public.menu_item set is_available = false, unavailable_reason = 'Out of beans' where item_id = 'latte';
select pg_temp.fails('Staff cannot change the points rate (not granted)', $s$update public.store_settings set points_per_peso = 10$s$);
select pg_temp.fails('Staff cannot rename menu items (sheet owns them)', $s$update public.menu_item set name = 'x' where item_id = 'latte'$s$);
select pg_temp.server();
select pg_temp.ok('NFR-SEC-06 template, settings and availability edits are audited',
  (select count(distinct entity) from public.audit_log where entity in ('response_template', 'store_settings', 'menu_item')) = 3);

/* ---------- Menu data matches the sheet ---------- */

select pg_temp.ok('Drinks are priced per size: Mocha 22 oz is ₱135.00',
  (select v.price from public.option_value v join public.option_group g using (group_id)
    where g.item_id = 'mocha' and g.is_size and v.label = 'Cold · 22 oz') = 13500);
select pg_temp.ok('Every drink has exactly one default size',
  not exists (select 1 from public.option_group g where g.is_size
    and (select count(*) from public.option_value v where v.group_id = g.group_id and v.is_default) <> 1));
select pg_temp.ok('Every item has a price (single price or sizes)',
  not exists (select 1 from public.menu_item i where i.price is null
    and not exists (select 1 from public.option_group g where g.item_id = i.item_id and g.is_size)));

table results;
rollback;
