# MEGS' Cafe database audit

Date: 2026-11-19. Branch: `supabase-data-layer`. Scope: the `public` schema. Supabase-managed schemas (auth, storage, realtime, cron) were only read.

**Where it ran:** the local stack (`npx supabase start`) with all 7 migrations and the demo seed (9 orders, 6 customers, 3 staff). Production (`mqjttxhosdepvejghraa`) was not connected to. For performance, 20,000 synthetic orders were loaded inside a transaction that was rolled back. Exploit checks also ran in rolled-back transactions. The scripts are in [supabase/audit/](supabase/audit/) so they can be re-run.

The changes made in response are in [DB_PLAN.md](DB_PLAN.md).

---

## 1. Findings ranked by risk

| # | Risk | Finding | Fix | Category |
|---|---|---|---|---|
| 1 | **Critical** | `demo_set_order_state` lets any signed-in customer rewrite **any** order (status, fulfillment, total, timeline, messages) | M5 | Safe to fix |
| 2 | **Critical** | `demo_set_points` lets any signed-in customer set their own balance to anything, then redeem every reward | M3–M5 | Fix approved (demo accounts only) |
| 3 | **High** | Anon can lock out any customer or staff member (`login_failed` ×5) and clear any lockout (`login_succeeded`). The lockout is checked only in the client, so calling Auth directly skips it | M6 (+ M6b later) | Fix approved (sign-in function) |
| 4 | **Medium** | `customer_login_address(email)` (anon) returns `639…@phone.megs.local`, which reveals the mobile number behind an email | M6 (+ M6b) | Fix approved |
| 5 | Medium (perf) | `is_staff()` in 15 policies isn't wrapped in `(select …)`, so it runs once per row | M1 | Safe to fix |
| 6 | Low (perf) | Staff queue sorts all orders by `placed_at`, with no index | M2 | Safe to fix |
| 7 | Low (perf) | 20 unindexed foreign keys; a few sit on filtered columns or delete paths | M2 (subset) | Safe to fix |
| 8 | Low (perf) | Staff console fetches **all** payments (`staff_payments()`) on every reload | M7 | Safe to fix |
| 9 | Low (perf) | `setStore` availability loop: one update plus a full 4–8-query reload per item (N+1) | app commit | Safe to fix |
| 10 | Low | `staff_login_address` (anon) reveals staff emails by username | M6 (+ M6b) | Fix approved |
| 11 | Needs your decision (launch) | Sign-up trusts the mobile number in metadata with no OTP, so someone can register another person's number | — | Deferred to SMS OTP work |
| 12 | Needs your decision (launch) | The client creates `payment_method.provider_token` itself (test tokens) | — | Deferred to payment gateway |
| 13 | Needs your decision (launch) | `store_settings.demo_mode` defaults to `true` and is on in production | — | Turn off before launch |
| 14 | Low | `delete-account` anonymizes orders, then deletes the user, in separate calls (not atomic) | — | Recorded only |
| 15 | Low | No `updated_at` on `reward`, `promotion`, `menu_category`, `option_group`, `option_value`, `tier` | — | Recorded only |
| 16 | Info | `customer_reward.expires_on` is a timestamptz despite the `_on` name | — | Recorded only (rename would be a two-step change) |

### Proof for 1–4 (rolled-back transaction, local)

```
before | 1031 | Maria Santos | Completed | pickup   | 10400
-- signed in as a different customer (Carlo); his normal SELECT sees 0 rows of #1031
select public.demo_set_order_state(1031, 'Cancelled', 'delivery');
select public.demo_set_points(99999);
after  | 1031 | Cancelled | delivery | 12900 | Out of stock
attacker points | 99999

-- as anon
select public.login_failed('manager','staff') x5  -> locked_until set
select public.staff_login_address('manager')      -> manager@megscafe.ph
select public.customer_login_address('09171234567') -> 639171234567@phone.megs.local
```

---

## 2. Security

