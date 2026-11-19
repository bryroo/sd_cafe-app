-- Data quality counts (read-only). Run: docker exec -i supabase_db_MEGS-Cafe-App psql -U postgres -At < supabase/audit/data_quality.sql
select 'balance != ledger sum' chk, count(*) from public.customer c where c.points_balance <> coalesce((select sum(points) from public.points_txn p where p.customer_id=c.customer_id),0)
union all select 'orders without lines', count(*) from public.orders o where not exists (select 1 from public.order_line l where l.order_id=o.order_id)
union all select 'orders without payment', count(*) from public.orders o where not exists (select 1 from public.payment p where p.order_id=o.order_id)
union all select 'orders with >1 payment', count(*) from (select order_id from public.payment group by 1 having count(*)>1) x
union all select 'orders without status events', count(*) from public.orders o where not exists (select 1 from public.order_status_event e where e.order_id=o.order_id)
union all select 'orders unlinked from customer (customer_id null)', count(*) from public.orders where customer_id is null
union all select 'payment amount != order total', count(*) from public.payment p join public.orders o using(order_id) where p.amount<>o.total
union all select 'subtotal != sum(line_total)', count(*) from public.orders o where o.subtotal <> (select coalesce(sum(line_total),0) from public.order_line l where l.order_id=o.order_id)
union all select 'status timestamp missing', count(*) from public.orders where (status in ('Accepted','Preparing','Ready','Completed') and accepted_at is null) or (status in ('Preparing','Ready','Completed') and preparing_at is null) or (status in ('Ready','Completed') and ready_at is null) or (status='Completed' and completed_at is null)
union all select 'completed order w/o earn txn (points_to_earn>0)', count(*) from public.orders o where status='Completed' and points_to_earn>0 and customer_id is not null and not exists (select 1 from public.points_txn p where p.order_id=o.order_id and p.type='earn')
union all select 'earn txn on non-completed order', count(*) from public.points_txn p join public.orders o using(order_id) where p.type='earn' and o.status<>'Completed'
union all select 'voucher used but no live order', count(*) from public.customer_reward cr where status='used' and not exists (select 1 from public.orders o where o.customer_reward_id=cr.customer_reward_id and o.status<>'Cancelled')
union all select 'voucher unused but past expiry', count(*) from public.customer_reward where status='unused' and expires_on<=now()
union all select 'redemption for cancelled order', count(*) from public.promotion_redemption r join public.orders o using(order_id) where o.status='Cancelled'
union all select 'refund state mismatch (cancelled + captured/authorized)', count(*) from public.payment p join public.orders o using(order_id) where o.status='Cancelled' and p.status in ('authorized','captured')
union all select 'notifications older than 90d', count(*) from public.notification where created_at < now()-interval '90 days'
union all select 'stale login_attempt rows', count(*) from public.login_attempt where coalesce(locked_until,updated_at) < now()-interval '1 day'
union all select 'auth users with no customer/staff row', count(*) from auth.users u where not exists (select 1 from public.customer c where c.customer_id=u.id) and not exists (select 1 from public.staff_user s where s.staff_id=u.id)
union all select 'customer.email collides with a staff email', count(*) from public.customer c join public.staff_user s on s.email=c.email
union all select 'customers mobile unverified', count(*) from public.customer where mobile_verified_at is null
union all select 'staff_user without email', count(*) from public.staff_user where email is null
union all select 'items with no price and no size group', count(*) from public.menu_item i where price is null and not exists (select 1 from public.option_group g where g.item_id=i.item_id and g.is_size)
union all select 'items with price AND a size group', count(*) from public.menu_item i where price is not null and exists (select 1 from public.option_group g where g.item_id=i.item_id and g.is_size)
union all select 'required option group with no values', count(*) from public.option_group g where is_required and not exists (select 1 from public.option_value v where v.group_id=g.group_id)
union all select 'pick-one group with >1 default', count(*) from (select g.group_id from public.option_group g join public.option_value v using(group_id) where g.pick='one' and v.is_default group by 1 having count(*)>1) x
union all select 'active items in inactive category', count(*) from public.menu_item i join public.menu_category c using(category_id) where i.is_active and not c.is_active
union all select 'unavailable item with no reason', count(*) from public.menu_item where not is_available and unavailable_reason is null
union all select 'order_line item_id null (menu item deleted)', count(*) from public.order_line where item_id is null
union all select 'order_line_option value_id null', count(*) from public.order_line_option where value_id is null
union all select 'automation succeeded w/o linked order', count(*) from public.automated_order where state='succeeded' and linked_order_id is null
union all select 'automation with null customer_id', count(*) from public.automated_order where customer_id is null
union all select 'promotion window already ended but published', count(*) from public.promotion where is_published and ends_at<now()
union all select 'promotion rule type unknown to engine', count(*) from public.promotion where rule->>'type' not in (select distinct rule->>'type' from public.promotion)
union all select 'delivery orders with address_id null', count(*) from public.orders where fulfillment='delivery' and address_id is null
union all select 'eta before placed_at', count(*) from public.orders where eta < placed_at
union all select 'audit_log actor_id not a user', count(*) from public.audit_log a where actor_id is not null and not exists (select 1 from auth.users u where u.id=a.actor_id)
union all select 'store_settings.updated_by not a user', count(*) from public.store_settings s where updated_by is not null and not exists (select 1 from auth.users u where u.id=s.updated_by);
