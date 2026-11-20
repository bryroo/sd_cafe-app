> Approved 2026-11-20. Owner decisions: D2 merge cart + checkout; D3 Get-started checklist replaces the slides; D5 "+" opens Quick add; D4 Help shows placeholder contact details (owner will supply the real ones). D1: the approved plan keeps "Concrete & lamplight".

> **As built (2026-11-20).** Differences from the plan below:
> - Spacing tokens keep the existing pixel names (`--space-4` … `--space-48`, adding 20 and 48) instead of `--space-1…8`, which would have clashed with 100+ existing uses.
> - The keyboard shortcuts sheet was committed with the overlay and shell commits, not as its own feature commit.
> - Also fixed along the way (not in the plan): staff Accept and row switches were unclickable (CSS specificity), dark-mode contrast on gold badges, an empty `<h1>` in title-less top bars, 320 px reflow on the menu, Edit profile's unsaved "Favorite cafe" field (removed), and a hint when a chosen voucher needs a qualifying item.
> - Measured task counts (Playwright, touch / keyboard): T1 4 / 4, T2 2 / 2, T3 1 / 1, T4 5 (6 when the reward is only in the catalog) / 5, T5 5 / 5.

# Design plan: MEGS' Cafe redesign (refinement)

## Context

The audit ([DESIGN_AUDIT.md](DESIGN_AUDIT.md)) found that the app already has a sound skeleton: five destinations with the same labels and order on phone, tablet and desktop, a coherent "Concrete & lamplight" visual language with dark mode, skeletons, offline states, and no contrast failures. What hurts users is in the flows:

- a hard-coded "Order again" card;
- a "+" button that doesn't add anything;
- redeemed vouchers that aren't applied at checkout;
- almost no feedback after adding an item;
- dead-end rows and a "Coming soon" 404;
- desktop primary actions stranded at the bottom of the window.

On top of that, the CSS has drifted off its own tokens.

**Goal:** fewer taps on the core tasks, nothing that misleads, one tidy token and component set, and the same identity made a little more expressive. No navigation reinvention. No backend, schema, RLS or API changes.

