# MEGS' Cafe app

React + Vite PWA (customer app at `#/`, staff console at `#/staff`) on Supabase. Deployed to Vercel (`npx vercel deploy --prod`).

Commands: `npm run dev`, `npm run build`, `npm run lint`, `npm test` (pricing engine, vitest), `npm run test:db` (pgTAP, needs the local stack).

## Database and API

### Schema summary
Postgres `public` schema, following SRS v1.2.0 Table 4-1. Money is integer **centavos**. Times are `timestamptz` (UTC, shown in Asia/Manila). Mobile numbers are E.164 (`+639…`). Statuses are enums.

- Catalog (public read): `store_settings` (one row per cafe, holds the configurable rules and `demo_mode`), `tier`, `menu_category`, `menu_item`, `option_group`, `option_value`, `reward`, `promotion` (the `code` column is never readable by clients).
- People: `customer` (1:1 with `auth.users`, created by the `handle_new_auth_user` trigger from sign-up metadata; `is_demo` marks seeded demo accounts), `staff_user` (1:1 with `auth.users`, created by `scripts/create-staff.mjs` only), `address`, `payment_method`.
- Orders: `orders`, then `order_line` → `order_line_option`, `payment`, `order_status_event`, `internal_note` (staff only). Contents and totals are frozen by trigger after placement.
- Loyalty: `points_txn` (append-only ledger; `customer.points_balance` is kept equal to its sum by trigger), `customer_reward` (vouchers), `promotion_redemption`.
- Other: `notification` (rendered from `response_template`), `automated_order`, `audit_log`, `login_attempt` (server only, no policies).
- Business rules live in triggers in [supabase/migrations/20261107120100_rules_and_security.sql](supabase/migrations/20261107120100_rules_and_security.sql) and [20261108100100_app_data_layer.sql](supabase/migrations/20261108100100_app_data_layer.sql). Examples: status transitions, completing an order credits points, cancelling refunds and restores the voucher.
- Generated types: [src/lib/database.types.ts](src/lib/database.types.ts). Regenerate after every migration: `npx supabase gen types typescript --local > src/lib/database.types.ts`.

### Migrations
- Local stack: `npx supabase start` (Docker), `npx supabase db reset` (replays all migrations; there is no `seed.sql`).
- Demo data, local: `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY=<local secret> node scripts/create-staff.mjs`, then `npx supabase functions serve` and `SUPABASE_PUBLISHABLE_KEY=<local publishable> node scripts/seed-demo.mjs`. `npx supabase status` prints the local keys.
- New change: `npx supabase migration new <name>`. Never edit an applied migration. One logical change per migration; data fixes go in their own migration.
- Production (`mqjttxhosdepvejghraa`, the only linked project; there is no staging): only with the owner's go-ahead, one command at a time.
  1. Read-only checks: `npx supabase migration list --remote`, `npx supabase db diff --linked` (drift), `npx supabase db query --remote --read-only "<select>"`.
  2. Back up: `npx supabase db dump --remote -f <file>` and `--data-only`. The data dump contains auth users and sessions, so keep it out of the repo.
  3. `npx supabase db push --remote --dry-run`, then `npx supabase db push --remote --yes`. **In CLI 3.x a plain `db push` targets the local stack.**
  4. Edge Functions: `npx supabase functions deploy <names> --yes`. Redeploy `demo-reset` whenever `demo-reset/seed.ts` changes.
  5. App: `npx vercel deploy --prod`. Order: database → functions → app, because the app depends on new RPCs and functions.
- Production state (2026-11-19): on migration `20261119122333`, matching local with no drift. Functions `sign-in` (v1) and `demo-reset` (v4) are deployed, and the app with server-side sign-in is live.
- Tests: `npm run test:db` (pgTAP in `supabase/tests/database`, self-contained, rolls back). [supabase/tests/rules_check.sql](supabase/tests/rules_check.sql) is a scripted check that needs an empty DB: `docker exec -i supabase_db_MEGS-Cafe-App psql -U postgres < supabase/tests/rules_check.sql`.
- Audit scripts: [supabase/audit/](supabase/audit/) (data-quality counts; a rolled-back 20k-order EXPLAIN load). Background: [DB_AUDIT.md](DB_AUDIT.md), [DB_PLAN.md](DB_PLAN.md).

