# MEGS' Cafe App

Prototype of the MEGS' Cafe customer ordering app and its staff console: browse the menu, customise
a drink or meal, order for pickup or delivery, and follow the order while the cafe works it from the
console. It is a front-end prototype with no backend yet: everything is saved in the browser
(`localStorage`, keys starting `megs.`), and the two apps stay in step across tabs.

Built with React, Vite and TypeScript.

## Run it

```bash
npm install
npm run dev
```

Then open the address Vite prints. On a desktop the app shows inside a phone frame, with a list of
every screen on the left.

## Demo the customer app and the staff console side by side

1. Open the app in one browser tab: that's the customer's phone.
2. Open the same address with `#/staff` on the end (for example `http://localhost:5173/#/staff`) in a
   second tab, or click any **Staff console** entry in the screen list: those open in a new tab.
3. Sign in to the console with **`staff` / `megs2026`** (the hint is on the login screen). Five wrong
   tries lock sign-in for 15 minutes.
4. Place an order on the phone. It appears in the console's **Orders → New** within a second or two,
   highlighted, with a chime. Accept it, start preparing, mark it ready, complete it: the phone's
   tracking screen follows each step, with a notification, and points are credited on Completed.

Both tabs must be in the same browser on the same device (they share its storage). Orders don't move
by themselves: staff move them. For a demo with one person, turn on **Settings → Auto-advance orders
(demo)** in the console; every open order then moves on a step every 8 seconds. It is off by default.

Also in the console: cancel with a reason, mark an order delayed, add internal notes (never shown to
the customer), retry or hand-process failed automated orders (**Simulate automated order** starts a new
one), edit the customer messages, set opening hours, prep time and the delivery fee, turn orders off,
and mark items sold out.

### Things to try on the phone

| Try | How |
| --- | --- |
| A promo code | `MEGS10`: 10% off after the Regular discount, minimum spend ₱200, once per customer. It replaces the automatic offer (one promotion per order). Cancelling the order gives the use back. |
| A declined payment | Pay with **Card ending 0002**: always declined, nothing charged, the cart is kept. |
| A failed order | Pay with **Card ending 0119**: payment goes through, placing the order fails once; **Retry** re-sends the same attempt and makes exactly one order. |
| Sign-in lockout | Log in with any password other than `password1` five times. |
| Already registered | Sign up with `0917 123 4567`. |
| Offline | Add `?offline=1`: before the `#` for the whole visit (`/?offline=1#/home`), after it for one screen (`#/home?offline=1`). |
| Cafe closed | Turn **Accepting orders** off in the console, change the opening hours, or add `?closed=1` to a screen. |

The test cards are already in **Profile → Payment methods**; the add-card form has the same hint.

## Demo it on a phone

On a phone the app fills the screen like a native app: no frame, and the phone's own status bar.
It remembers the cart, orders, points and sign-in between visits; **Profile → Settings → Reset demo
data** starts it over, including the staff console, the store settings and the order queue.

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

Two demo switches, for showing the prototype only (these visits start fresh and ignore saved data):

- `?demo=member` starts signed in
- `?demo=cart` starts signed in with three items in the cart

App icons are made from the logo with `node scripts/app-icons.mjs`.

## The menu

The menu is read from the data sheet in `data-sheet/`, not from the code:

| File | Holds |
| --- | --- |
| `products.csv` | Every item: name, section, badges, prices per size, description, photo |
| `sections.csv` | The printed menu's boards and the Best Sellers, Must-Try and Kids' Favorites collections |
| `option_groups.csv` | Size, milk, add-ons and flavours, and which items each applies to (`applies_to`) |
| `option_choices.csv` | Each choice, its price and which one is selected by default (Sugar level: 100% default, 75%, 50%, 25%, 0%) |

Edit the CSVs and restart `npm run dev` to see the change.

## Where things are

- `src/state/shared.ts`: the store both apps share (orders and their status rules, store settings,
  notifications, points and vouchers, templates, automated orders, staff sign-in). In the full system
  each write there becomes a server call.
- `src/staff/`: the staff console (A-01 to A-11).
- `src/data/templates.ts` and `src/data/automations.ts`: default customer messages and sample
  automated orders.

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