**Assumed (please correct):** your brief left *Users*, *Reference apps* and *Dislikes* as placeholders. I'm assuming the users are cafe customers on phones (mostly repeat visitors) plus counter staff. For familiar conventions I'm using mainstream food-ordering apps (Starbucks, GrabFood, Jollibee, McDonald's) and iOS/Android platform conventions. I have no dislikes list.

---

## 1. Information architecture

Keep the five top-level destinations, in the same order on every layout: **Home · Menu · Orders · Rewards · Profile** (bottom tabs under 768 px, icon rail at 768–1023 px, sidebar at 1024 px and up). Reason: they match the five core tasks, the labels are plain, and people already know them.

Changes:
- **Profile becomes the home for secondary things only.**
  - New groups: *Account* (Edit profile, Payment methods, Saved addresses) · *Inbox* (Notifications, with an unread count) · *App* (Settings, Privacy) · *Help* (Help and support, About) · Log out.
  - Remove the three rows that duplicate tabs (Order history, Points activity, Regular status).
  - **Log out** stays only in Profile. **Delete account** stays only in Privacy, under "Your data".
- **Notifications:** an unread dot or count on Home's bell, on the Profile tab icon, and on the desktop sidebar's account area.
- **Desktop and tablet cart:** the sidebar Cart button is the only cart entry. The floating "View cart" bar shows only below 768 px.
- **No dead ends:**
  - "Help and support" opens a sheet with the cafe's hours (from `store_settings`), "Ask at the counter", and links to the order help on tracking. **Decision D4** covers the contact details.
  - "About" opens a sheet with the version and the Terms/Privacy links.
  - Unknown routes get a real 404 ("We couldn't find that page", with buttons for Home and Menu).
- **Routes:** every existing URL keeps working. If D2 merges cart and checkout, `/checkout` stays and `/cart` renders the same screen, so nothing redirects. If D3 removes the onboarding slides, `/onboarding/1-3` redirect to `/welcome`.

## 2. Familiar conventions (kept or adopted)

| Convention | Rule |
|---|---|
| Back | Top-left chevron on every pushed screen; browser and Android back work the same (already true). On desktop, also Esc on sheets. |
| Search | Search field at the top of Home; search icon at top-right of Menu; `/` shortcut. Unchanged. |
| Pull-to-refresh | Only on Orders and Tracking (live data). Already scoped this way. Nowhere else. |
| Swipe actions | **Cart line: swipe left to remove**, with an Undo toast; the stepper "−" at qty 1 does the same. Not on menus or orders, where a swipe could be accidental. |
| Sheets vs dialogs | Sheets for choosing (options, payment, discounts, help). Dialogs only for consequential confirmations (cancel order, redeem points, delete account, log out). Both become centred dialogs at 768 px and up (already true). |
| Icons | Always paired with a text label in navigation and rows (already true). Icon-only buttons keep `aria-label` + tooltip. |
| Primary action | **One primary button per screen, always in the same place**: sticky at the bottom on phones; on tablet and desktop, inline at the end of the content column (or in the summary panel on cart/checkout), never pinned to the window bottom. |
| Tabs, segmented controls | Unchanged (Orders: Active/History, Catalog: Available/My rewards). |

## 3. Identity: design tokens

Keep "Concrete & lamplight". It's distinctive, already built, and passes contrast in both themes. Make it a stricter system and add personality through motion and illustration, not layout. **Decision D1.**

Tokens, all in `src/index.css`, with light and dark values:

- **Colour.** Keep the existing roles (`--ground`, `--surface`, `--raised`, `--ink`, `--plate`, `--gold`, `--gold-ink`, `--negative`, `--positive`, …).
  - Add `--focus` (gold on plates, ink elsewhere), `--scrim`, `--success-bg/ink` and `--warning-bg/ink`.
  - Replace the ~70 hex literals in component CSS with tokens.
  - Drop the unused legacy aliases once nothing references them.
- **Type scale.** Formalise as tokens and remove the 11 and 13 px sizes.
  - Tokens: `--text-display 28/32`, `--text-h1 24/28`, `--text-h2 20/26`, `--text-h3 16/22`, `--text-body 16/24`, `--text-sm 14/20`, `--text-caption 12/16`.
  - The `.t-*` classes stay and read these tokens.
  - Raise the rail and row meta text to 14 px minimum where it carries meaning.
- **Spacing.** `--space-1…8` = 4, 8, 12, 16, 20, 24, 32, 48. Migrate the off-scale values (2, 5, 6, 10, 14, 28, 40, 44) to the nearest step, except 1–2 px hairlines.
- **Radius.** Keep the tight, industrial corners: controls 4, cards 6, sheets 10, and `--radius-pill` 999 for count badges. Remove the literals.
- **Elevation.** Keep three levels (none / sheet / dialog). Only floating things get a shadow.
- **Motion** (new). `--dur-fast 150ms` (press, toggle), `--dur-base 200ms` (sheet, toast, screen), `--dur-slow 250ms` (lamp/points celebration), `--ease-out cubic-bezier(.2,.7,.2,1)`. All of it is disabled under `prefers-reduced-motion`. Nothing blocks input.
- **Microinteractions** (the personality):
  - The **lamp lights** when an item is added: the cart badge glows gold for 250 ms.
  - **Points count up** on the Rewards hero after an order completes.
  - The tracker's current step glows (exists already; standardised).
- **Illustration.** Line-art empty states drawn from the existing `Lamp` mark plus a cup and receipt motif (inline SVG, no new assets pipeline) for: empty cart, no orders, no rewards, empty search, no notifications, offline, 404.
- **Theme setting.** Settings → Appearance: *System* (default) / *Light* / *Dark*. This is implemented as `data-theme` on `<html>`, with the dark tokens duplicated under `:root[data-theme="dark"]` and the media query guarded with `:root:not([data-theme="light"])`. Stored in localStorage.

## 4. Learnability

- **First run** (**Decision D3**, recommended): replace the three marketing slides with a **"Get started" checklist card** on Home. It shows three task steps that tick themselves off from existing state: *Pick something from the menu* (cart has items), *Place your first order* (an order exists), *See your points* (Rewards visited). It can be dismissed, hides itself when all three are done, and is stored locally. Welcome (Create account / Log in / Browse as guest) stays the first screen.
- **Empty states:** one `EmptyState` component (illustration, title, one-line reason, one primary action). For example: Orders → "No orders yet" + **Browse the menu**; My rewards → "Redeem points for a free drink" + **See rewards**; Notifications → "Order updates will show here".
- **Inline hints:**
  - The cart shows "Your Free drink voucher will be applied" when a voucher is waiting.
  - The product page shows what's included by default ("Cold · 16 oz · 100% sugar").
  - The Discounts sheet explains the regular discount in one line.
- **Progressive disclosure:**
  - Product options stay on the product page, while the "+" quick-add uses the defaults (see §6).
  - Special instructions collapse behind "Add a note" (the pattern already exists in Quick add).
  - The address form's optional fields collapse.
- **Language and terminology.** Use one term per thing:
  - **Cart** in the nav, but the screen title is "Your order". It already is; I'll keep it.
  - **Rewards** (points shop) vs **Offers** (promotions). Today the app says "Offers for you", "Promotions" and "Offer". I'll standardise on **Offers**; the route stays `/promotions`.
  - **Voucher** for a redeemed reward (today "My rewards"). Keep the tab label "My rewards" and call the items vouchers.

## 5. Feedback and safety

- **Skeletons:** already on Home. Extend the same `ProductRowSkeleton`/`CardSkeleton` to Orders, Rewards and Notifications on first load.
- **Toasts:** one system (OverlayHost `toast`, which already supports an action). Remove the local `Toast` in profile.tsx. Uses:
  - "Added Caramel Macchiato · View cart";
  - "Removed · Undo";
  - "Saved";
  - "Address saved";
  - errors with a retry where it's safe.

  Toasts use polite `aria-live` and stay at least 5 s when they carry an action.
- **Undo instead of confirm:** removing a cart line (stepper or swipe), clearing recent searches, and dismissing the promo banner. These are all local UI state, so undo is safe.
- **Keep confirm** only for actions that are consequential or irreversible on the server: cancel order, redeem points, delete account, log out, and the existing similar-order and payment-failure dialogs. Replace the native `window.confirm` (demo reset) with the app's Dialog.
- **Forms:** submit buttons are enabled. Validation runs on blur and on submit, with specific messages under each field ("Enter an 11-digit mobile number starting with 09", "Password needs at least 8 characters and a number"). Focus goes to the first invalid field, and fields get `aria-invalid` + `aria-describedby`. Applies to Sign up, Log in, Forgot/Reset, Address, Add payment and Edit profile. The rules are the same ones the screens use today; only their presentation changes.

## 6. Core-flow changes (where the taps go)

1. **"+" on a menu row opens the existing Quick-add sheet** (`QuickAddSheet` in `src/overlays/OverlayHost.tsx`, today unused). It shows the defaults, a qty stepper, **Add · ₱130**, and a **Customise** link to the product page. **Decision D5.**
2. **After Add** (sheet or product page): stay where you are, show the toast "Added · View cart", and light up the cart. The product page still goes back afterwards, as now.
3. **Real "Order again"** on Home: built from the customer's most recent completed order (already loaded in shared state); hidden if there isn't one. It uses the existing `useReorder` (unavailable-items dialog included).
4. **Redeemed voucher auto-applies:** "Use it on your next order" calls the existing `setAppliedReward(id)`. The cart and checkout show a "Voucher applied · Remove" row. The server still validates it in `place-order`, so this is client state only.
5. **Cart + checkout on one review screen** (**Decision D2**, recommended): the editable lines, pickup/delivery, voucher, payment, note and total sit on one screen with **Place order**. On desktop it's two columns (lines on the left; a sticky summary panel with Place order on the right). All existing checkout logic in `Checkout()` (`src/screens/checkout.tsx`) moves over unchanged: idempotency key, similar-order check, payment errors, closed store, unavailable lines.
6. **Discounts sheet:** the code button becomes "Apply code" and the sheet button becomes "Done".
7. **Remove** the non-functional favourite heart (there's no favourites table; real favourites would need a backend change).

### Before → after (phone, member)

| Task | Before | After | How |
|---|---|---|---|
| T1 Order a drink with defaults, pickup | 6 | **4** from Home Best Sellers ("+" → Add → cart → Place order); **5** via a group tile | quick-add, merged review screen |
| T1b Same via search | 6 + typing | **4** + typing | same |
| T2 Reorder last order | 5 (Orders → History → Reorder → Checkout → Place) | **2** from Home (Order again → Place order); **4** from Orders history | real Order again, merged review |
| T3 Track active order | 1 / 2 | 1 / 2 | unchanged (already good) |
| T4 Redeem and use a voucher | 8 reward-specific taps | **5** (Rewards → card → Redeem → confirm → Use it); the voucher is applied automatically | auto-apply |
| T5 Staff accept → ready | ~5 | ~5 | staff flows out of scope except polish |

Desktop click counts follow the same numbers.

## 7. Industry-standard features: ranked recommendations

| Rank | Feature | Fits? | Cost | Backend needed | Proposal |
|---|---|---|---|---|---|
| 1 | Notifications inbox: unread badge + "Mark all read" | Yes, order updates are core | S | No (`notification.read_at` is already customer-updatable) | **Do** |
| 2 | Help/support entry point | Yes, dead end today | S | No | **Do** (static sheet; see D4) |
| 3 | Light/dark/system theme setting | Yes, cheap | S | No | **Do** |
| 4 | Sign-in conveniences: correct `autocomplete` (tel, current-/new-password, one-time-code), password-manager friendly, remember last mobile number | Yes | S | No | **Do** |
| 5 | Keyboard shortcuts help ("?" sheet listing Alt+1…5, /, Esc) | Desktop only, small | S | No | **Do** |
| 6 | Filters on Menu: Hot/Cold chips (they exist on section lists) | Moderate | S | No | **Do** (reuse `Chip`) |
| 7 | Command palette (Ctrl+K) | Low; ~70 items, search already covers it | M | No | **Skip** |
| 8 | Sort on menu/orders | Low; short lists in printed-menu order | S | No | **Skip** |
| 9 | Data export | Already in Privacy ("Download my data") | — | — | Keep as is |
| 10 | In-app accessibility settings | Low; OS text size, reduced motion and contrast are respected | M | No | **Skip** (verify 200 % zoom instead) |
| 11 | Passkeys / SMS OTP sign-in | Real value, but needs Auth/Edge changes | L | **Yes** | **Skip, flag to you** (already on the launch list) |
| 12 | Saved favourites | Would replace the fake heart | M | **Yes** (new table + RLS) | **Skip, flag to you** |

## 8. Component inventory

- **Reuse as is:** `Button`, `TextField`, `PasswordField`, `Checkbox`, `Toggle`, `OtpInput`, `Tabs`, `Chip`, `Badge`, `ListRow`, `Card`, `Stepper`, `Radio`, `StatusStepper`, `OrderCard`, `PriceBreakdown`, `AppNav`/`BottomNav` (tabs from `src/components/tabs.ts`), `ProductRow`, the skeletons, `Lamp`, `Photo`.
- **Restyle** (tokens only): every CSS file. The main ones are `blocks.css`, `order.css`, `screen.css`, `ui.css` and `overlays.css`; the staff `staff.css` gets tokens only.
- **Merge:**
  - `Alert` + `OfflineBanner` + `ClosedBanner` → one `Banner` (tone, icon, optional action). The old names stay as thin wrappers so the screens change minimally.
  - The local profile `Toast` → OverlayHost toast.
  - `SettingsRow`/`Group` (profile.tsx) → `ListRow` + a `ListGroup`.
- **Create:** `EmptyState`, `ListGroup`, `ActionBar` (sticky on phone, inline on tablet/desktop; replaces the ad-hoc `footer` usage), `FieldError` (inline validation), `SwipeRow` (cart only; pointer events, no dependency), `NotFound` screen, `HelpSheet`, `AboutSheet`, `ShortcutsSheet`, `GetStarted` card, an unread `CountBadge`.
- **Focus management:** sheets and dialogs move focus in, trap it, and return it on close (check `Sheet`/`Dialog` in OverlayHost and add what's missing). On route change, focus moves to the screen's `<h1>`, announced politely.
- **Axe fixes:** names on the points progress bars, the pagination dots, the address "Edit" target size, and the scrollable onboarding region (it goes away if D3 is approved).

No new dependencies. Playwright, axe and Lighthouse run from a scratch folder via `npx`, not added to package.json.

## 9. Implementation order (one commit per item)

1. Tokens: type, space, radius, motion, focus and theme attribute in `src/index.css`; `.t-*` read the tokens.
2. CSS migration to tokens, file by file (one commit per component group).
3. Base components: `Banner`, `EmptyState`, `ListGroup`, `ActionBar`, `FieldError`, `CountBadge`, toast consolidation, Sheet/Dialog focus management.
4. Shell: route-change focus, floating cart bar only under 768 px, unread badges in nav, real 404.
5. Screens, one commit each:
   - Home (real Order again, Get started, badge);
   - Menu/Section/Search ("+" → quick-add, Hot/Cold chips, rail type);
   - Product (toast, heart removed, collapsed note);
   - Cart+Checkout review (D2);
   - Orders/Tracking (empty states, skeletons);
   - Rewards/Offers (auto-apply, wording);
   - Profile/Settings/Privacy (regroup, Appearance, Help/About sheets);
   - Account screens (inline validation, autocomplete, onboarding change per D3);
   - staff polish (Responses phone layout, tokens).
6. Features, one commit each: theme setting; Mark-all-read; shortcuts sheet; sign-in autocomplete/remember.
7. Docs: update CLAUDE.md (tokens, component conventions, nav structure) and save this plan as `DESIGN_PLAN.md`.

## 10. Verification

1. `npm run build`, `npm run lint`, `tsc -b` (part of the build) and `npm test`; fix any failures. `npm run test:db` too, to confirm nothing changed below the UI.
2. Rerun the scratchpad `capture.mjs` into `after/` at the same three sizes, light and dark. Build side-by-side contact sheets against `before/`, review every pair, and fix visual bugs.
3. A Playwright task-walk script for T1–T5: once keyboard-only (Tab/Enter/Space/Esc) and once with touch emulation (`hasTouch`, tap). Count interactions and report before/after against the table above.
4. axe on every screen (no critical or serious violations), plus Lighthouse Accessibility on a production build via `vite preview` (≥ 95 on Home, Menu, Product, Cart/Checkout, Orders, Rewards and Profile).
5. Overflow checks at 320 px width and at 200 % text scale (CSS zoom plus root font-size): script `scrollWidth > clientWidth` and clipped-text detection on every screen, then fix.
6. Update CLAUDE.md.
7. Report what I couldn't verify: real iOS Safari/Android touch and safe areas, VoiceOver/TalkBack, real push notifications, and a hallway test with someone who has never used the app.

## Decisions that need you

- **D1 Identity:** keep "Concrete & lamplight" and tighten it (recommended), or explore a new direction?
- **D2 Cart + Checkout:** merge into one review screen (recommended; −1 tap on every order, the familiar GrabFood/Foodpanda pattern), or keep them as two screens?
- **D3 First run:** replace the 3 onboarding slides with the Home "Get started" checklist (recommended), or keep the slides?
- **D4 Help content:** what should Help show: the cafe phone number, Facebook page or email? Without it, I'll show hours + "Ask at the counter" only.
- **D5 "+" button:** open the Quick-add sheet with defaults (recommended; safe, 1 tap to confirm), or add instantly with an Undo toast (1 tap fewer, but drinks get a size the person didn't see)?
- **Reference apps and dislikes:** fill them in if they differ from my assumption above.
