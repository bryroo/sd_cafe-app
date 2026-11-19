-- Indexes that EXPLAIN ANALYZE showed a benefit for (DB_AUDIT.md findings 6 and 7; 20k-order load,
-- supabase/audit/explain_load.sql). Plain CREATE INDEX: migrations run in a transaction, so CONCURRENTLY
-- is not possible, and these tables are small in production today.
--
-- Rollback: drop index public.<name>; for each index below. Nothing else depends on them.

-- Staff queue: latest 300 orders by placed_at (loadStaff). 13 ms -> 7 ms after the RLS fix.
create index if not exists orders_placed_at on public.orders (placed_at desc);

-- Offers already used by a customer: place-order, check_promo_code(), loadCustomer.
create index if not exists promotion_redemption_customer on public.promotion_redemption (customer_id);

-- ON DELETE SET NULL targets: deleting a saved address, payment method, order or voucher scanned the
-- whole referencing table. Measured: 3.8 -> 0.4 ms, 2.3 -> 0.7 ms, 2.9 -> 0.4 ms, 2.6 -> 0.5 ms.
create index if not exists orders_address on public.orders (address_id) where address_id is not null;
create index if not exists payment_payment_method on public.payment (payment_method_id) where payment_method_id is not null;
create index if not exists notification_order on public.notification (order_id) where order_id is not null;
create index if not exists points_txn_customer_reward on public.points_txn (customer_reward_id) where customer_reward_id is not null;
