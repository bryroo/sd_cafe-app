# Design audit: MEGS' Cafe app

Date: 2026-11-20. Branch `supabase-data-layer` at `efbd961`. Read-only: no app code was changed.

## Method

- Ran the app against the local Supabase stack (dev server, local Edge Functions, seeded demo data) and used Playwright to screenshot **70 screens and states** at 390×844, 768×1024 and 1440×900, in light and dark mode (about 420 images). Covered states: signed out, guest, member, loading (`?state=loading`), store closed, offline (network cut), sign-in error, form validation, empty cart, empty search, populated lists, sheets, 404, and the full staff console.
- Ran axe-core (WCAG 2.0/2.1/2.2 A and AA rules) on 45 of those screens at each size.
- Read the screen and component code to check the behaviour behind each control.
- Screenshots: `C:\Users\PAULAN~1\AppData\Local\Temp\claude\48ee8349f062073f\7ff6a5f8-f7db-4b30-8002-aa28dc2f7572\scratchpad\pw\before\` (`light|dark` / `phone|tablet|desktop`). The capture script is next to it (`capture.mjs`) and will be rerun for the "after" set.

## Starting point

This is not a blank slate. The app already has:

- A defined visual language, "Concrete & lamplight": warm-grey ground, white plates, black ink, gold used only for "lit" things (live order, earned points, the selected option). One family (Archivo) with a wide cut for titles. Tokens live in `src/index.css`, and a dark theme exists.
- Five top-level destinations (Home, Menu, Orders, Rewards, Profile), shown as bottom tabs on phones, an icon rail on tablets and a sidebar on desktop, in the same order with the same labels everywhere.
- Skeleton loading, an offline pill, offline banners, closed-store banners, Alt+1…5 shortcuts, `/` for search, a skip link, focus rings, reduced-motion support and 44–48 px touch targets.
- Few axe violations (below) and **no colour-contrast failures** at any size or in either theme.

So the job is refinement: fixing flows that cost extra taps or mislead, removing dead ends, and tidying the desktop layout and the component set. A new navigation model isn't needed.

## Users and core tasks

- **Customers** (phone first, often repeat visitors to one cafe in Quezon City) order drinks and meals ahead for pickup or delivery, earn points and redeem vouchers.
- **Staff** (counter tablet or desktop) work the incoming order queue.

### Tap counts today (phone, signed-in member, starting on Home)

| # | Task | Path today | Taps |
|---|---|---|---|
| T1 | Order one drink with default options, pickup, saved card | Coffee tile → item → Add to order → (back on Menu) View cart → Checkout → Place order | **6** |
| T1b | Same, via search | Search → type → result → Add to order → View cart → Checkout → Place order | **6** + typing |
| T2 | Reorder a past order | Orders tab → History → Reorder → Checkout → Place order | **5** |
| T3 | Check an active order | Live-order card on Home | **1** (2 from any other tab: Orders → Track order) |
| T4 | Redeem a reward and use it | Rewards → reward card → Redeem → confirm → "Use it on your next order" → …build cart… → Checkout → Discount & rewards → pick voucher → Apply → Place order | **8** reward-specific taps on top of building the cart |
| T5 | Staff: accept a new order and get it to Ready | Orders → Accept (in the row) → open order → Start preparing → Mark ready | **~5** |

Desktop click counts are the same, since the flows are identical.

## Information architecture today

```
Splash ─┬─ Onboarding 1-3 (first launch only, Skip) ─ Welcome ─┬─ Create account → Verify code → Home
        │                                                      ├─ Log in (→ Forgot → Reset)
        └─ (signed in) ───────────────────────────────────────┴─ Browse as guest → Home
Tabs: Home │ Menu │ Orders │ Rewards │ Profile
 Home ── Search, group tiles → Menu@section, points strip → Rewards, Best Sellers → Section list,
         live-order card → Tracking, promo banner → Promotion, "Order again", bell → Notifications
 Menu ── section rail + list → Product → (back);  floating "View cart" bar → Cart → Pickup/Delivery → Address
         → Checkout (sheets: Discounts, Payment) → Confirmation → Tracking
 Orders ─ Active │ History → Order detail → Reorder;  Active → Tracking
 Rewards ─ Status, Catalog (Available │ My rewards) → Reward detail, Points activity, Promotions → Promotion
 Profile ─ Edit profile, Payment methods → Add, Saved addresses, Order history*, Points activity*,
           Regular status*, Notifications, Settings (→ Privacy), Help and support†, About†, Log out
