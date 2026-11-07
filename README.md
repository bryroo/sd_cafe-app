# MEGS' Cafe App

The MEGS' Cafe customer ordering app and its staff console: browse the menu, customise a drink or
meal, order for pickup or delivery, and follow the order while the cafe works it from the console.
Orders, accounts, points, offers, the menu and store settings live in the MEGS' Cafe database
(Supabase); the two apps stay in step across devices within a second or two. Payments and SMS codes
are simulated until a provider is chosen (SRS TBD-04).

Built with React, Vite and TypeScript on Supabase (Postgres, Auth, Realtime, Edge Functions).

## Run it

```bash
npm install
npm run dev
```

The app needs the database's address and public key in `.env.local` (git-ignored):

```bash
VITE_SUPABASE_URL=https://mqjttxhosdepvejghraa.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # Supabase → Project settings → API keys
```

Then open the address Vite prints. On a desktop the app shows inside a phone frame, with a list of
every screen on the left.

To work against a local copy of the database instead (Docker needed), see
[Database and server](#database-and-server).

## Demo the customer app and the staff console side by side

1. Open the app: that's the customer's phone. Log in as the demo customer **Maria Santos:
   `0917 123 4567` / `password1`** (pre-filled on the log-in screen), or sign up a new account.
2. Open the same address with `#/staff` on the end (for example https://megscafe.vercel.app/#/staff)
   on another device or in a second tab, or click any **Staff console** entry in the screen list.
3. Sign in to the console with **`staff` / `megs2026`** (also `manager` and `barista`, same password).
   Five wrong tries lock sign-in for 15 minutes.
4. Place an order on the phone. It appears in the console's **Orders → New** within a second or two,
   highlighted, with a chime. Accept it, start preparing, mark it ready, complete it: the phone's
   tracking screen follows each step, with a notification, and points are credited on Completed.

The phone and the console can be on different devices: everything goes through the database. In one
browser the customer app and the console keep separate sign-ins, so both can be open side by side.
Orders don't move by themselves: staff move them. For a demo with one person, turn on **Settings →
Auto-advance orders (demo)** in the console; while the console is open, every open order moves on a
step every 8 seconds. It is off by default.

The demo content (Maria and five other customers, orders #1027 to #1042, 1,240 points, vouchers and
six automated orders) is real data. **Console → Settings → Reset demo data** puts it all back; the
**Demo mode** switch beside it turns the demo tools (this reset, the screen index's states, auto-advance)
off before a real launch.

Also in the console: cancel with a reason, mark an order delayed, add internal notes (never shown to
the customer), retry or hand-process failed automated orders (**Simulate automated order** starts a new
one), edit the customer messages, set opening hours, prep time and the delivery fee, turn orders off,
and mark items sold out.

### Things to try on the phone

| Try | How |
| --- | --- |
| A promo code | `MEGS10`: 10% off after the Regular discount, minimum spend ₱200, once per customer. It replaces the automatic offer (one promotion per order). Cancelling the order gives the use back. The server checks the code again when the order is placed. |
| A declined payment | Pay with **Card ending 0002**: the server declines it, nothing charged, the cart is kept. |
| A failed order | Pay with **Card ending 0119**: payment goes through, placing the order fails once; **Retry** re-sends the same attempt and makes exactly one order. |
| Sign-in lockout | Log in with any password other than `password1` five times. The lock is kept by the database, so it holds on every device. |
| Already registered | Sign up with `0917 123 4567`. |
| Sign up | Any 6 digits pass the code step (SMS is simulated); the account is created then. **Forgot password** is a walkthrough until SMS codes are on: it changes nothing. |
| Offline | Add `?offline=1`: before the `#` for the whole visit (`/?offline=1#/home`), after it for one screen (`#/home?offline=1`). |
| Cafe closed | Turn **Accepting orders** off in the console, change the opening hours, or add `?closed=1` to a screen. |

The test cards are already in **Profile → Payment methods**; the add-card form has the same hint.

## Demo it on a phone

On a phone the app fills the screen like a native app: no frame, and the phone's own status bar.
The cart stays on the phone (FR-CRT-09); everything else is the account's, on any device.
**Profile → Settings → Reset demo data** clears only what this phone saved (the cart, choices and its
cached copy); to reset the shared demo content, use the staff console's Settings.

- **Same Wi-Fi, quickest:** run `npm run dev`, then open the "Network" address Vite prints
  (for example `http://192.168.1.20:5173`) on the phone.
- **Installed to the home screen, works offline:** the live app is at
  **https://megscafe.vercel.app** (staff console: https://megscafe.vercel.app/#/staff). It is the
  Vercel project `megscafe`; `vercel.json` sets its build and caching. To publish a new version:

  ```bash
  npx vercel deploy --prod
  ```

  Open the https address on the phone and install it from **Profile → Settings → Install app**: on
  Android and desktop Chrome or Edge that opens the install dialog, on iPhone it shows the Safari steps
  (**Share → Add to Home Screen**). It opens full screen with the MEGS' icon, and long-pressing the
  icon offers Menu, My orders and Rewards. Installing and offline use need https; over plain Wi-Fi
  (`http://`) the app runs but cannot be installed. `npx vite preview` on the computer itself counts
  as secure, so you can try it there.

  It is a progressive web app (`vite-plugin-pwa`, set up in `vite.config.ts`): the first visit
  downloads the whole app, menu photos included (about 3 MB), so it opens and browses offline from
  then on. When a new build is deployed, the app shows **A new version of the app is ready ·
  Reload** instead of switching in the middle of an order. The service worker runs only in built
  versions; `npm run dev` always shows the latest code. The phone screenshots in Android's install
  dialog are made with `node scripts/pwa-screenshots.mjs` while `npx vite preview` is running.

Two demo switches, for showing the prototype only (while demo mode is on):

- `?demo=member` signs in as Maria
- `?demo=cart` signs in as Maria with three items in the cart

App icons are made from the logo with `node scripts/app-icons.mjs`.

## The menu

The menu lives in the database (SRS MENU_CATEGORY, MENU_ITEM, OPTION_GROUP, OPTION_VALUE); the data
sheet in `data-sheet/` is where it's edited:

| File | Holds |
| --- | --- |
| `products.csv` | Every item: name, section, badges, prices per size, description, photo |
| `sections.csv` | The printed menu's boards and the Best Sellers, Must-Try and Kids' Favorites collections |
| `option_groups.csv` | Size, milk, add-ons and flavours, and which items each applies to (`applies_to`) |
| `option_choices.csv` | Each choice, its price and which one is selected by default (Sugar level: 100% default, 75%, 50%, 25%, 0%) |

After editing the CSVs, turn them into a migration and apply it:

```bash
node scripts/menu-to-sql.mjs          # writes supabase/migrations/<time>_menu_from_csv.sql
npx supabase db push --remote          # asks before changing the database
```

Re-importing never undoes a staff "Sold out" toggle. The app picks up menu changes live.

## Database and server

Everything is in `supabase/` (project `mqjttxhosdepvejghraa`, linked with `npx supabase link`).

| Where | What |
| --- | --- |
| `supabase/migrations/` | The schema (SRS Table 4-1), its rules (status transitions, points ledger, refunds, audit log), row-level security, the menu and reference data |
| `supabase/functions/place-order` | Prices the cart again from the database and places the order (one idempotency key per checkout) |
| `supabase/functions/staff-automations` | Simulate, retry and convert automated orders (staff only) |
| `supabase/functions/delete-account` | Deletes a customer's account, keeping anonymized order records |
| `supabase/functions/demo-reset` | Reset demo data (staff only, demo mode only) |
| `supabase/functions/_shared/pricing.ts` | The pricing engine, used by the app and the functions alike |
| `supabase/tests/rules_check.sql` | 76 checks of the database rules against the SRS |

Scripts: `create-staff.mjs` (staff accounts, needs the secret key), `seed-demo.mjs` (demo content),
`e2e-check.mjs` (a customer and a staff tab end to end in Chrome).

```bash
npm test                               # pricing engine unit tests (npm run coverage for coverage)
npx supabase start                     # a local database, API and functions (Docker)
npx supabase db reset                  # apply every migration to the local database
npx supabase functions deploy          # publish the Edge Functions
```

## Where things are

- `src/lib/supabase.ts`: the connection to the database (separate sign-ins for the app and the console).
- `src/state/shared.ts`: what both apps read and write: orders, store settings, notifications, points
  and vouchers, templates, automated orders, sign-in. Loads from the database, stays live through
  Realtime, keeps a copy on the device for offline viewing.
- `src/data/catalog.ts`, `menu.ts`, `rewards.ts`: the menu, rewards and offers from the database.
- `src/staff/`: the staff console (A-01 to A-11).

## Photos

Menu photos are converted from the cafe's originals into small WebP files in `src/assets/menu/`:

```bash
node scripts/menu-photos.mjs
```

The script lists which file belongs to which item, and fills the `image` column of `products.csv`.

## Design

- Colours and type are tokens in `src/index.css`: concrete ground, white plates, black ink, and gold
  only where a lamp is on (a live order, the current tracking step, points, the mark).
- The MEGS' logo is in `src/assets/brand/`.
- `design/redesign.template.html` is the three-screen redesign proposal; `node design/build.mjs`
  builds a standalone `design/redesign.html` from it.