### RLS model
- RLS is on for every public table. Column-level `GRANT`s decide which columns a role may read or change. RLS decides which rows.
- `anon`: catalog only.
- Customer (`authenticated`, not staff): own rows only (`customer_id = (select auth.uid())`). They may cancel their own order while Received or Accepted (the trigger enforces it) and mark notifications read. They can never insert orders, points, vouchers or order lines.
- Staff: `(select public.is_staff())` (active `staff_user` row). Staff read operational data and may update order status, availability, templates and selected store settings. Staff **cannot** read customers' payment methods or notifications. Payment references are only available through `staff_payments_for(uuid[])` / `staff_order_payments(uuid)`.
- Server (Edge Functions with the service role): `create_order()` is the only writer of orders.
- Write policies with `(select auth.uid())` and `(select public.is_staff())`, never the bare calls, which run once per row. Every SECURITY DEFINER function sets `search_path = ''`. Never authorize from `user_metadata`.
- New functions are not executable by `PUBLIC`. Grant each one explicitly.

### Auth flow
- Two separate Supabase sessions in one browser: `megs-customer-auth` and `megs-staff-auth` (localStorage), picked by the URL hash ([src/lib/supabase.ts](src/lib/supabase.ts)). Each refreshes its own token (`autoRefreshToken`). Access tokens last 1 h.
- Sign-in goes through the **`sign-in` Edge Function**, which checks the lockout, maps a mobile/email/username to the Auth address, verifies the password and records the attempt. The app then calls `auth.setSession()`. Customer Auth addresses are `<digits>@phone.megs.local`.
- Sign-up: `auth.signUp` with metadata (`account_type: 'customer'`, name, mobile, terms). The trigger creates the `customer` row. There is no SMS OTP yet; it's simulated.
- The `login_*` / `*_login_address` RPCs are still granted to `anon` for older cached app versions. Revoking them is follow-up migration M6b, to be applied once the new client has been live long enough for cached PWAs to update. The new client went live 2026-11-19, and the PWA asks before updating (`registerType: 'prompt'`), so allow a couple of weeks. When M6b lands, update the grant test in `supabase/tests/database/02_rpc_security.test.sql`.
- Offline: sign-in needs the network (Edge Function), and a failed call shows the "offline" message without counting an attempt. An already-signed-in session keeps refreshing its token directly with Supabase Auth, without the function.

### Edge Functions (`supabase/functions`, all `verify_jwt = false`; each checks the caller itself)
`place-order` (prices the order server-side; idempotent by `idempotencyKey`), `sign-in`, `delete-account`, `demo-reset` (staff only, demo mode only), `staff-automations` (staff only). Shared code is in `_shared/` (the pricing engine is used by both app and server).

### Offline, caching and retries
- The service worker caches only app files and fonts. Supabase REST, RPC, Auth, Functions and Realtime always go to the network. Never add a runtime cache for `*.supabase.co`.
- App data is mirrored to localStorage per tab for a fast start, but it is only a display cache and is always reloaded.
- **Idempotent:** `place-order` (the same `idempotencyKey` returns the same order). Generate one key per checkout and reuse it on retry.
- **Not idempotent; never replay or queue offline:** order status updates (`orders` PATCH), `redeem_reward`, `sign-in` (each call counts as an attempt), `demo_set_*`, `delete-account`, `staff-automations`, profile/address/payment-method writes.
- Realtime (`postgres_changes`, filtered by RLS): the customer app subscribes to `orders`, `order_status_event`, `payment`, `notification`, `customer`, `points_txn`, `customer_reward`, `promotion_redemption`, `menu_item`, `store_settings`. Staff subscribe to `orders`, `order_status_event`, `internal_note`, `payment`, `automated_order`, `response_template`, `menu_item`, `store_settings`. Guests subscribe to `menu_item` and `store_settings`. Any event triggers a debounced full reload. There's also a 15 s polling fallback while visible and online.
- The PWA uses `registerType: 'prompt'`: old versions keep running until the person accepts the update. Keep API changes backward compatible for at least one release.

### Before a real launch
Turn `store_settings.demo_mode` off. Change the staff passwords. Add real SMS OTP (sign-up currently trusts the mobile number). Have a payment gateway issue `provider_token` server-side. Check the Auth sign-in rate limit (all password checks now come from the `sign-in` function). Apply M6b.
