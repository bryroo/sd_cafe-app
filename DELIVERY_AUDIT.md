# Delivery audit (Bocaue-only, pinned location)

Date: 2026-11-21. Branch `ui-redesign`. Read-only audit of the local stack (migration `20261119122333`, same as production). Nothing was changed.

## Headline

Delivery already exists end to end, but with **no location at all**. Customers type a free-text address, the server accepts any saved address, and the order keeps a JSON snapshot. Nothing knows where Bocaue is. So the work is mostly: add a pinned location to the existing address, add a service-area check in the database, and make `place-order` enforce it. It is not a new feature built from scratch, and a parallel `delivery_addresses` table would duplicate what is there (see C1).

## 1. Current checkout and order flow

### Routes and screens (customer app)
| Route | Component | What it does |
|---|---|---|
| `/cart`, `/checkout` | `Checkout` ([src/screens/checkout.tsx](src/screens/checkout.tsx)) | One review screen: lines, `FulfillmentSummary` (links to `/fulfillment`), discounts, payment, note, `PriceBreakdown`, Place order |
| `/fulfillment` | `PickupOrDelivery` | `FulfillmentSelector` (pickup/delivery, delivery disabled when `deliveryEnabled` is false), radio list of `AddressCard`s, "Add new address" |
| `/address/:id` (`new` or an id) | `DeliveryAddress` | Free-text form: recipient, mobile, one "Street address" line, optional landmark + notes. Carries the note "Address entry is a placeholder form. It is replaced by the maps / address provider SDK." |
| `/order-confirmation` | `OrderConfirmation` | `FulfillmentDetails` with the snapshot address |
| `/orders/tracking`, `/orders/:number` | `OrderTracking`, `OrderDetail` ([src/screens/orders.tsx](src/screens/orders.tsx)) | Delivery steps: Received, Accepted, Preparing, Out for delivery, Delivered |
| `/profile/addresses` | `SavedAddresses` ([src/screens/profile.tsx](src/screens/profile.tsx)) | List + select + Edit + Add. **No delete and no "set default"** in the UI |

All of these are wrapped in `MemberOnly` in [src/routes.tsx](src/routes.tsx), so guests see a sign-in prompt.

### State
- [src/state/AppState.tsx](src/state/AppState.tsx): `fulfillment`, `addressId` (persisted in localStorage), auto-selects the default address, forces pickup when the cafe turns delivery off, moves payment off "Pay at counter" for delivery.
- [src/state/shared.ts](src/state/shared.ts): `Address` type is `{ id, label, name, street, phone, notes, isDefault }`. `street` is one joined string; `splitStreet()` re-splits it on commas into `street/barangay/city` when saving. `saveAddress()` inserts/updates `address` directly through PostgREST (RLS). It never sets `is_default`.
- Pricing engine ([supabase/functions/_shared/pricing.ts](supabase/functions/_shared/pricing.ts), shared by app and server): adds a flat `deliveryFee` for delivery, after discounts.

### Edge Function `place-order` ([supabase/functions/place-order/index.ts](supabase/functions/place-order/index.ts))
1. `caller()` resolves the JWT with `auth.getUser`; requires a `customer` row (staff and guests have none, so they get `SIGN_IN`).
2. Idempotency check, store open check, `DELIVERY_OFF` if delivery is disabled.
3. Delivery: `addressId` must belong to the caller (`.eq('customer_id', user.id)`), otherwise `ADDRESS`. Builds the snapshot `{label, recipient_name, street, barangay, city, mobile_no, notes}`.
4. Pay at counter is refused for delivery.
5. Totals recomputed server-side; `TOTAL_CHANGED` if they differ from what the customer saw.
6. Calls `create_order(p jsonb)` (service role only, SECURITY DEFINER) which inserts `orders`, `order_line`, `order_line_option`, `payment` in one transaction.