| Check | Result |
|---|---|
| Public tables with RLS disabled | **0** of 26 |
| RLS enabled, no policies | 1: `login_attempt` (intentional: server functions only, no grants) |
| `USING (true)` policies | `store_settings`, `tier`, `option_group`, `option_value` SELECT for anon/authenticated. Public catalog by design (FR-ACC-01); nothing sensitive |
| Policies calling `auth.uid()` directly | **0**. All use `(select auth.uid())` |
| Policies calling `is_staff()` per row | **15** (finding 5) |
| Indexes on policy columns | `customer_id` is indexed on every customer-owned table. `order_id` is indexed on `order_line`, `order_status_event`, `payment`. `customer.customer_id` and `staff_user.staff_id` are PKs |
| Views / SECURITY DEFINER views | **0** views |
| SECURITY DEFINER functions without fixed `search_path` | **0**. All 30+ use `search_path = ''` |
| Functions callable by anon | 7: `customer_login_address`, `staff_login_address`, `login_failed`, `login_succeeded`, `login_locked_until`, `is_mobile_registered`, `demo_mode_on`, `is_staff` (findings 3, 4, 10). `is_mobile_registered` is by design (SRS 3.2.1.5) |
| Functions callable by authenticated only | `check_promo_code`, `current_actor`, `redeem_reward`, `staff_order_payments`, `staff_payments`, `demo_set_order_state`, `demo_set_points` (findings 1, 2) |
| Storage buckets / bucket policies | **None exist** |
| service_role in client code | **None**. Only in Edge Functions (`SUPABASE_SERVICE_ROLE_KEY` env) and `scripts/create-staff.mjs` (`SUPABASE_SECRET_KEY` env, run by hand). `.env*` is git-ignored |
| `user_metadata` used for authorization | No. `handle_new_auth_user` reads it only to fill the customer profile; staff are never created from metadata |
| Realtime column leaks | None. `realtime.apply_rls` checks column privileges, so `payment.provider_ref`/`failure_reason` don't reach customers |

---

## 3. Design

Strong overall: every table has a PK. Money is integer centavos. All timestamps are `timestamptz`. Statuses are enums. Business invariants are CHECK constraints or partial unique indexes (one default address, one live use per voucher, earn once per order, etc.). Order contents are frozen by trigger.

Gaps (low): findings 14–16. `store_settings.updated_by` and `audit_log.actor_id` have no FK, which is intentional for audit (the actor may be deleted). `orders.customer_mobile` has no format check because it is anonymized to `—` on deletion.

---

## 4. Data quality (local demo data, counts)

Production data was **not** checked; run [supabase/audit/data_quality.sql](supabase/audit/data_quality.sql) against it read-only if you want those counts.

| Check | Count | Note |
|---|---|---|
| balance != ledger sum | 0 | |
| orders without lines | 0 | |
| orders without payment | 0 | |
| orders with >1 payment | 0 | |
| orders without status events | 0 | |
| orders unlinked from customer (customer_id null) | 0 | |
| payment amount != order total | 0 | |
| subtotal != sum(line_total) | 0 | |
| status timestamp missing | 0 | |
| completed order w/o earn txn | 0 | |
| earn txn on non-completed order | 0 | |
| voucher used but no live order | 0 | |
| voucher unused but past expiry | 0 | |
| redemption for cancelled order | 0 | |
| cancelled order with captured/authorized payment | 0 | |
| notifications older than 90 days | 0 | |
| stale login_attempt rows | 1 | Local cron didn't run while Docker was off; housekeeping clears it |
| auth users with no customer/staff row | 0 | |
| customer.email collides with a staff email | 0 | |
| customers with unverified mobile | 0 | |
| staff without email | 0 | |
| items with no price and no size group | 0 | |
| items with price AND a size group | 0 | |
| required option group with no values | 0 | |
| pick-one group with >1 default | 0 | |
| active items in inactive category | 0 | |
| unavailable item with no reason | 0 | |
| order_line.item_id null | 0 | |
| order_line_option.value_id null | 0 | |
| automation succeeded w/o linked order | 0 | |
| automation with null customer_id | 0 | |
| published promotion already ended | 3 | Expected: past demo campaigns; the server checks the window |
| promotion rule type unknown | 0 | |
| delivery order with address_id null | 1 | Expected: saved address deleted; `delivery_address` snapshot kept |
| eta before placed_at | 0 | |
| audit_log.actor_id not a user | 4 | Expected: actors deleted by demo resets |
| store_settings.updated_by not a user | 0 | |

