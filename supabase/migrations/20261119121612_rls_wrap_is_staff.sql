-- RLS performance: call is_staff() once per query, not once per row (DB_AUDIT.md finding 5).
-- Wrapping a STABLE function in a scalar sub-select lets Postgres run it as an InitPlan. The rows each role
-- can see or change are exactly the same as before. On 20k orders the staff queue went from 277 ms to 13 ms.
--
-- Rollback: run the same ALTER POLICY statements with `public.is_staff()` in place of
-- `(select public.is_staff())` (the original text is in 20261107120100_rules_and_security.sql).

alter policy "Customers read own addresses" on public.address
  using (customer_id = (select auth.uid()) or (select public.is_staff()));
alter policy "Staff read audit log" on public.audit_log
  using ((select public.is_staff()));
alter policy "Staff read automated orders" on public.automated_order
  using ((select public.is_staff()));
alter policy "Customers read own profile" on public.customer
  using (customer_id = (select auth.uid()) or (select public.is_staff()));
alter policy "Customers read own vouchers" on public.customer_reward
  using (customer_id = (select auth.uid()) or (select public.is_staff()));
alter policy "Staff add internal notes" on public.internal_note
  with check ((select public.is_staff()));
alter policy "Staff read internal notes" on public.internal_note
  using ((select public.is_staff()));
alter policy "Anyone can read active categories" on public.menu_category
  using (is_active or (select public.is_staff()));
alter policy "Anyone can read active items" on public.menu_item
  using (is_active or (select public.is_staff()));
alter policy "Staff update item availability" on public.menu_item
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "Customers read own orders" on public.orders
  using (customer_id = (select auth.uid()) or (select public.is_staff()));
alter policy "Customers cancel own orders; staff work the queue" on public.orders
  using (customer_id = (select auth.uid()) or (select public.is_staff()))
  with check (customer_id = (select auth.uid()) or (select public.is_staff()));
alter policy "Customers read own points" on public.points_txn
  using (customer_id = (select auth.uid()) or (select public.is_staff()));
alter policy "Customers read own promo uses" on public.promotion_redemption
  using (customer_id = (select auth.uid()) or (select public.is_staff()));
alter policy "Staff read templates" on public.response_template
  using ((select public.is_staff()));
alter policy "Staff edit templates" on public.response_template
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "Staff read staff" on public.staff_user
  using ((select public.is_staff()) or staff_id = (select auth.uid()));
alter policy "Staff update store settings" on public.store_settings
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
