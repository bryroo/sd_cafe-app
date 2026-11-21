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
- **Pending for production (local only, 2026-11-21):** the delivery migrations `20261121131635`–`20261121132118` and `20261121142630` (PostGIS, `service_area`, Bocaue data, area functions, `address` pin, orders guard, geocode cache and limits), then the functions `place-order`, `staff-automations`, `demo-reset` (seed moved to Bocaue) and `geocode` (set the `NOMINATIM_CONTACT` secret first), then the app. Not applied: needs the owner's go-ahead and a backup first.
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
- Anonymous Auth users (JWT `is_anonymous`) are guests: the `address` policies refuse them and `place-order` answers `SIGN_IN`. Anonymous sign-in is off in config.

### Delivery (Bocaue, Bulacan only)
- **Service area model:** `service_area` (PostGIS `geography(MultiPolygon)`, `is_active`, `source`, `source_license`). Clients never read the table; they call `is_within_service_area(lat, lng)` (`ST_Covers` over active areas; the only rule) and `service_area_geojson()` (outline for the map). Both are `authenticated` + `service_role` only. Another town is a new row from `node scripts/service-area.mjs R<osm relation> "<name>"` in a data migration; switching one off is `is_active = false`.
- **Boundary data:** OpenStreetMap relation 17638809 via Nominatim. ODbL: the map shows "Delivery area outline © OpenStreetMap contributors"; keep that credit wherever the outline appears. OSM gives 26.5 km² for Bocaue while the commonly cited figure is about 31.9 km², so check the border against a local map before launch. Neighbours sharing a border: Balagtas, Bulakan, Marilao, Meycauayan, Pandi, Santa Maria.
- **Enforcement, three layers:** (1) `address_check_area` trigger: a new or moved pin outside every active area can't be saved (`OUT_OF_SERVICE_AREA`; no waitlist). (2) `place-order` reads the pin from the customer's own saved address (never from the request body) and answers `ADDRESS_NEEDS_PIN`, `OUT_OF_AREA` or `ADDRESS` (no mobile). (3) `orders_delivery_guard` trigger: an app (`source = 'app'`) delivery order needs a covered pin in its `delivery_address` snapshot. Automated orders are not guarded yet.
- **Addresses:** the existing `address` table gained `lat`, `lng`, `place_id`, `landmark`, `location_set_at` (all optional, so old clients still work; unpinned addresses show "Needs a pin" and can't be used for delivery). `set_default_address(uuid)` swaps the default. Orders keep a snapshot (`delivery_address` jsonb, now with `lat`/`lng`/`landmark`/`place_id`).
- **App:** `/address/:id` ([src/screens/address.tsx](src/screens/address.tsx), lazy chunk) is pin then details. [src/components/MapPicker.tsx](src/components/MapPicker.tsx) is **Leaflet with OpenStreetMap tiles**: tap, drag, arrow keys on the focused pin (Shift moves further), address search on submit, current location, and a reverse lookup (600 ms after taps and drags, immediate for search and location). Dark mode inverts the light OSM tiles with a CSS filter. There is no satellite view (OSM has none). The in-area answer in the app ([src/state/serviceArea.ts](src/state/serviceArea.ts)) is for the person only. Outside the area: the Coming soon panel blocks Confirm and offers pickup. Order details and the staff order show an SVG pin preview ([src/components/PinPreview.tsx](src/components/PinPreview.tsx), no tiles) and an "Open the pin on OpenStreetMap" link.
- **Fee, minimum, hours, ETA:** unchanged for now (flat `store_settings.delivery_fee`, no minimum, opening hours, `delivery_eta_minutes`). The owner hasn't set Bocaue values yet.
- **Address lookup (Nominatim):** only through the `geocode` Edge Function ([supabase/functions/geocode/index.ts](supabase/functions/geocode/index.ts), helpers in `_shared/geocode.ts`), for signed-in, non-anonymous customers. `search` covers the Philippines, bounded to a box around the area. `reverse` runs only for pins inside the area; nothing is sent for the rest. The function keeps Nominatim's usage policy for every phone at once:
  - answers are cached 30 days (`geocode_cache`);
  - **at most 1 request per second app-wide**, and 30 lookups a minute per person (`geocode_call`, `geocode_take_slot()`);
  - an identifying User-Agent: set the `NOMINATIM_CONTACT` secret to a URL or email;
  - **no search-as-you-type**: search runs on Search/Enter. Keep it that way.

  `place_id` on addresses now holds an OSM id (`osm:W123`).
- **Tiles and terms:** tiles come straight from `tile.openstreetmap.org` with no key. Its usage policy allows light use with the "© OpenStreetMap contributors" credit (Leaflet shows it; keep it visible) and forbids bulk or offline downloading, so the service worker never caches tiles. If traffic grows, or OSM asks, point `TILES` in MapPicker at a commercial or self-hosted tile provider, and likewise `NOMINATIM` in `_shared/geocode.ts`. Map data is ODbL.
- **No keys, no billing:** there's nothing to restrict or pay for. The cost is OSM's goodwill, kept low by the cache, the limits, and checkout with a saved address making no map requests.
- **Tests:** `supabase/tests/database/03_service_area.test.sql` (real points, 50 m either side of each border), `04_address_delivery.test.sql` (RLS, pin rules, orders guard), `05_geocode_limits.test.sql` (per-person and app-wide limits), `src/state/serviceArea.test.ts` (the app's hint matches the server), `supabase/functions/_shared/geocode.test.ts`, `scripts/attack-delivery.mjs` (local only: abuse from outside the app), `npm run test:e2e` (Playwright; OSM tiles and the geocode function are mocked by `tests/e2e/osm-mock.ts`; 3 sizes × light/dark, axe; needs `E2E_SUPABASE_PUBLISHABLE_KEY`, the local stack, `functions serve` and the seed), `npm run test:a11y` (Lighthouse, against a served `dist-e2e`), `npm run test:osm-live` (a few real OSM requests via `npm run dev`; run by hand, never in a loop).

### Auth flow
- Two separate Supabase sessions in one browser: `megs-customer-auth` and `megs-staff-auth` (localStorage), picked by the URL hash ([src/lib/supabase.ts](src/lib/supabase.ts)). Each refreshes its own token (`autoRefreshToken`). Access tokens last 1 h.
- Sign-in goes through the **`sign-in` Edge Function**, which checks the lockout, maps a mobile/email/username to the Auth address, verifies the password and records the attempt. The app then calls `auth.setSession()`. Customer Auth addresses are `<digits>@phone.megs.local`.
- Sign-up: `auth.signUp` with metadata (`account_type: 'customer'`, name, mobile, terms). The trigger creates the `customer` row. There is no SMS OTP yet; it's simulated.
- The `login_*` / `*_login_address` RPCs are still granted to `anon` for older cached app versions. Revoking them is follow-up migration M6b, to be applied once the new client has been live long enough for cached PWAs to update. The new client went live 2026-11-19, and the PWA asks before updating (`registerType: 'prompt'`), so allow a couple of weeks. When M6b lands, update the grant test in `supabase/tests/database/02_rpc_security.test.sql`.
- Offline: sign-in needs the network (Edge Function), and a failed call shows the "offline" message without counting an attempt. An already-signed-in session keeps refreshing its token directly with Supabase Auth, without the function.

### Edge Functions (`supabase/functions`, all `verify_jwt = false`; each checks the caller itself)
`place-order` (prices the order server-side; idempotent by `idempotencyKey`), `sign-in`, `delete-account`, `demo-reset` (staff only, demo mode only), `staff-automations` (staff only), `geocode` (address search and pin lookup via Nominatim; customers only, cached and rate-limited). Shared code is in `_shared/` (the pricing engine is used by both app and server).

### Offline, caching and retries
- The service worker's caching rules are in the **PWA** section below. In short: Supabase table reads are network-first and cached per user; everything else from Supabase is never cached.
- App data is also mirrored to localStorage per tab for a fast start. It's only a display cache, always reloaded, and removed on sign-out. Saved addresses are left out of the mirror.
- **Idempotent:** `place-order` (the same `idempotencyKey` returns the same order). Generate one key per checkout and reuse it on retry.
- **Not idempotent; never replay or queue offline:** order status updates (`orders` PATCH), `redeem_reward`, `sign-in` (each call counts as an attempt), `demo_set_*`, `delete-account`, `staff-automations`, profile/address/payment-method writes.
- Realtime (`postgres_changes`, filtered by RLS): the customer app subscribes to `orders`, `order_status_event`, `payment`, `notification`, `customer`, `points_txn`, `customer_reward`, `promotion_redemption`, `menu_item`, `store_settings`. Staff subscribe to `orders`, `order_status_event`, `internal_note`, `payment`, `automated_order`, `response_template`, `menu_item`, `store_settings`. Guests subscribe to `menu_item` and `store_settings`. Any event triggers a debounced full reload. There's also a 15 s polling fallback while visible and online.
- The PWA uses `registerType: 'prompt'`: old versions keep running until the person accepts the update. Keep API changes backward compatible for at least one release.

## PWA (installable app)

Built with vite-plugin-pwa (Workbox, `generateSW`) in [vite.config.ts](vite.config.ts). The service worker exists only in builds; `npm run dev` never registers it.

### Caching rules (service worker)
| What | Strategy | Cache |
|---|---|---|
| App shell, JS/CSS, icons, menu photos (every built file except install screenshots) | Precache; `index.html` is the navigation fallback, so the app opens offline | `workbox-precache-*` |
| Google Fonts CSS / font files | Stale-while-revalidate / cache-first (1 year) | `google-fonts-*` |
| `GET /rest/v1/<table>` by a signed-in user | Network-first, 3 s timeout, 200s only, 7 days / 200 entries | `megs-api-user` |
| The same reads by a guest (menu, hours, offers) | Network-first, 3 s timeout | `megs-api-public` |
| `/auth/v1/*` (sign-in, **token refresh**), `/functions/v1/*`, `/rest/v1/rpc/*`, Storage, Realtime websockets, every POST/PATCH/DELETE/HEAD | **Never cached.** No route matches, so they go straight to the network | none |
| `GET /rest/v1/address` (saved delivery addresses), OpenStreetMap tiles (`tile.openstreetmap.org`) and address lookups (`/functions/v1/geocode`) | **Never cached.** Address reads are excluded from both read routes; tiles have no route (OSM's policy forbids offline tile caching). Offline, the map shows "The map needs a connection" | none |

- Cache keys are the URL plus `__megs_user=<user id>` and `__megs_accept=<Accept>`. The user id is decoded from the request's JWT inside the worker, and only the id is kept. Keys are stored **without request headers**, so no token is ever written to a cache. Two people on one device (e.g. the customer tab and the staff tab) never share entries.
- **Sign-out** (`SIGNED_OUT`) deletes every `megs-api-*` cache ([src/state/caches.ts](src/state/caches.ts)) and the localStorage mirror.
- Changing these rules: edit `runtimeCaching` in vite.config.ts. Route functions are serialised into the worker, so they must not use outside variables. Never cache auth, functions, RPCs or writes.

### Offline
- Reads: the app opens from the precache, and screens show the last copy of the person's data (worker cache + localStorage). A global "Offline · showing saved data" pill shows while `navigator.onLine` is false.
- Writes: **no queue.** Offline writes fail with "You're offline. Connect and try again." and are never replayed (risks: orders after closing time or at changed prices, double-spent points, staff status changes fighting newer ones). Place-order's idempotency key makes a manual retry safe.
- On "lie-fi" (the device says it's online but requests fail), reads still fall back to the cache after 3 s, but the pill doesn't show and writes give the generic "Couldn't update" message.

### Updates and install
- `registerType: 'prompt'`. A new version shows a persistent "New version available · Reload" banner ([src/components/pwa.tsx](src/components/pwa.tsx)) in both apps. The app checks hourly and when it comes back into view, and **never reloads by itself**.
- Install: a one-time card on Home. Android and desktop open the browser dialog (`beforeinstallprompt`); iOS Safari shows "Share → Add to Home Screen". Both are hidden once installed (`display-mode: standalone`). Profile → Settings keeps an Install row.
- Manifest: name, short_name, id/start_url/scope `./`, standalone, theme/background colours, 192/512/maskable icons, shortcuts (Menu, My orders, Rewards), install screenshots. No orientation lock.

### Interface
- Layouts: < 768 px uses bottom tabs (each screen's `BottomNav`); 768–1023 px an icon rail; ≥ 1024 px a sidebar (`AppNav`). Phone-designed screens use a centred 720 px column; `<Screen layout="wide">` (Home, Menu, sections, Search, Product, Rewards catalog, Your order) uses 1080 px and multi-column lists. Sheets become centred dialogs ≥ 768 px.
- `?frame=1` (before the `#`) shows the old phone frame + screen index for demos.
- Theme follows `prefers-color-scheme` unless the Dark mode switch (Profile for guests and members, staff Your profile; `useDarkMode`) or Settings → Appearance (which also offers "Same as this device") forces one (`megs.theme` in localStorage → `data-theme` on `<html>`, applied by an inline script in index.html before first paint). Ink fills have two roles: `--plate` (black boards that stay dark) and `--ink`/`--on-ink` (controls that invert). Text on a gold fill is always `--on-gold`.
- Keyboard: Alt+1…5 switches sections (both apps); `/` jumps to search; `?` opens the shortcuts sheet (customer app); a visible `:focus-visible` ring; a skip link. After a route change focus moves to the screen's `<h1>` (no ring on it). Sheets and dialogs trap Tab and return focus to their opener. Touch: 44 px+ targets, 16 px fields on coarse pointers, safe-area insets, `100dvh`, overscroll off.

### Build and test
- `npm run build` creates `dist/` with the worker. Test a production build against the local stack: `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<local publishable> npx vite build && npx vite preview` (localhost counts as a secure context, so the worker runs).
- `vite preview` doesn't compress; Vercel does (brotli). Measure Lighthouse behind compression.
- The staff console is a lazy chunk (precached, so it still works offline once installed).

### Before a real launch
Turn `store_settings.demo_mode` off. Change the staff passwords. Add real SMS OTP (sign-up currently trusts the mobile number). Have a payment gateway issue `provider_token` server-side. Replace the placeholder contact details in `src/data/contact.ts` (Help and support) and set `placeholder: false`. Check the Auth sign-in rate limit (all password checks now come from the `sign-in` function). Apply M6b. Delivery: set the Bocaue fee, minimum, hours and ETA; set the `NOMINATIM_CONTACT` secret and decide whether launch traffic needs a commercial tile and geocoding provider; verify the Bocaue boundary against a local map; test current location on a real iPhone and Android phone.

## Design system ("Concrete & lamplight")
Design rationale and history: [DESIGN_AUDIT.md](DESIGN_AUDIT.md), [DESIGN_PLAN.md](DESIGN_PLAN.md). The personality comes from colour, type, illustration and motion, never from unusual navigation or controls.

### Tokens (`src/index.css`; use them, never raw values)
- **Colour roles:** `--ground` (page), `--surface` (cards), `--raised`, `--active`, `--border`, `--rule`, `--control`, `--ink`/`--steel`, `--muted`, `--faint`, `--plate`/`--on-plate`/`--on-plate-muted`/`--plate-*` (dark boards), `--on-ink`, `--gold` (only where "a lamp is on": live order, lit step, earned points, selected option, count badges), `--gold-ink` (gold text), `--on-gold`, `--negative`, `--positive`, `--success-bg/ink`, `--warning-bg/ink`, `--scrim`, `--focus`. Dark values live in the media query and under `:root[data-theme='dark']`; keep both in sync.
- **Type:** one family (Archivo). Use the classes `.t-display` 28/32, `.t-h1` 24/28, `.t-h2` 20/26, `.t-h3` 16/22, `.t-body` 16/24, `.t-body-sm` 14/20, `.t-caption` 12/16, `.t-button`, `.t-price`, `.num` (tabular). In CSS use `var(--text-*)`/`var(--lh-*)`; `--text-metric` 36 is for staff counters only. No other sizes.
- **Spacing:** `--space-4/8/12/16/20/24/32/48` (named by pixels). Raw values only for 1–2 px hairlines and optical offsets.
- **Radius:** `--radius-button`/`-input`/`-chip`/`-badge` 4, `--radius-card`/`-modal` 6, `--radius-sheet` 10, `--radius-pill`. **Elevation:** only floating things (sheet, dialog, toast) cast a shadow (`--elevation-2/3`).
- **Motion:** `--dur-fast` 150 ms (press, toggle), `--dur-base` 200 ms (screen, sheet, toast), `--dur-slow` 250 ms (lamp glow), `--ease-out`. `prefers-reduced-motion` stops all animation and transitions globally. Nothing waits on an animation.

### Components and conventions
- **Screen frame:** `Screen` + `TopBar` (`back` / `home` / `title`; no title → no heading) + `Content`/`Row`. The `footer` holds the screen's one primary action: pinned to the bottom on phones, inline after the content (sticky only when the content is taller than the window) on tablets and desktops.
- **Feedback:** one toast system, `useOverlay().toast(text, { label, onClick })` (snackbar, low on the screen; 5 s with an action). Inline messages are `Alert` (tones info/success/warning/danger, optional icon/title/action); `OfflineBanner` and `ClosedBanner` are Alerts. Empty screens use `EmptyState` + `Illustration` (lamp over the missing thing). First loads use `ProductRowSkeleton`/`CardSkeleton`, never a false empty state.
- **Undo, not "are you sure":** removing a cart line (stepper or swipe, `SwipeRow`) shows Removed · Undo. Dialogs (`overlay.confirm`) only for consequential or server-side actions: cancel order, redeem points, delete account, log out, similar order, payment failures, reset demo.
- **Sheets vs dialogs:** sheets for choosing (Quick add, Discounts, Payment, Help, About, Shortcuts); dialogs for confirmations. Add new ones as `OverlayId`s in `src/overlays/OverlayHost.tsx`.
- **Forms:** keep submit enabled; validate on blur and on submit with a specific message under the field (`TextField error`), focus the first problem (`useValidation` in `src/state/forms.ts`). Set `autoComplete` on every field.
- **Lists:** `ListRow`/`ListGroup` and Profile's `SettingsRow`; count badges with `CountBadge`. Menu rows: the row opens the item, the "+" opens Quick add (standard options).
- **Cart glow:** call `signalCartAdded()` (src/state/feedback.ts) after adding to the cart; badges use `useCartGlow()`.
- Contact details for Help and support are placeholders in `src/data/contact.ts` (set `placeholder: false` when real).

### Navigation (customer)
- Tabs, same order and labels everywhere: **Home · Menu · Orders · Rewards · Profile** (`src/components/tabs.ts`). Cart is not a tab: phones use the floating cart bar on Home/Menu, tablets and desktops the sidebar/rail Cart button.
- **Your order** is one review screen at `/cart` and `/checkout` (lines, pickup/delivery, discounts, payment, note, total, Place order). `/fulfillment` and `/address/:id` return to it.
- **Profile** holds only what has no tab: Account (Edit profile, Payment methods, Saved addresses) · Inbox (Notifications) · Display (Dark mode) · App (Settings, Privacy) · Help (Help and support, About) · Log out. Guests get Log in / Create account, Display, Help, and **Exit guest mode** (back to Welcome). Delete account lives only in Privacy; Log out only in Profile. Settings: notifications, Appearance, language, install, demo reset.
- **Guests** (Browse as guest, or signed out) browse only: Home, Menu, Search, sections, product pages (options and prices), Offers, the rewards catalog, Privacy notice, guest Profile. No cart, orders or account features. `useApp().isMember`; cart changes are no-ops for guests, and a leftover cart is moved to `savedCart` once `shared.ready` (it returns on login). Account routes are wrapped in `MemberOnly` (src/components/guest.tsx) and show a sign-in prompt; actions use `useGuestGate().requireMember()` (src/state/guest.ts), which opens the "Log in to order" sheet. Log in / Sign up accept `?next=` (in-app paths only) to return afterwards. The server enforces the same independently: `anon` can only read the catalog.
- First run: Splash → Welcome (or Home when signed in). Splash and Welcome have no app navigation (`NO_NAV` in App.tsx); Welcome offers Install the app where the browser can install (or Safari's steps on iPhone); `/onboarding/*` redirects to `/welcome`. Home's "Get started" card (device-local flags in `megs.first-run`) teaches by doing. Unknown routes show `NotFound`.