No cleanup migrations are needed.

---

## 5. Performance

### Advisors and lint (local, before)
- `supabase db advisors --level info`: **0 ERROR, 0 WARN**, 36 INFO (20 `unindexed_foreign_keys`, 15 `unused_index`, 1 `rls_enabled_no_policy`).
- `unused_index`: stats were just reset and every table is under 200 kB, so this tells us nothing. **No index is dropped.**
- `supabase db lint`: no errors.
- `inspect db` (table-stats, index-stats, bloat, outliers, long-running-queries, vacuum-stats): all tables under 200 kB, no bloat, no long-running queries. Expected on demo data.

### EXPLAIN ANALYZE (20,009 orders, rolled back)

| Query (app source) | Before | `(select is_staff())` | + `orders(placed_at desc)` |
|---|---|---|---|
| Q1 customer's orders with lines/events/payment (`loadCustomer`, 3,334 orders for one customer) | 81 ms | 131 ms* | 93 ms* |
| Q2 customer's notifications | 2 ms | – | – |
| Q2b `order_line` read through RLS only | **200 ms** | 9 ms | 11 ms |
| Q3 staff queue, latest 300 with lines/events (`loadStaff`) | **277 ms** | 13 ms | **7 ms** |
| Q4 `staff_payments()` (all 20k rows) | 10 ms + 20k rows over the wire | – | M7 limits to 300 |
| Q5 open queue by status | **268 ms** | 13 ms | 19 ms* |

\* Run-to-run noise on a laptop. Q1 is dominated by the 3 per-order subqueries over 3,334 orders, an unrealistic count for one customer.

### Unindexed foreign keys worth indexing (M2 candidates)
`promotion_redemption.customer_id` (filtered by place-order, check_promo_code, loadCustomer), `orders.address_id`, `payment.payment_method_id`, `notification.order_id`, `points_txn.customer_reward_id`, `automated_order.customer_id` (delete and SET NULL paths). The rest point at small lookup tables (tier, store, template, staff, category, menu item) and are left alone.

### Client patterns
- No supabase-js calls inside loops except `setStore` availability (finding 9).
- Every Realtime event and the 15 s poll reload all of the person's data. That's acceptable at this scale; the staff payments part is fixed by M7.

---

## 6. Code coupling

| Object | Readers / writers |
|---|---|
| `orders` | client `loadCustomer`, `loadStaff`, `moveOrder`, `undoAccept`, `markDelayed` ([src/state/shared.ts](src/state/shared.ts)); `place-order`, `delete-account`, `demo-reset/seed.ts`; `create_order()`; triggers `orders_before/after_insert/update`; Realtime |
| `order_line`, `order_line_option`, `order_status_event`, `payment` | client (embedded in `ORDER_COLUMNS`); `create_order()`; triggers; `staff_payments()`, `staff_order_payments()` |
| `customer` | client `loadCustomer`, `saveProfile`; `place-order`, `delete-account`, `staff-automations`, `seed.ts`; `handle_new_auth_user`, `customer_guard`, `points_txn_apply` |
| `points_txn`, `customer_reward`, `promotion_redemption` | client `loadCustomer`, `redeem` (`redeem_reward()`); `place-order`; `seed.ts`; order triggers |
| `address`, `payment_method` | client `saveAddress`, `addPaymentMethod`; `place-order`; `seed.ts` |
| `menu_*`, `option_*`, `reward`, `promotion`, `tier`, `store_settings` | client [src/data/catalog.ts](src/data/catalog.ts), `setStore`; Edge `loadCatalog()` ([supabase/functions/_shared/server.ts](supabase/functions/_shared/server.ts)) |
| `response_template`, `notification` | client `loadStaff`, `setTemplate`, `markNoteRead`; `notify_order()` |
| `automated_order` | client `loadStaff`; `staff-automations`, `seed.ts`, `delete-account` |
| `login_attempt` + login RPCs | client `signIn()`; `seed.ts` |
| `demo_set_order_state`, `demo_set_points` | client screen index only |
| `create_order`, `sync_order_no_seq` | `place-order`, `_shared/automation.ts`, `seed.ts` |