### Tables and RLS
- `address` ([core_schema.sql:158](supabase/migrations/20261107120000_core_schema.sql#L158)): `customer_id`, `label` enum (Home/Work/Other), `recipient_name`, `street`, `barangay`, `city` (all required), `mobile_no` (optional, `^\+639[0-9]{9}$`), `notes` (≤200), `is_default` (one per customer, partial unique index). Index on `customer_id`.
  - Policies, one per operation, all `to authenticated` with `(select auth.uid())`: select (own **or staff**), insert/update/delete (own). Grant: select/insert/update/delete to `authenticated`. Nothing for `anon`.
- `orders` ([core_schema.sql:350](supabase/migrations/20261107120000_core_schema.sql#L350)): `fulfillment` enum, `address_id` (FK, `on delete set null`), `delivery_address jsonb` snapshot, `delivery_fee` (only on delivery), `delivery_has_address` check, `total_adds_up` check, `eta`.
  - Clients may only `select` (own or staff) and `update (status, is_delayed, eta, cancel…)`. No insert grant; `create_order()` is the only writer.
  - `orders_before_update` freezes most columns but **not** `delivery_address`, `customer_name`, `customer_mobile` (so `delete-account` can anonymise them). Clients can't change them anyway (no column grant).
- There is no `order_items` table; lines are `order_line` → `order_line_option`, readable only through the parent order's visibility.
- `store_settings`: `delivery_enabled`, `delivery_fee` (2500 = ₱25), `delivery_eta_minutes` (35), `address` (null; the cafe has no stored location). Staff can update the delivery fields.

### Other places that touch delivery
- Staff console ([src/staff/orders.tsx](src/staff/orders.tsx)): Delivery/Pickup badge, "Out for delivery" / "Mark delivered" actions, "Deliver to: name, street".
- Status templates: `order_ready_delivery` ("Your order is on the way").
- `delete-account`: anonymises delivery snapshots to `{ removed: true }`.
- `demo_set_order_state()`: can flip a demo order to delivery, picking the customer's default address.
- `demo-reset/seed.ts`: seeds 4 addresses and one delivery order.

## 2. PostGIS, location columns, Maps

- **PostGIS is available but not installed** (`pg_available_extensions`: postgis 3.3.7, not installed locally). Only `citext` is installed. Enabling it needs your go-ahead.
- **No location columns anywhere.** No lat/lng, geography, geometry or place_id in any table or JSON snapshot.
- **No Google Maps code or loader.** The only Google traffic is Google Fonts. No `@googlemaps/*` package, no Maps key in `.env.local` / `.env.development.local` (both are git-ignored by `*.local` and `.env*`).
- No CSP header in [vercel.json](vercel.json) or index.html, so loading Maps won't be blocked (and nothing to update there).
- Anonymous sign-ins are off (`enable_anonymous_sign_ins = false` in [supabase/config.toml](supabase/config.toml)). Nothing checks the `is_anonymous` claim today.

## 3. Where delivery fits in the UI

- **Choose delivery:** `/fulfillment` already has the selector and the address list. The coming-soon state and "pinned / needs a pin" status per address belong here.
- **Add/edit an address:** `/address/:id` is the placeholder the map sheet replaces.
- **Manage addresses:** `/profile/addresses` needs delete and set-default.
- **Review:** `Checkout`'s `FulfillmentSummary` + the Place order footer are where an out-of-area or unpinned address must block delivery with an explanation.
- **After placing:** `FulfillmentDetails` (confirmation, tracking, detail) is where the pin preview and notes go. Staff order detail is where a rider needs the pin.

## 4. Conflicts and risks in the current flow

| # | Finding | Impact |
|---|---|---|
| C1 | A `public.address` table already holds saved delivery addresses with per-operation RLS, used by the app, `place-order`, the seed, `demo_set_order_state` and `delete-account`. | A new `delivery_addresses` table would duplicate it and break old clients. Extending `address` is the backward-compatible route. Its owner column is `customer_id` (= `auth.uid()`), not `user_id`. |
| C2 | Staff can read every customer's addresses (`… or is_staff()`). | Contradicts "users can only read their own rows" literally, but staff need the address to deliver. Keep, or limit staff to addresses on orders? |
| C3 | Existing addresses have **no coordinates**. | Once the server requires a pin, every saved address must be re-pinned before delivery. Old cached PWAs (`registerType: 'prompt'`) can't pin, so their delivery attempts would fail. |
| C4 | Seeded demo addresses are in **Quezon City and Mandaluyong**, outside Bocaue. | Demo delivery orders and `demo_set_order_state(…, 'delivery')` would break. Seed must move to Bocaue with coordinates, and `demo-reset` must be redeployed later (production step, yours). |
| C5 | `place-order` trusts any owned address; no area check. | The core gap. Must add the PostGIS check (and ideally a database-level guard so `create_order` can't take an out-of-area delivery either). |
| C6 | The SW caches every signed-in `GET /rest/v1/<table>` (including `address` and `orders.delivery_address`) for 7 days, and the localStorage mirror stores addresses. | Your verification step 9 says "no caching of Maps or address data". This conflicts with today's offline behaviour (addresses and past orders shown offline). Needs a decision. Maps requests are not matched by any rule today (the fonts rule is anchored to `fonts.googleapis.com`). |
| C7 | `Address.street` is one comma-joined string re-split by `splitStreet()`. | Fragile; the new form should send `street`, `barangay`, `city` separately. Old clients keep the old path. |
| C8 | `saveAddress` never sets `is_default`; `address_one_default` is a partial unique index. | Set-default needs an atomic swap (RPC or two writes in order). |
| C9 | `mobile_no` on `address` is optional. | The brief asks for a PH mobile on every delivery address. Making it `not null` breaks old rows/clients; enforce in `place-order` and the new form instead. |
| C10 | Delivery fee is a flat `store_settings.delivery_fee`; no minimum order; delivery hours = opening hours; ETA = `delivery_eta_minutes` (35). | Fine to keep; values for Bocaue need your numbers. |
| C11 | `delivery_address` is not in the order freeze list. | Deliberate (account deletion). The snapshot already keeps past orders independent of later address edits; adding coordinates to the snapshot keeps that property. |
| C12 | No Playwright, Lighthouse or axe in the project. | Verification steps 6 and 8 need new dev dependencies (your approval). |
| C13 | The store has no stored location (`store_settings.address` null). | Not needed for a polygon check; only needed if fees become distance-based. |
| C14 | `delete-account` anonymises the snapshot to `{ removed: true }`. | Must also drop coordinates; it does already, because it replaces the whole JSON. Keep it that way. |
