-- Loads 20k synthetic orders, EXPLAINs the app's main queries as a customer and as staff, then ROLLS BACK.
-- Local only: docker exec -i supabase_db_MEGS-Cafe-App psql -U postgres -q < supabase/audit/explain_load.sql
\pset pager off
begin;
select 'cron jobs', jobname, schedule, active from cron.job;
select 'cron last runs', status, count(*), max(start_time) from cron.job_run_details group by 1,2;
create temp table cust as select customer_id, row_number() over (order by customer_id) rn from public.customer;
grant select on cust to authenticated;
insert into public.orders (idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment, subtotal, total, eta, placed_at, status)
select gen_random_uuid(), 1, c.customer_id, 'Load Test', '+639170000000', 'pickup', 10000, 10000, now()+interval '10 min',
       now() - (g || ' minutes')::interval, 'Received'
from generate_series(1,20000) g join cust c on c.rn = 1 + (g % (select count(*) from cust));
insert into public.order_line (order_id, item_id, item_name, unit_price, quantity)
select order_id, null, 'Latte', 10000, 1 from public.orders where customer_name='Load Test';
insert into public.payment (order_id, method, method_label, amount, status)
select order_id, 'counter', 'Pay at counter', 10000, 'pending' from public.orders where customer_name='Load Test';
analyze public.orders; analyze public.order_line; analyze public.payment; analyze public.notification; analyze public.order_status_event;
select 'rows', (select count(*) from public.orders), (select count(*) from public.notification), (select count(*) from public.order_status_event);

-- as a customer
select set_config('request.jwt.claims', json_build_object('sub',(select customer_id from cust where rn=1),'role','authenticated')::text, true);
set local role authenticated;
\echo ===== Q1 customer: own orders with lines/events/payment (loadCustomer)
explain (analyze, buffers, costs off, timing on, summary on)
select o.*, (select json_agg(l) from public.order_line l where l.order_id=o.order_id) lines,
       (select json_agg(e) from public.order_status_event e where e.order_id=o.order_id) ev,
       (select json_agg(p) from (select payment_id, method, method_label, amount, status from public.payment p where p.order_id=o.order_id) p) pay
from public.orders o where o.customer_id=(select customer_id from cust where rn=1) order by placed_at desc;
\echo ===== Q2 customer: notifications
explain (analyze, costs off, summary on)
select notification_id, title from public.notification where customer_id=(select customer_id from cust where rn=1) order by created_at desc;
\echo ===== Q2b customer: order_line without filter (RLS EXISTS policy only)
explain (analyze, costs off, summary on) select count(*) from public.order_line;
reset role;

-- as staff
select set_config('request.jwt.claims', json_build_object('sub',(select staff_id from public.staff_user limit 1),'role','authenticated')::text, true);
set local role authenticated;
\echo ===== Q3 staff: queue, latest 300 orders with lines/events (loadStaff)
explain (analyze, buffers, costs off, summary on)
select o.*, (select json_agg(l) from public.order_line l where l.order_id=o.order_id) lines,
       (select json_agg(e) from public.order_status_event e where e.order_id=o.order_id) ev
from public.orders o order by placed_at desc limit 300;
\echo ===== Q4 staff: staff_payments() (all payments, every reload)
explain (analyze, costs off, summary on) select * from public.staff_payments();
\echo ===== Q5 staff: open queue by status
explain (analyze, costs off, summary on) select order_id from public.orders where cafe_id=1 and status in ('Received','Accepted','Preparing','Ready') order by placed_at;
reset role;
rollback;
