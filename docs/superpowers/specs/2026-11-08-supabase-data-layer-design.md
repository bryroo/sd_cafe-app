# MEGS' Cafe: app data from Supabase (design)

Date: 2026-11-08 · Status: approved in conversation, awaiting written-spec review
Builds on: the live Supabase schema (`supabase/migrations/20261107120000` to `120400`), SRS v1.2.0.

## 1. Goal

The customer app and the staff console read and write the MEGS' Cafe Supabase database instead of
`localStorage` and hard-coded data. The demo still looks and behaves as it does today, but every
order, point and setting is a real row, shared across devices and kept live.

Purpose (agreed 2026-11-07): demo now, launch later. Accounts, orders and loyalty are real;
SMS codes and payments stay simulated, and the design leaves room to switch them on at launch.

### Success criteria

1. No screen reads orders, customers, points, vouchers, offers, promo codes, templates, automations,
   store settings, staff identity or the menu from bundled data or `localStorage`.
2. An order placed on one device appears in the staff queue on another within 5 s (FR-STF-04,
   NFR-PER-03); staff status changes reach the customer within 5 s (FR-TRK-02).
3. Prices charged are computed on the server from database data (FR-PRO-08, SRS 3.8).
4. The demo (Maria's account, sample orders, automations, screen index states, auto-advance) works
   against the database and can be reset.
5. Offline, the app still shows the menu and the last known order status (NFR-REL-04).
6. Pricing logic has ≥ 70% unit-test coverage (NFR-MNT-03); database rules tests and an end-to-end
   browser run pass, locally and against production.

### Out of scope

Real SMS OTP, real payment gateway, push notifications to closed apps, a custom domain, visual
redesign, new features beyond what the prototype already shows.

## 2. Architecture and data flow

Approach A (chosen over rewriting screens around per-screen hooks): keep the app's data API and
replace what is behind it, so screens change little.

- **Client.** `src/lib/supabase.ts` creates the Supabase client from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (in git-ignored `.env.local` and in Vercel project settings). The
  publishable key is public by design; RLS protects data. The secret key never reaches the app.
- **Two sessions.** The customer app and the staff console use two clients with different auth
  storage keys (`megs-customer-auth`, `megs-staff-auth`), so both can be signed in in one browser
  (the README's side-by-side demo) and each keeps its own RLS identity.
- **Reads.** At start-up (splash stays up): menu (categories, items, option groups and values), store
  settings, tiers, rewards, published offers. After sign-in: a customer loads only their own orders
  (with lines, options, events, payments), points ledger, vouchers, promo uses, notifications,
  addresses and payment methods; staff load the queue, automations, templates, internal notes and
  staff list.
- **Mapping.** One module (`src/data/db.ts`) converts rows to the app's existing types: centavos to
  pesos, `snake_case` to `camelCase`, enum names to the app's labels.
- **Live updates.** Supabase Realtime on `orders`, `order_status_event`, `notification`,
  `menu_item`, `store_settings`, `automated_order` replaces `BroadcastChannel`/`storage` events.
  Pull-to-refresh and Retry re-fetch.
- **Writes.** Async. Status moves, delays, notes, settings, templates, availability, profile,
  preferences, addresses, payment methods, notification read: direct table writes (guarded by the
  existing triggers and grants). Redeem: `redeem_reward()` RPC. Place order: `place-order` Edge
  Function. Buttons keep their loading states; failures use the existing "Couldn't update. Try
  again." paths.
- **Offline.** The last loaded snapshot is cached in `localStorage` per role; offline, screens render
  from it and the existing offline banners disable actions.
- **Stays on the device.** Cart (FR-CRT-09), saved cart while logged out, recent searches,
  onboarding seen, promo modal dismissals, UI preferences.
- **Retired.** Hard-coded orders (`src/data/orders.ts`), seeded queue and notifications in
  `shared.ts`, hard-coded rewards, offers, promo codes and points history in `rewards.ts`, templates
  and automations seeds, and all hard-coded passwords. The menu CSVs remain the source for
  `scripts/menu-to-sql.mjs`, but the app no longer bundles them.

## 3. Sign-in and accounts

### Customers
- **Sign-up (C-04 → C-05).** Form unchanged. After the (still simulated, any 6 digits) code step, the
  app calls `auth.signUp` with the internal login address `<E.164 digits>@phone.megs.local`, the
  password, and metadata `account_type=customer, full_name, mobile_no (E.164), contact_email,
  terms_accepted`. The existing trigger creates the `customer` row at the Regular tier; it also sets
  `mobile_verified_at`.
- **"Already registered" (3.2.1.5).** RPC `is_mobile_registered(mobile)` (anon, returns boolean).
- **Log in (C-06).** Mobile number or email (FR-ACC-06). An email is resolved to the internal login
  address by RPC `customer_login_address(identifier)`.
- **Lockout (FR-ACC-07).** RPCs `login_locked_until(identifier, audience)`,
  `login_failed(identifier, audience)` (returns attempts left and lock time) and
  `login_succeeded(identifier, audience)`, over `login_attempt`, using `store_settings`
  `lockout_attempts`/`lockout_minutes`. Wrong credentials keep one banner that doesn't say which
  value was wrong.
- **Session (FR-ACC-09).** Supabase persists the session; the splash checks it and routes to Home,
  Welcome or onboarding. Logout signs out and keeps the cart as today.
- **Forgot / reset password (C-07, C-08).** A walkthrough while codes are simulated: the code step
  passes and saving says "Password reset arrives with SMS codes at launch. Your password is
  unchanged." Reason: a working reset behind a fake code would let anyone take over any account.
- **Profile (C-27, C-28), settings toggles (FR-PRF-05), addresses (FR-PRF-04), payment methods
  (FR-PRF-03)** read and write their tables. Cards are test tokens (`tok_test_4242`, `tok_test_0002`,
  `tok_test_0119`); e-wallet is a linked test wallet.
- **Delete account (FR-ACC-11, SRS 3.8).** `delete-account` Edge Function (needs the secret key to
  delete the auth user): anonymizes the customer's orders (name, phone, address removed) and deletes
  the auth user, which cascades to their personal rows.
- **Download my data (FR-PRF-06).** Assembled from the customer's own rows, without staff-only data.

### Staff
- **Log in (FR-STF-01).** Username or email; RPC `staff_login_address(identifier)` returns the email
  of an active staff member; same lockout RPCs with `audience = staff`.
- After sign-in the console calls `is_staff()`; a non-staff account is signed out with "This account
  isn't a staff account." Top bar name and role come from `staff_user`.

### Project settings (production, confirmed before changing)
- Auth: email confirmation off (internal addresses can't receive mail); minimum password length 8.
- NFR-SEC-05's 30-day inactivity timeout needs a paid Auth plan; not set in the demo.

## 4. Orders and pricing

### Shared pricing module
`supabase/functions/_shared/pricing.ts`: pure TypeScript, no imports, used by the app (instant cart
and checkout totals) and by Edge Functions (authoritative price). Inputs are data, not hard-coded
lists: the menu snapshot, the customer's tier, published promotions and their `rule` JSON, the
applied promo code, the applied voucher and its reward's `eligible_items`, store settings.
It implements: unit price from size and options (FR-CRT-02); FR-CHK-04 order (subtotal, tier
discount, one promotion, one reward, delivery fee, total); promo code checks with the SRS error
messages (window, minimum spend, once per customer, usage limit); best automatic offer, skipping
units a reward made free (AS-05, FR-PRO-06); voucher makes the cheapest eligible unit per slot free
(FR-LOY-09); points at `points_per_peso` (AS-03). Offer rule types: `free_item_with`,
`free_option`, `amount_off_option`, `amount_off_item`, `percent_after_tier`.

The Vercel build must include this file (adjust `.vercelignore`), and the app imports it by relative
path.

### `place-order` Edge Function
1. Customer from the JWT; guests refused.
2. Existing order with the same `idempotency_key` → returned unchanged (IR-08). The checkout attempt
   id becomes a UUID.
3. Store open (accepting orders and within Manila opening hours, IR-10); delivery enabled for
   delivery; pay at counter only for pickup (FR-CHK-06); every item active and available.
4. Validate lines (options belong to the item, required groups chosen, one choice per pick-one
   group, quantity 1–20, note ≤ 140) and price them with the shared module. The tier discount is
   always applied (FR-CHK-05: not removable), so the app's tier-discount switch is removed.
5. If the server total differs from the total the customer confirmed: nothing is charged; respond
   `TOTAL_CHANGED` with the new breakdown and reason; checkout shows the SRS banner and the customer
   places it again.
6. Simulated payment: token `tok_test_0002` → `PAYMENT_DECLINED`, nothing created; other cards and
   e-wallets → payment `authorized` with a test `provider_ref`; counter → `pending`. The 0119
   "fails once" card stays a client-side demo of the order-failed screen; its retry is safe by step 2.
7. One transaction: SQL function `create_order(payload jsonb)` (executable by `service_role` only)
   inserts order, lines, line options and payment. Existing triggers handle voucher, promo use,
   first status event and the received notification.
8. Response: order number, ETA, totals, points.

### Staff
- Accept, Undo (5 s), Preparing, Ready, Completed, Cancel with reason, Delayed, internal notes:
  direct updates, enforced by the existing triggers (Table 3-1, FR-STF-06 to FR-STF-10, refunds,
  voucher restore, points on Completed).
- `staff-automations` Edge Function (staff JWT only): `simulate`, `retry`, `convert` for automated
  orders, using the shared pricing module and `create_order`; failure reasons and codes as today
  (`STORE_CLOSED`, `ITEM_UNAVAILABLE`).

### Live updates and unchanged behaviour
Customer subscribes to own orders and notifications; staff to all orders, automations, availability
and store settings. Cart stays on the device; the duplicate-cart warning (FR-CHK-09) uses the
customer's real recent orders; Reorder uses current database prices (FR-ROR-03).

## 5. Demo content and tools

### Seed
`scripts/seed-demo.mjs` (secret key, re-runnable; clears only demo customers' data):
- Customers: Maria Santos (+63 917 123 4567 / `password1`; 1,240 pts as ledger entries; redeemed and
  expired vouchers; sample notifications; history #1038 and earlier Completed; #1042 Preparing),
  Ana Cruz, Jen Dizon, Leo Tan with #1039 to #1041 in their current states, and Paolo Reyes and
  Carlo Lim for automations.
- The 6 sample automated orders with timelines and failure reasons.
- Times relative to the run, as the prototype does. Migration: the server (`current_actor() =
  'system'`) may set past `placed_at` and step times; clients still can't.
- Order numbers continue after the seeded ones, from #1043.

### Demo mode
New `store_settings.demo_mode` (default on), switchable by staff. While on:
- Screen index state entries call `demo_set_order_state(order_no, status, fulfillment)` (security
  definer, refuses when demo mode is off), which puts Maria's #1042 into the requested state.
- `?demo=member` signs in as Maria; `?demo=cart` also fills the cart.
- Reset demo data moves to the staff console's Settings and calls the `demo-reset` Edge Function
  (staff JWT, demo mode only), which re-runs the seed.
- Auto-advance (demo) stays a staff switch; the open console performs real updates.

## 6. Testing

- Vitest unit tests for the pricing module (FR-CHK-04 order, each offer type, promo errors, reward
  slots, delivery fee, rounding); coverage ≥ 70%.
- `supabase/tests/rules_check.sql` extended: lockout RPCs, staff and customer address lookups,
  `is_mobile_registered`, `create_order` server-only, demo-mode guard, past timestamps server-only.
- End-to-end browser run (Chrome DevTools protocol, like the PWA check) against local Supabase:
  sign up, place order, staff sees it within 5 s, accept/ready/complete with the customer screen
  following, points credited, redeem, cancel a second order (refund and voucher restored), offline
  cached view.
- Rerun the PWA checks and the staff layout audit.

## 7. Rollout (each production step confirmed with the user first)

1. Push new migrations.
2. Auth settings: email confirmation off, password minimum 8.
3. Deploy Edge Functions (`place-order`, `staff-automations`, `delete-account`, `demo-reset`).
4. Run the demo seed.
5. Vercel env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) and redeploy.
6. Rerun the end-to-end check against https://megscafe.vercel.app.

## 8. Build order

Each step leaves the app working:
1. Supabase client, mapping layer, menu and store settings from the database.
2. Sign-in (customer and staff), sessions, lockout.
3. Customer data: profile, addresses, payment methods, points, vouchers, notifications, history.
4. Pricing module, `place-order`, checkout and tracking.
5. Staff console: queue, actions, templates, settings, availability, automations.
6. Demo seed, demo mode and tools; README.

## 9. Risks

- **Size.** Most screens change their data source. Mitigation: keep the data API (Approach A), build
  in the order above, test after each step.
- **Async writes in code written for sync writes.** Callers of `update()` that rely on synchronous
  throw must await; audited per screen.
- **Realtime with RLS.** Subscriptions only deliver rows the user may read; verified in the
  end-to-end run for both roles.
- **Demo functions on production data.** Guarded by `demo_mode`, which staff can switch off before
  a real launch.
