# MEGS' Cafe database: audit findings and change plan

## Context
You asked for a read-only audit of the Supabase database, then a plan, before anything changes. The audit ran against the **local** stack only (`supabase start`, Docker, demo seed: 9 orders, 6 customers, 3 staff). The only linked project is production (`mqjttxhosdepvejghraa`) and nothing touched it. For realistic EXPLAIN numbers I loaded 20,000 synthetic orders inside a transaction and rolled it back. Exploit checks also ran in rolled-back transactions.

On approval, the first step writes the full findings to `DB_AUDIT.md` and this plan to `DB_PLAN.md`. Raw outputs, the "before" baseline, are in `C:\Users\PAULAN~1\AppData\Local\Temp\claude\48ee8349f062073f\fc78c450-a732-4d06-aaca-08cd141127fd\scratchpad\before\`.

## Audit summary (ranked by risk)

### Critical: confirmed and live in production (demo_mode is on there)
1. **Any signed-in customer can rewrite any order.** `demo_set_order_state` (SECURITY DEFINER, granted to `authenticated`) has no ownership check. Test: customer B turned Maria's Completed #1031 into a Cancelled delivery with a new total. Sign-up is open, so anyone can do this.
2. **Any customer can set their own points to anything** with `demo_set_points(99999)`, then redeem every reward.
3. **Anyone (anon) can lock out any account**, for example staff `manager`, with 5 calls to `login_failed`, and can clear any lockout with `login_succeeded`. The lockout is enforced only by the client, so calling Auth directly skips it.
4. **Email-to-mobile lookup (anon):** `customer_login_address('x@y.com')` returns `639XXXXXXXXX@phone.megs.local`, which reveals the account's mobile number. `staff_login_address` reveals staff emails (low).

### Performance (measured on 20k orders)
5. The 18 policies that call `public.is_staff()` do it without `(select …)`, so it runs **once per row**. Staff queue (latest 300): **277 ms**. Open queue: **268 ms**. RLS-only `order_line` read: **200 ms**. Wrapped (trial, rolled back): **13 / 13 / 9 ms**. Adding `orders(placed_at desc)` brings the staff queue to **7 ms**. The policies already use `(select auth.uid())` correctly.
6. Advisors (local, `--level info`): 0 ERROR, 0 WARN. 20 × `unindexed_foreign_keys`, 15 × `unused_index` (not meaningful: stats just reset, tables under 200 kB, so keep them all), 1 × `rls_enabled_no_policy` (`login_attempt`, intentional: server only).
7. Client chattiness: the staff console runs `staff_payments()` over **all** payments on every reload (every 15 s and on every Realtime event). In `setStore`, each sold-out toggle runs its own update **plus a full reload** in a loop: an N+1 ([src/state/shared.ts:999](src/state/shared.ts#L999)).

### Clean (no action)
- RLS is on for all 26 public tables. No views. Every SECURITY DEFINER function has `search_path=''`. No storage buckets. No service-role key in client code (only in Edge Functions and the `scripts/create-staff.mjs` env var). `.env*` is git-ignored. Realtime's `apply_rls` respects column grants, so `payment.provider_ref` doesn't leak. `db lint`: no errors.
- Data quality (37 checks with counts): ledger = balance, totals add up, no orphans or duplicates. The only nonzero counts are expected: 3 published promos already ended, 1 delivery order whose saved address was deleted (its snapshot is kept), 4 audit rows from users deleted by demo resets, and 1 stale `login_attempt` because local cron didn't run while Docker was off.
- Types and constraints are strong: timestamptz everywhere, integer centavos, enums, CHECKs, partial unique indexes.

### Recorded in DB_AUDIT.md, no change in this plan (your call later)
Unverified mobile at sign-up lets someone squat a number (waits for SMS OTP). The client writes `payment_method.provider_token` itself (fine for test tokens, must be server-issued once a real gateway exists). `delete-account` isn't atomic (orders are anonymized before the user delete). There's no `updated_at` on `reward`, `promotion`, `menu_category` or the option tables. `customer_reward.expires_on` is a timestamptz despite the "_on" name. `demo_mode` defaults to true and must be switched off before launch. With the new sign-in function, all password checks reach Auth from the Edge Function's IPs, so review the Auth sign-in rate limit (see the risk under M6).

## Code coupling (what each change touches)
| Object | Read/written by |
|---|---|
| `orders` policies / `is_staff()` | client `loadCustomer`, `loadStaff`, `moveOrder`, `undoAccept`, `markDelayed` ([src/state/shared.ts](src/state/shared.ts)); Realtime; rules_check.sql |
| `demo_set_order_state`, `demo_set_points` | client screen index ([src/state/shared.ts:1101-1109](src/state/shared.ts#L1101)) |
| `customer` (new `is_demo`) | `demo-reset/seed.ts`, place-order, delete-account, staff-automations, client `loadCustomer`/`saveProfile` |
| login RPCs | client `signIn()` ([src/state/shared.ts:1021](src/state/shared.ts#L1021)) only |
| `staff_payments()` | client `loadStaff` only |
| `create_order`, `sync_order_no_seq` | place-order, staff-automations (`_shared/automation.ts`), demo-reset: **unchanged** |

## Migrations (ordered; one commit each; each commit regenerates `src/lib/database.types.ts`)
Each is created with `npx supabase migration new <name>`. None of them is destructive. Every function signature, table and column the client uses stays as it is.

**M1 `rls_wrap_is_staff`** (schema/policy). `alter policy` on the 18 policies that call `is_staff()`, changing it to `(select public.is_staff())`. Same rows visible to every role.
*Breaks:* nothing (same semantics). *Rollback:* `alter policy` back to the original text (kept in the migration comment).

**M2 `orders_and_fk_indexes`** (schema). `orders (placed_at desc)` is proven by the EXPLAIN above. Candidates, each kept only if EXPLAIN on its real query or cascade shows a benefit:
- `promotion_redemption (customer_id)`: place-order, check_promo_code, loadCustomer
- `orders (address_id) where not null`: address delete → SET NULL
- `payment (payment_method_id) where not null`: payment method delete
- `notification (order_id) where not null`
- `points_txn (customer_reward_id) where not null`
- `automated_order (customer_id) where not null`: account delete

FKs on small lookup tables (tier, store, template, staff, category) stay unindexed. These are plain `CREATE INDEX`: migrations run inside a transaction, so `CONCURRENTLY` isn't possible, and the production tables are tiny. *Rollback:* `drop index`.

**M3 `customer_is_demo`** (schema). `alter table customer add column is_demo boolean not null default false`. It isn't added to the customer `UPDATE` column grant, so customers can't set it. [seed.ts](supabase/functions/demo-reset/seed.ts) sets it to true for the 6 seeded people. *Rollback:* drop the column.

**M4 `backfill_is_demo`** (data, separate). `update customer set is_demo = true where mobile_no in (<6 seeded numbers>)`. **Before writing it I'll show you the SELECT with exact rows and count, and wait for approval.** Run the same SELECT on production before `db push`, in case a real person registered one of those numbers. *Rollback:* `update … set is_demo = false`.

**M5 `demo_rpcs_scoped`** (function). Same signatures. `demo_set_order_state` raises "Order not found" unless the caller is staff or owns the order. `demo_set_points` requires `customer.is_demo`. Both still require `demo_mode_on()`.
*Breaks:* only the misuse. The screen index (Maria on her own orders) keeps working. *Rollback:* re-create the previous function bodies from 20261108100100.

**M6 `sign-in` Edge Function + client** (no migration in this step). New `supabase/functions/sign-in` takes POST `{identifier, password, audience}`. It checks the lock, resolves the address, calls Auth `signInWithPassword`, records the failure or success with the service role, checks staff membership for staff sign-ins, and returns `{session}` or `{lockedUntil,left}`. Client `signIn()` calls it, then `auth.setSession()`. The `LoginResult` shape is unchanged, and the existing RPCs stay granted so cached PWA clients keep working.
*Risk:* Auth rate-limits sign-ins per IP, and every attempt now reaches Auth from the Edge Function's IPs. Check the limit under Dashboard → Auth → Rate limits before launch.
*Rollback:* revert the client commit; the function is unused once reverted.
**Follow-up M6b `revoke_login_rpcs_from_clients`** revokes the 5 login RPCs from anon/authenticated. I'll only write it after you confirm the new client is deployed and old PWA caches have had time to update. It is **not** part of this batch.

**M7 `staff_payments_for_orders`** (function, additive). `staff_payments_for(p_order_ids uuid[])`, staff only, `search_path=''`. `loadStaff` passes the ids of the 300 orders it loaded. The old `staff_payments()` is kept. *Rollback:* client goes back to the old RPC; drop the function.

**App-only commit `batch_availability_writes`.** `setStore` writes all availability changes, then reloads once. Behaviour and audit rows are unchanged.

**Tests commit.** pgTAP under `supabase/tests/database/*.test.sql`, run with `npx supabase test db`. pgtap is created inside each test transaction only, not in a migration. For every public table, the tests cover anon, the owner customer, another customer, and staff for SELECT/INSERT/UPDATE/DELETE. They also cover each RPC's grant and the M1/M5/M6 fixes, e.g. "customer B can't demo-rewrite A's order" and "anon can't …" once M6b lands. `rules_check.sql` stays.

**Docs commit.** Create `CLAUDE.md` (there isn't one) with the database/API section: schema summary, migration commands, the RLS model, the auth flow (sign-in function, separate customer and staff sessions, token refresh), and offline/caching notes. The caching notes cover: `place-order` is idempotent by key; status updates, `redeem_reward` and `login_*` are not idempotent and must never be cached or replayed; which Realtime tables each app subscribes to; and the 15 s polling fallback.

## Verification (before I report done)
1. `npx supabase db reset` replays all migrations, then I seed through the local `demo-reset` function (`scripts/seed-demo.mjs` against local). There's no `seed.sql` in this repo, so that's the seed path.
2. `npx supabase db lint` and `db advisors --level info`, compared with the saved "before" files.
3. Row counts per table before and after, with every difference explained (expected: none apart from reseeding).
4. Re-run `scratchpad/dq.sql` and compare the 37 counts.
5. `npx supabase test db` (pgTAP) plus the existing `rules_check.sql`.
6. `npm run lint`, `npm test`, `npm run build`. Regenerate types and check `git diff --exit-code` on `src/lib/database.types.ts`.
7. Re-run `scratchpad/explain.sql` (20k rolled-back load) and report before/after times.
8. `CLAUDE.md` updated.
9. List what I couldn't verify (production data quality, production advisors, Auth rate limits on hosted, PWA cache rollover) and your manual steps: take a backup first, run the M4 SELECT on prod, `npx supabase db push`, `npx supabase functions deploy sign-in`, `npx vercel deploy --prod`, then later approve M6b.

## As implemented (2026-11-19)
Differences from the plan above:
- **M1** covers **18** policies (the plan said 15; the count came from the live catalogue).
- **M2** dropped `automated_order (customer_id)`: 6 rows, no measurable benefit. The other six indexes each showed a gain (see the migration comment). Also seen but not in the approved list, so left for later: `points_txn (order_id)` and `orders (customer_reward_id)` are scanned by ON DELETE SET NULL (about 2–3 ms each on 20k rows).
- **M6** `sign-in` falls back to the service key for its throwaway Auth client when `SUPABASE_ANON_KEY` isn't set (projects on new-style keys).
- **Tests** live in `supabase/tests/database/` and run with `npm run test:db`. The plain `npx supabase test db` would also pick up `rules_check.sql`, which isn't TAP. 141 assertions.

Commits: `6c49b40` docs · `8755164` M1 · `8d25a76` M2 · `b14d198` M3 · `1d727f9` M4 · `42c44e1` M5 · `4330a41` M6 · `4d51c79` M7 · `68ca64e` availability batching · `48a327c` pgTAP tests.