Staff (#/staff): Dashboard │ Orders │ Automations │ Responses │ Settings (→ Item availability), Profile
```
\* duplicates a tab. † does nothing when tapped.

- **Dead ends:** "Help and support" and "About MEGS' Cafe" in Profile have no action. Any unknown URL shows "Coming soon: This screen is not built yet."
- **Buried:** Notifications (the inbox) is reachable only from Home's bell and Profile → *Preferences*. The bell has no unread badge although unread items exist. Promotions are two levels down (Rewards → Offers for you). Item availability (staff) sits inside Store settings.
- **Duplicated paths:** Order history, Points activity and Regular status are each in Profile *and* in their tab. Delete account is in both Settings and Privacy. Log out is in both Profile and Settings. On tablet and desktop, the cart is reachable from both the sidebar Cart button and a floating "View cart" bar.

## Heuristic and consistency findings, ranked by user impact

Severity: **High** means it misleads people or adds taps to a core task. **Medium** means friction or inconsistency. **Low** means polish.

| # | Sev | Finding | Heuristic / WCAG | Fix type |
|---|---|---|---|---|
| 1 | High | **"Order again" on Home is hard-coded** to Caramel Macchiato + Carbonara for every member, whatever they ordered. Tapping it fills the cart with things they may never have ordered. | H1 visibility of status, H2 match with real world | Quick win (use the last completed order, which is already loaded) |
| 2 | High | **The "+" on every menu row only opens the product page** (its label says "Choose options"). Every mainstream food app treats "+" as add. A quick-add sheet already exists in the code (O-02) but nothing uses it. | H2, H4 consistency/standards, H7 efficiency | Quick win |
| 3 | High | **A redeemed voucher isn't applied.** "Use it on your next order" goes to Menu and nothing says the voucher is waiting. The customer has to find Checkout → Discount & rewards → pick it → Apply. That's 3 hidden taps, and people will pay full price without knowing. | H6 recognition over recall, H1 | Quick win (pre-select the voucher in client state; the server still validates it) |
| 4 | High | **Adding an item gives almost no feedback.** The button reads "Added" for 450 ms, then the page goes back. There's no toast, and the cart count change is the only signal. | H1 | Quick win (toast with "View cart") |
| 5 | Med | **Desktop and tablet primary actions sit in a full-width sticky footer at the bottom of the viewport**, far from the content they act on (Cart "Checkout", Regular status "Order now", Reward "Use it…", Profile "Save"). Checkout is a single narrow column on a 1440 px screen. | H8 aesthetic/minimal; Fitts | Structural |
| 6 | Med | **The floating "View cart" bar covers menu items** on tablet and desktop, and duplicates the sidebar Cart button. | H8, H4 | Quick win |
| 7 | Med | **Notifications have no unread indicator** and sit under "Preferences" in Profile. | H1 | Quick win |
| 8 | Med | **Dead ends:** Help and support, About, and a "Coming soon" 404 page. | H9 recover from errors, H10 help | Quick win |
| 9 | Med | **Primary buttons are disabled with no reason given** (Sign up "Continue", Save address, Add payment "Save", Log in while offline). People don't learn what's missing until they spot it themselves. | H9, WCAG 3.3.1 / 3.3.3 | Quick win (enable, validate on submit, explain inline) |
| 10 | Med | **Confirmation dialogs for undoable actions.** Removing a cart line (stepper "−" at 1) opens an "are you sure" dialog. Undo would be quicker and just as safe. The demo reset uses the browser's native `window.confirm`, unlike every other dialog. | H3 user control, H4 | Quick win |
| 11 | Med | **The Discounts sheet has two "Apply" buttons** (one for the promo code field, one for the sheet), so it's unclear what each applies. | H4 | Quick win (rename to "Apply code" / "Done") |
| 12 | Med | **The favourite heart on the product page saves nothing**; it resets when you leave. There's no favourites table. | H2 (false affordance) | Quick win (remove it) |
| 13 | Med | **Profile mixes account, activity, preferences and support in one long list**, three of which duplicate tabs. Log out and Delete account appear twice. | H8, IA | Structural (small) |
| 14 | Med | **Onboarding is three marketing slides** (big photo + slogan), not task-based, and it appears before people can see the menu. | Learnability | Structural (small) |
| 15 | Low | **Privacy:** the "Promotional messages" toggle overlaps its own description at 390 px (visual bug). | WCAG 1.4.10 reflow | Quick win |
| 16 | Low | **Phone menu rail** labels are 12–13 px grey text in an 88 px column; "Strong Coffee" and "Caramel Series" wrap to two lines. | Readability | Quick win |
| 17 | Low | **Staff "Customer messages" on phone:** the template text is squeezed into a ~70 px column beside the toggle. | H8 | Quick win |
| 18 | Low | **Desktop column alignment varies:** some screens use the 1080 px column, some 720 px, and the guest Profile button stretches to 1080 px. Titles don't line up between neighbouring screens. | H4 | Structural (layout primitives) |
| 19 | Low | **Some product photos are missing** (Hazelnut, Ube Spanish Latte, Biscoff Latte show a placeholder cup). This is content, not design. | n/a | Content |

### Accessibility (axe-core, WCAG 2.2 AA rules)

No critical violations and no contrast violations. Four serious rules failed:

| Rule | Where | Fix |
|---|---|---|
| `aria-progressbar-name` | Points strip (Home), Rewards hero, Regular status (2) | Add `aria-label` / `aria-valuetext` |
| `aria-prohibited-attr` | Onboarding pagination dots (`aria-label` on a plain div) | Use `role="img"` or hidden text |
| `target-size` | Saved addresses "Edit" link (under 24 px with a tight neighbour) | Make it a 44 px button |
| `scrollable-region-focusable` | Onboarding body at desktop | `tabIndex=0` on the scroller, or remove the overflow |

Manual checks still needed (axe can't test these): focus moves into a sheet or dialog on open and back on close; route changes move focus to the new `<h1>`; 200 % text zoom; 320 px width.

### Visual consistency

- **Type:** the scale has 8 named styles (`t-display` … `t-caption`), but CSS also sets 9 raw sizes (11, 12, 13, 14, 16, 20, 24, 28, 36 px). The 11 and 13 px sizes aren't in the scale.
- **Spacing:** the token scale is 4/8/12/16/24/32, but CSS also uses 2, 5, 6, 10, 14, 20, 28, 40 and 44 px (about 50 off-scale uses). Spacing tokens are defined but rarely referenced; most values are raw numbers.
- **Radius:** mostly tokenised, plus 2, 3, 5, 10, 12 and 999 px literals.
- **Colour:** 70 hex literals in CSS outside the token block, across 6 files. Most duplicate a token value.
- **Components:** two toast implementations (OverlayHost toast and a local `Toast` in profile.tsx); two modal systems (customer `Sheet`/`Dialog` and staff `Modal`); `Alert`, `OfflineBanner` and `ClosedBanner` are three banner variants built separately. Buttons are consistent (`Button` with primary, secondary and text variants).

## Quick wins vs structural changes

**Quick wins** (one screen or component each, no backend):
1 (real "Order again"), 2 ("+" opens quick-add, or adds directly), 3 (auto-apply the redeemed voucher), 4 (added-to-cart toast), 6 (hide the floating cart bar where the sidebar shows the cart), 7 (unread badge on the bell), 8 (Help sheet, About sheet, real 404), 9 (enabled buttons + inline validation), 10 (undo instead of confirm), 11, 12, 15, 16, 17, and the four axe fixes.

**Structural** (shared layout or several screens):
5 (desktop two-column cart/checkout and in-flow primary actions), 13 (Profile regrouping), 14 (task-based first run), 18 (one set of layout widths), and moving all CSS onto tokens.
