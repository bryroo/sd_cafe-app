// The shared store: what the customer app and the staff console read and write, now backed by the
// MEGS' Cafe database (Supabase). A signed-in customer loads only their own rows; staff load the queue.
// Realtime keeps both up to date within seconds (FR-TRK-02, FR-STF-04); the last copy is kept on the
// device so the app still shows the last known state offline (NFR-REL-04).
// Business rules live in the database (triggers, RLS) and the Edge Functions; this file maps rows to the
// app's shapes (pesos, camelCase) and sends the writes.
import { useEffect, useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { callFunction, db, isStaffTab, loginAddress } from '../lib/supabase'
import { getCatalog, onCatalog, refreshCatalog, type StoreRow, type TierRow } from '../data/catalog'
import { products } from '../data/menu'
import { setUsedPromotions, type MyReward } from '../data/rewards'
import { defaultTemplates, fill, type Template, type TemplateEvent, type Vars } from '../data/templates'
import type { Automation } from '../data/automations'

/* ---------- Types ---------- */

export type CartLine = {
  key: string
  productId: string
  /** Chosen options, e.g. ["Cold · 16 oz", "100%", "Oat milk"] */
  options: string[]
  note: string
  unitPrice: number
  qty: number
  /** The item's name when it was ordered (orders keep it even if the menu changes) */
  name?: string
}

export type Address = {
  id: string
  label: 'Home' | 'Work' | 'Other'
  name: string
  /** "House no., street, barangay, city" */
  street: string
  phone: string
  notes?: string
  isDefault?: boolean
}

export type Fulfillment = 'pickup' | 'delivery'

/** SRS Table 3-1. Delayed is a flag on the order, not a status. */
export type OrderStatus = 'Received' | 'Accepted' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled'
export const STATUSES: OrderStatus[] = ['Received', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled']

export type TimelineEvent = { label: string; status?: OrderStatus; at: number; by: string }
export type InternalNote = { author: string; at: number; text: string }

export type Order = {
  /** Database id (orders.order_id) */
  id: string
  number: number
  /** The checkout's idempotency key: a retry never makes a second order (IR-08) */
  attemptId?: string
  customerId: string
  customerName: string
  customerPhone: string
  fulfillment: Fulfillment
  address?: Address
  lines: CartLine[]
  note?: string
  subtotal: number
  /** Tier discount */
  discount: number
  offerName?: string
  offerDiscount?: number
  promoCode?: string
  rewardId?: string
  rewardName?: string
  rewardDiscount?: number
  deliveryFee: number
  total: number
  payment: string
  paymentStatus: 'Paid' | 'Pay at counter' | 'Refund started' | 'Not charged'
  /** Staff only (IR-03) */
  paymentRef?: string
  points: number
  pointsCredited?: boolean
  status: OrderStatus
  isDelayed?: boolean
  eta: number
  placedAt: number
  timeline: TimelineEvent[]
  cancelReason?: string
  cancelledBy?: 'customer' | 'cafe'
  /** Staff only: never loaded in the customer app (IR-03) */
  internalNotes: InternalNote[]
  source: 'app' | 'automated'
}

export type Hours = { open: string; close: string; closed: boolean }

export type StoreSettings = {
  settingsId: number
  cafeName: string
  acceptingOrders: boolean
  /** Opening hours per weekday, Sunday first, Asia/Manila time */
  hours: Hours[]
  /** Default preparation time: the pickup ETA (FR-OPS-03) */
  prepMinutes: number
  deliveryMinutes: number
  deliveryEnabled: boolean
  deliveryFee: number
  pointsPerPeso: number
  /** Sold-out items, from the menu (FR-OPS-04) */
  availability: Record<string, { available: boolean; reason?: string }>
  /** New-order chime in the staff console */
  chime: boolean
  /** Demo only: the open console moves every order on by itself every 8 s */
  autoAdvance: boolean
  /** Demo tools work only while this is on */
  demoMode: boolean
}

export type CustomerNote = {
  id: string
  title: string
  body: string
  at: number
  /** Where tapping it goes */
  to: string
  read: boolean
  event?: TemplateEvent
  /** Sent as a push message too (Accepted, Ready, Delayed, Cancelled) */
  push?: boolean
}

export type PointsEntry = { id: string; description: string; at: number; points: number }

export type StaffState = {
  signedIn: boolean
  /** Signed in, but the account isn't a staff account */
  notStaff?: boolean
  id?: string
  username?: string
  name: string
  role: string
  fails: number
  lockedUntil: number
}

export type Customer = {
  id: string
  name: string
  /** E.164 */
  mobile: string
  email: string
  birthday: string
  defaultSize: string
  tierId: number
  points: number
  notifyOrders: boolean
  notifyPromotions: boolean
  notifyRewards: boolean
}

export type SavedMethod = { id: string; type: 'card' | 'e_wallet'; label: string; isDefault: boolean; token: string }

export type Tier = { id: number; name: string; rank: number; pct: number; qualifyOrders: number | null; qualifyDays: number | null; description: string; isDefault: boolean }

type Shared = {
  /** The signed-in person's data has loaded at least once */
  ready: boolean
  orders: Order[]
  store: StoreSettings
  tiers: Tier[]
  customer: Customer | null
  addresses: Address[]
  paymentMethods: SavedMethod[]
  notifications: CustomerNote[]
  points: number
  myRewards: MyReward[]
  /** Promotions (promo codes and one-time offers) this customer has used */
  promoUses: string[]
  /** Points credited or spent, newest first */
  pointsLog: PointsEntry[]
  templates: Template[]
  automations: Automation[]
  staff: StaffState
}

/* ---------- Constants and helpers ---------- */

export const CAFE_NAME = "MEGS' Cafe"
export const COUNTER = 'Pay at counter'
export const MIN = 60_000
/** Delivery takes about this long: the delivery ETA (store_settings.delivery_eta_minutes) */
export const DELIVERY_MINUTES = 35
/** The demo staff account (scripts/create-staff.mjs) */
export const STAFF_LOGIN = { username: 'staff', password: 'megs2026' }
export const LOCK_AFTER = 5
export const LOCK_MINUTES = 15
/** The demo customer (demo-reset seed) */
export const DEMO_CUSTOMER = { mobile: '+639171234567', password: 'password1' }

/** The demo cart for the checkout screens (₱480 subtotal), priced from the menu boards:
 *  Caramel Macchiato cold 22 oz ₱140 · Carbonara ₱180 · Spanish Latte cold 16 oz ₱110 + oat milk ₱50. */
export const sampleLines: CartLine[] = [
  { key: 'sample-1', productId: 'caramel-macchiato', options: ['Cold · 22 oz', 'Regular milk'], note: '', unitPrice: 140, qty: 1 },
  { key: 'sample-2', productId: 'carbonara', options: [], note: '', unitPrice: 180, qty: 1 },
  { key: 'sample-3', productId: 'spanish-latte', options: ['Cold · 16 oz', 'Oat milk'], note: 'less ice', unitPrice: 160, qty: 1 },
]

/** '0917 123 4567' → '+63 917 123 4567' */
export function toIntlPhone(phone: string) {
  const digits = phone.replace(/\D/g, '').replace(/^(63|0)/, '')
  if (digits.length !== 10) return phone
  return `+63 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
}
/** '0917 123 4567' → '+639171234567' (SRS 3.8: E.164) */
export function toE164(phone: string) {
  const digits = phone.replace(/\D/g, '').replace(/^(63|0)/, '')
  return digits.length === 10 ? `+63${digits}` : phone.trim()
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there'

/** Wall-clock parts in Asia/Manila (SRS 3.1.4: shown in Manila time) */
function manila(ts: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ts))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

/** "10:42 AM" in Manila time */
export const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })

/** "12 Oct · 10:42 AM" */
export const dateTime = (ts: number) =>
  `${new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Manila' })} · ${clock(ts)}`

/** "07:00" → "7:00 AM" */
export const hourLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export type OpenState = {
  open: boolean
  /** Off by staff, or outside opening hours */
  why?: 'paused' | 'hours'
  today: string
  /** "Opens today at 7:00 AM", "Opens tomorrow at 7:00 AM" */
  next?: string
}

/** SRS FR-CHK-11, FR-OPS-02, IR-10: orders are taken only while Accepting orders is on and the cafe is open */
export function openState(store: StoreSettings, now = Date.now()): OpenState {
  const { day, minutes } = manila(now)
  const h = store.hours[day] ?? { open: '07:00', close: '21:00', closed: false }
  const today = h.closed ? 'Closed today' : `Today ${hourLabel(h.open)} – ${hourLabel(h.close)}`
  const inHours = !h.closed && minutes >= toMinutes(h.open) && minutes < toMinutes(h.close)
  if (store.acceptingOrders && inHours) return { open: true, today }
  let next: string | undefined
  if (!h.closed && minutes < toMinutes(h.open)) next = `Opens today at ${hourLabel(h.open)}`
  else
    for (let i = 1; i <= 7; i++) {
      const d = store.hours[(day + i) % 7]
      if (!d || d.closed) continue
      next = `Opens ${i === 1 ? 'tomorrow' : DAYS[(day + i) % 7]} at ${hourLabel(d.open)}`
      break
    }
  if (!store.acceptingOrders) return { open: false, why: 'paused', today, next: inHours ? undefined : next }
  return { open: false, why: 'hours', today, next }
}

/** Minutes until the ETA, never below 1 */
export const minutesLeft = (eta: number, now = Date.now()) => Math.max(1, Math.round((eta - now) / MIN))

/** "Ready in about 8 min" / "Arrives in about 30 min" */
export const etaLine = (o: Pick<Order, 'eta' | 'fulfillment'>, now = Date.now()) =>
  `${o.fulfillment === 'delivery' ? 'Arrives' : 'Ready'} in about ${minutesLeft(o.eta, now)} min`

/* ---------- Mapping database rows to the app's shapes ---------- */

const pesos = (c: number | null | undefined) => (c ?? 0) / 100

const EVENTS: Record<string, TemplateEvent> = {
  order_received: 'received',
  order_accepted: 'accepted',
  order_preparing: 'preparing',
  order_ready_pickup: 'ready-pickup',
  order_ready_delivery: 'ready-delivery',
  order_completed: 'completed',
  order_cancelled_cafe: 'cancelled-cafe',
  order_cancelled_customer: 'cancelled-customer',
  order_delayed: 'delayed',
  item_unavailable: 'item-unavailable',
  payment_failed: 'payment-failed',
}
const DB_EVENT = Object.fromEntries(Object.entries(EVENTS).map(([k, v]) => [v, k])) as Record<TemplateEvent, string>

const CANCEL_CODES: Record<string, string> = {
  'out of stock': 'out_of_stock',
  'too busy': 'too_busy',
  'customer request': 'customer_request',
  'payment issue': 'payment_issue',
}

type AddressJson = { label?: string; recipient_name?: string; street?: string; barangay?: string; city?: string; mobile_no?: string | null; notes?: string | null; removed?: boolean }

const joinStreet = (a: AddressJson) => [a.street, a.barangay, a.city].filter((x) => x && x !== '—').join(', ')

function toAddress(id: string, a: AddressJson, isDefault?: boolean): Address {
  return {
    id,
    label: (a.label as Address['label']) ?? 'Other',
    name: a.recipient_name ?? '',
    street: a.removed ? 'Address removed' : joinStreet(a),
    phone: a.mobile_no ? toIntlPhone(a.mobile_no) : '',
    notes: a.notes ?? undefined,
    isDefault,
  }
}

/** "House no., street, barangay, city" → the database's street, barangay and city (FR-CHK-02) */
export function splitStreet(line: string) {
  const parts = line.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 3) return { street: parts.slice(0, -2).join(', '), barangay: parts[parts.length - 2], city: parts[parts.length - 1] }
  if (parts.length === 2) return { street: parts[0], barangay: '—', city: parts[1] }
  return { street: line.trim(), barangay: '—', city: '—' }
}

type OrderRow = {
  order_id: string
  order_no: number
  idempotency_key: string
  customer_id: string | null
  customer_name: string
  customer_mobile: string
  fulfillment: Fulfillment
  address_id: string | null
  delivery_address: AddressJson | null
  note: string | null
  subtotal: number
  tier_discount: number
  promotion_id: string | null
  promotion_label: string | null
  promo_discount: number
  reward_name: string | null
  reward_discount: number
  delivery_fee: number
  total: number
  points_to_earn: number
  status: OrderStatus
  is_delayed: boolean
  eta: string
  source: 'app' | 'automated'
  cancelled_by: 'customer' | 'cafe' | null
  cancel_reason: string | null
  placed_at: string
  order_line: { line_id: string; item_id: string | null; item_name: string; unit_price: number; quantity: number; note: string | null; sort_order: number; order_line_option: { label: string; sort_order: number }[] }[]
  order_status_event: { to_status: OrderStatus | null; label: string; actor_name: string | null; created_at: string }[]
  payment: { payment_id: string; method: string; method_label: string; status: string; provider_ref?: string | null }[]
  customer_reward: { reward_id: string } | null
  internal_note?: { author_name: string; body: string; created_at: string }[]
}

function paymentStatus(p: OrderRow['payment'][number] | undefined): Order['paymentStatus'] {
  if (!p) return 'Not charged'
  if (p.status === 'refunded') return 'Refund started'
  if (p.status === 'failed') return 'Not charged'
  if (p.method === 'counter' && p.status === 'pending') return 'Pay at counter'
  return 'Paid'
}

function toOrder(r: OrderRow, refs: Map<string, string>): Order {
  const pay = [...(r.payment ?? [])].pop()
  return {
    id: r.order_id,
    number: r.order_no,
    attemptId: r.idempotency_key,
    customerId: r.customer_id ?? 'deleted',
    customerName: r.customer_name,
    customerPhone: toIntlPhone(r.customer_mobile),
    fulfillment: r.fulfillment,
    address: r.delivery_address ? toAddress(r.address_id ?? `order-${r.order_no}`, r.delivery_address) : undefined,
    lines: [...r.order_line]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({
        key: l.line_id,
        productId: l.item_id ?? '',
        name: l.item_name,
        options: [...l.order_line_option].sort((a, b) => a.sort_order - b.sort_order).map((o) => o.label),
        note: l.note ?? '',
        unitPrice: pesos(l.unit_price),
        qty: l.quantity,
      })),
    note: r.note ?? undefined,
    subtotal: pesos(r.subtotal),
    discount: pesos(r.tier_discount),
    offerName: r.promotion_label ?? undefined,
    offerDiscount: r.promo_discount ? pesos(r.promo_discount) : undefined,
    promoCode: r.promotion_id ?? undefined,
    rewardId: r.customer_reward?.reward_id,
    rewardName: r.reward_name ?? undefined,
    rewardDiscount: r.reward_discount ? pesos(r.reward_discount) : undefined,
    deliveryFee: pesos(r.delivery_fee),
    total: pesos(r.total),
    payment: pay?.method_label ?? COUNTER,
    paymentStatus: paymentStatus(pay),
    paymentRef: pay ? refs.get(pay.payment_id) : undefined,
    points: r.points_to_earn,
    pointsCredited: r.status === 'Completed',
    status: r.status,
    isDelayed: r.is_delayed,
    eta: Date.parse(r.eta),
    placedAt: Date.parse(r.placed_at),
    timeline: [...r.order_status_event]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((e) => ({ label: e.label, status: e.to_status ?? undefined, at: Date.parse(e.created_at), by: e.actor_name ?? '' })),
    cancelReason: r.cancel_reason ?? undefined,
    cancelledBy: r.cancelled_by ?? undefined,
    internalNotes: (r.internal_note ?? [])
      .map((n) => ({ author: n.author_name, at: Date.parse(n.created_at), text: n.body }))
      .sort((a, b) => a.at - b.at),
    source: r.source,
  }
}

function toStore(s: StoreRow): StoreSettings {
  return {
    settingsId: s.settings_id,
    cafeName: s.cafe_name,
    acceptingOrders: s.accepting_orders,
    hours: s.opening_hours,
    prepMinutes: s.default_prep_minutes,
    deliveryMinutes: s.delivery_eta_minutes,
    deliveryEnabled: s.delivery_enabled,
    deliveryFee: pesos(s.delivery_fee),
    pointsPerPeso: Number(s.points_per_peso),
    availability: Object.fromEntries(products.map((p) => [p.id, { available: p.available, reason: p.unavailableReason }])),
    chime: s.new_order_chime,
    autoAdvance: s.auto_advance_demo,
    demoMode: s.demo_mode,
  }
}

const toTier = (t: TierRow): Tier => ({
  id: t.tier_id,
  name: t.name,
  rank: t.rank,
  pct: Number(t.discount_pct),
  qualifyOrders: t.qualify_orders,
  qualifyDays: t.qualify_days,
  description: t.description ?? '',
  isDefault: t.is_default,
})

type NoteRow = { notification_id: string; title: string; body: string; deep_link: string; channel: string; read_at: string | null; created_at: string; response_template: { event: string } | null }

const ORDER_COLUMNS =
  '*, order_line(line_id, item_id, item_name, unit_price, quantity, note, sort_order, order_line_option(label, sort_order)), ' +
  'order_status_event(to_status, label, actor_name, created_at), ' +
  'payment(payment_id, method, method_label, amount, status), customer_reward(reward_id)'

/* ---------- The store ---------- */

const defaultStore = (): StoreSettings => ({
  settingsId: 1,
  cafeName: CAFE_NAME,
  acceptingOrders: true,
  hours: Array.from({ length: 7 }, () => ({ open: '07:00', close: '21:00', closed: false })),
  prepMinutes: 10,
  deliveryMinutes: DELIVERY_MINUTES,
  deliveryEnabled: true,
  deliveryFee: 25,
  pointsPerPeso: 1,
  availability: {},
  chime: true,
  autoAdvance: false,
  demoMode: true,
})

const empty = (): Shared => ({
  ready: false,
  orders: [],
  store: defaultStore(),
  tiers: [],
  customer: null,
  addresses: [],
  paymentMethods: [],
  notifications: [],
  points: 0,
  myRewards: [],
  promoUses: [],
  pointsLog: [],
  templates: defaultTemplates,
  automations: [],
  staff: { signedIn: false, name: '', role: '', fails: 0, lockedUntil: 0 },
})

const role = () => (isStaffTab() ? 'staff' : 'customer')
const CACHE = () => `megs.cache.${role()}`

let state: Shared = (() => {
  const base = empty()
  try {
    const saved = localStorage.getItem(CACHE())
    if (saved) return { ...base, ...(JSON.parse(saved) as Partial<Shared>), ready: false }
  } catch {
    /* unreadable copy */
  }
  return base
})()
let syncedAt = Date.now()
const listeners = new Set<() => void>()

function set(patch: Partial<Shared>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function applyCatalog() {
  const c = getCatalog()
  if (!c) return
  set({ store: toStore(c.store), tiers: c.tiers.map(toTier) })
}
applyCatalog()
onCatalog(applyCatalog)

export const getShared = () => state
export const lastSynced = () => syncedAt

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The whole shared store; re-renders on any change, in this tab or from the database */
export function useShared() {
  return useSyncExternalStore(subscribe, getShared)
}

function remember() {
  try {
    const { ready: _ready, ...rest } = state
    void _ready
    localStorage.setItem(CACHE(), JSON.stringify(rest))
  } catch {
    /* storage full or blocked */
  }
}

/* ---------- Loading ---------- */

async function loadCustomer(uid: string) {
  const c = db()
  const [customer, orders, points, vouchers, uses, notes, addresses, methods] = await Promise.all([
    c.from('customer').select('*').eq('customer_id', uid).maybeSingle(),
    c.from('orders').select(ORDER_COLUMNS).eq('customer_id', uid).order('placed_at', { ascending: false }),
    c.from('points_txn').select('txn_id, description, points, created_at').eq('customer_id', uid).order('created_at', { ascending: false }),
    c.from('customer_reward').select('customer_reward_id, reward_id, status, expires_on, redeemed_at').eq('customer_id', uid).order('redeemed_at', { ascending: false }),
    c.from('promotion_redemption').select('promotion_id').eq('customer_id', uid),
    c.from('notification').select('notification_id, title, body, deep_link, channel, read_at, created_at, response_template(event)').eq('customer_id', uid).order('created_at', { ascending: false }),
    c.from('address').select('*').eq('customer_id', uid).order('created_at'),
    c.from('payment_method').select('*').eq('customer_id', uid).order('created_at'),
  ])
  const failed = [customer, orders, points, vouchers, uses, notes, addresses, methods].find((r) => r.error)
  if (failed) throw failed.error
  if (!customer.data) {
    // Signed in, but not a customer account (e.g. a staff login in the customer app)
    set({ customer: null, ready: true })
    return
  }
  const k = customer.data
  const used = (uses.data ?? []).map((u: { promotion_id: string }) => u.promotion_id)
  setUsedPromotions(used)
  set({
    ready: true,
    customer: {
      id: k.customer_id,
      name: k.full_name,
      mobile: k.mobile_no,
      email: k.email ?? '',
      birthday: k.birthday ?? '',
      defaultSize: k.default_drink_size ?? '',
      tierId: k.tier_id,
      points: k.points_balance,
      notifyOrders: k.notify_order_updates,
      notifyPromotions: k.notify_promotions,
      notifyRewards: k.notify_rewards_reminders,
    },
    points: k.points_balance,
    orders: (orders.data as unknown as OrderRow[]).map((o) => toOrder(o, new Map())),
    pointsLog: (points.data ?? []).map((p: { txn_id: number; description: string; points: number; created_at: string }) => ({
      id: String(p.txn_id),
      description: p.description,
      at: Date.parse(p.created_at),
      points: p.points,
    })),
    myRewards: (vouchers.data ?? []).map((v: { customer_reward_id: string; reward_id: string; status: string; expires_on: string }) => ({
      rewardId: v.reward_id,
      voucherId: v.customer_reward_id,
      expiresOn: Date.parse(v.expires_on),
      status: v.status === 'unused' ? 'Redeemed' : v.status === 'used' ? 'Used' : 'Expired',
    })),
    promoUses: used,
    notifications: ((notes.data ?? []) as unknown as NoteRow[]).map(
      (n: { notification_id: string; title: string; body: string; deep_link: string; channel: string; read_at: string | null; created_at: string; response_template: { event: string } | null }) => ({
        id: n.notification_id,
        title: n.title,
        body: n.body,
        at: Date.parse(n.created_at),
        to: n.deep_link,
        read: !!n.read_at,
        event: n.response_template ? EVENTS[n.response_template.event] : undefined,
        push: n.channel === 'push',
      }),
    ),
    addresses: (addresses.data ?? []).map((a: AddressJson & { address_id: string; is_default: boolean }) => toAddress(a.address_id, a, a.is_default)),
    paymentMethods: (methods.data ?? []).map((m: { method_id: string; type: 'card' | 'e_wallet'; last4: string | null; wallet_name: string | null; is_default: boolean; provider_token: string }) => ({
      id: m.method_id,
      type: m.type,
      label: m.type === 'card' ? `Card ending ${m.last4}` : m.wallet_name ?? 'E-wallet',
      isDefault: m.is_default,
      token: m.provider_token,
    })),
  })
}

async function loadStaff(uid: string) {
  const c = db()
  const { data: me } = await c.from('staff_user').select('staff_id, username, full_name, role').eq('staff_id', uid).eq('is_active', true).maybeSingle()
  if (!me) {
    set({ ready: true, staff: { ...state.staff, signedIn: false, notStaff: true } })
    return
  }
  const [orders, payments, templates, automations] = await Promise.all([
    c.from('orders').select(ORDER_COLUMNS + ', internal_note(author_name, body, created_at)').order('placed_at', { ascending: false }).limit(300),
    c.rpc('staff_payments'),
    c.from('response_template').select('*').eq('audience', 'customer').order('template_id'),
    c.from('automated_order').select('*, orders:linked_order_id(order_no)').order('created_at', { ascending: false }).limit(100),
  ])
  const failed = [orders, payments, templates, automations].find((r) => r.error)
  if (failed) throw failed.error
  const refs = new Map<string, string>(((payments.data ?? []) as { payment_id: string; provider_ref: string | null }[]).map((p: { payment_id: string; provider_ref: string | null }) => [p.payment_id, p.provider_ref ?? ''] as [string, string]))
  set({
    ready: true,
    staff: { signedIn: true, id: me.staff_id, username: me.username, name: me.full_name, role: me.role === 'manager' ? 'Manager' : 'Staff', fails: 0, lockedUntil: 0 },
    orders: (orders.data as unknown as OrderRow[]).map((o) => toOrder(o, refs)),
    templates: (templates.data ?? []).map(
      (t: { event: string; name: string; title: string; channel: string; body: string; enabled: boolean; is_critical: boolean; last_edited_by_name: string | null; last_edited_at: string }) => ({
        event: EVENTS[t.event],
        name: t.name,
        title: t.title,
        channel: t.channel === 'push' ? 'push' : 'in-app',
        body: t.body,
        enabled: t.enabled,
        critical: t.is_critical,
        editedBy: t.last_edited_by_name ?? 'MEGS setup',
        editedAt: Date.parse(t.last_edited_at),
      }),
    ) as Template[],
    automations: (automations.data ?? []).map(
      (a: {
        automated_order_id: string
        created_at: string
        customer_name: string
        customer_id: string | null
        customer_mobile: string | null
        rule: string
        contents: { item_id: string; options?: string[]; quantity: number }[]
        fulfillment: Fulfillment
        state: Automation['state']
        failure_reason: string | null
        error_code: string | null
        system_response: string | null
        customer_message: string | null
        timeline: { label: string; at: string }[]
        converted_by: string | null
        orders: { order_no: number } | null
      }): Automation => ({
        id: a.automated_order_id,
        at: Date.parse(a.created_at),
        customer: a.customer_name,
        customerId: a.customer_id ?? '',
        phone: a.customer_mobile ? toIntlPhone(a.customer_mobile) : '—',
        rule: a.rule,
        lines: a.contents.map((l) => ({ productId: l.item_id, options: l.options, qty: l.quantity })),
        fulfillment: a.fulfillment,
        state: a.state,
        reason: a.failure_reason ?? undefined,
        response: a.error_code ? { code: a.error_code, message: a.system_response ?? a.error_code } : undefined,
        customerMessage: a.customer_message ?? undefined,
        orderNumber: a.orders?.order_no,
        timeline: a.timeline.map((t) => ({ label: t.label, at: Date.parse(t.at) })),
        handled: a.converted_by ? 'manual' : undefined,
      }),
    ),
  })
}

let channel: RealtimeChannel | null = null
let loadedFor: string | null = null
let loading: Promise<void> | null = null

/** Loads this tab's data for whoever is signed in (or clears it), and keeps it live */
async function load() {
  const { data } = await db().auth.getSession()
  const uid = data.session?.user.id ?? null
  if (!uid) {
    if (loadedFor !== null || !state.ready) {
      loadedFor = null
      setUsedPromotions([])
      set({ ...empty(), store: state.store, tiers: state.tiers, ready: true })
      try {
        localStorage.removeItem(CACHE())
      } catch {
        /* nothing saved */
      }
    }
    listen(null)
    return
  }
  try {
    if (role() === 'staff') await loadStaff(uid)
    else await loadCustomer(uid)
    loadedFor = uid
    syncedAt = Date.now()
    remember()
    listen(uid)
  } catch (err) {
    console.warn('MEGS: could not load', err)
    set({ ready: true })
  }
}

/** Re-reads everything (pull-to-refresh, Retry, and after every write) */
export function reloadShared() {
  loading ??= load().finally(() => {
    loading = null
  })
  return loading
}

let soon: ReturnType<typeof setTimeout> | undefined
const reloadSoon = () => {
  clearTimeout(soon)
  soon = setTimeout(() => void reloadShared(), 250)
}

/** Realtime: any change this person may see triggers a reload (RLS decides what reaches whom) */
function listen(uid: string | null) {
  const key = `${role()}:${uid ?? 'guest'}`
  if (channel && channel.topic === `realtime:megs-${key}`) return
  if (channel) void db().removeChannel(channel)
  const tables =
    uid === null
      ? ['menu_item', 'store_settings']
      : role() === 'staff'
        ? ['orders', 'order_status_event', 'internal_note', 'payment', 'automated_order', 'response_template', 'menu_item', 'store_settings']
        : ['orders', 'order_status_event', 'payment', 'notification', 'customer', 'points_txn', 'customer_reward', 'promotion_redemption', 'menu_item', 'store_settings']
  let ch = db().channel(`megs-${key}`)
  for (const table of tables) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      if (table === 'menu_item' || table === 'store_settings') void refreshCatalog()
      if (uid) reloadSoon()
    })
  }
  channel = ch.subscribe()
}

/** Start-up: load now, and again whenever this tab's sign-in changes */
export function startShared() {
  void reloadShared()
  db().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void reloadShared()
  })
  // Polling fallback (SRS 3.1.4: every 15 s if the live channel drops)
  setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) void reloadShared()
  }, 15_000)
}

/* ---------- Writes ---------- */

let failNext = false
/** Demo: makes the next write fail, to show the "Couldn't update" state (staff `?fail=1`) */
export const failNextWrite = () => {
  failNext = true
}

/** Turns a database or network error into the sentence the person sees */
function problem(error: { message?: string } | null | undefined, fallback = "Couldn't update. Try again."): Error {
  const msg = error?.message ?? ''
  // Messages raised by the database rules are written for people; anything technical gets the fallback
  return new Error(msg && !/violates|syntax|permission denied|JWT|fetch|network/i.test(msg) ? msg : fallback)
}

/** Runs one write; throws a person-readable error; reloads so every screen shows the result */
async function write(run: () => PromiseLike<{ error: { message?: string } | null; data?: unknown }>, expectRows = false) {
  if (failNext) {
    failNext = false
    throw new Error('Simulated write failure')
  }
  const { error, data } = await run()
  if (error) throw problem(error)
  if (expectRows && Array.isArray(data) && data.length === 0) throw problem(null)
  await reloadShared()
  return data
}

const orderByNumber = (n: number) => {
  const o = state.orders.find((x) => x.number === n)
  if (!o) throw new Error(`Order #${n} not found`)
  return o
}

/* ---------- Notifications from templates (staff previews) ---------- */

const template = (s: Shared, event: TemplateEvent) =>
  s.templates.find((t) => t.event === event) ?? defaultTemplates.find((t) => t.event === event)!

export const varsFor = (o: Order, extra: Vars = {}): Vars => ({
  customer_name: firstName(o.customerName),
  order_number: String(o.number),
  pickup_time: `${minutesLeft(o.eta)} min`,
  cafe_name: state.store.cafeName,
  reason: o.cancelReason?.toLowerCase(),
  ...extra,
})

/** The customer message an event sends for this order (the staff action bar previews it, FR-STF-11) */
export function messageFor(s: Shared, event: TemplateEvent, o: Order, extra: Vars = {}) {
  const t = template(s, event)
  return { title: t.title, body: fill(t.body, varsFor(o, extra)), enabled: t.enabled || t.critical, push: t.channel === 'push' }
}

export const eventFor = (o: Order, to: OrderStatus, by: 'customer' | 'cafe'): TemplateEvent => {
  switch (to) {
    case 'Received':
      return 'received'
    case 'Accepted':
      return 'accepted'
    case 'Preparing':
      return 'preparing'
    case 'Ready':
      return o.fulfillment === 'delivery' ? 'ready-delivery' : 'ready-pickup'
    case 'Completed':
      return 'completed'
    case 'Cancelled':
      return by === 'customer' ? 'cancelled-customer' : 'cancelled-cafe'
  }
}

/* ---------- Order transitions (SRS Table 3-1, FR-STF-06; enforced again by the database) ---------- */

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  Received: ['Accepted', 'Cancelled'],
  Accepted: ['Preparing', 'Cancelled'],
  Preparing: ['Ready', 'Cancelled'],
  Ready: ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
}

export function canMove(from: OrderStatus, to: OrderStatus, by: 'customer' | 'cafe') {
  if (!NEXT[from].includes(to)) return false
  if (by === 'customer') return to === 'Cancelled' && (from === 'Received' || from === 'Accepted')
  return true
}

export const nextStatuses = (from: OrderStatus) => NEXT[from]

/** What a step is called for this order ("Out for delivery" for a delivery that is Ready) */
export const stepLabel = (o: Pick<Order, 'fulfillment'>, s: OrderStatus) =>
  o.fulfillment === 'delivery' && s === 'Ready' ? 'Out for delivery' : o.fulfillment === 'delivery' && s === 'Completed' ? 'Delivered' : s

/** Moves an order on. The database stamps the time, writes the timeline, sends the customer message,
 *  credits points on Completed and refunds on Cancelled, all in the same transaction. */
export async function moveOrder(number: number, to: OrderStatus, by: 'customer' | 'cafe', opts: { reason?: string; actor?: string } = {}) {
  const o = orderByNumber(number)
  if (!canMove(o.status, to, by)) throw new Error(`Order #${number} can't go from ${o.status} to ${to}`)
  const patch: Record<string, unknown> = { status: to }
  if (to === 'Cancelled' && by === 'cafe') {
    const reason = (opts.reason ?? 'Out of stock').trim()
    const code = CANCEL_CODES[reason.toLowerCase()]
    patch.cancelled_by = 'cafe'
    patch.cancel_reason_code = code ?? 'other'
    patch.cancel_reason = reason
  }
  await write(() => db().from('orders').update(patch).eq('order_id', o.id).select('order_id'), true)
}

/** Staff can take back an Accept within 5 seconds (FR-STF-06) */
export async function undoAccept(number: number) {
  const o = orderByNumber(number)
  await write(() => db().from('orders').update({ status: 'Received' }).eq('order_id', o.id).select('order_id'), true)
}

/** FR-STF-08: only Accepted or Preparing orders can be marked delayed */
export async function markDelayed(number: number, minutes: number) {
  const o = orderByNumber(number)
  await write(
    () => db().from('orders').update({ is_delayed: true, eta: new Date(Date.now() + minutes * MIN).toISOString() }).eq('order_id', o.id).select('order_id'),
    true,
  )
}

/** FR-STF-10: internal notes, with author and time (stamped by the database), never shown to customers */
export async function addInternalNote(number: number, text: string) {
  const o = orderByNumber(number)
  await write(() => db().from('internal_note').insert({ order_id: o.id, body: text }))
}

/* ---------- Points, vouchers, notifications (customer) ---------- */

/** FR-LOY-05: points out and voucher in, in one database transaction */
export async function redeem(rewardId: string) {
  await write(() => db().rpc('redeem_reward', { p_reward_id: rewardId }))
}

export async function markNoteRead(noteId: string) {
  set({ notifications: state.notifications.map((n) => (n.id === noteId ? { ...n, read: true } : n)) })
  try {
    await write(() => db().from('notification').update({ read_at: new Date().toISOString() }).eq('notification_id', noteId))
  } catch (err) {
    console.warn('MEGS: could not mark read', err)
  }
}

/* ---------- Customer profile, preferences, addresses, payment methods (FR-PRF) ---------- */

export async function saveProfile(patch: Partial<{ full_name: string; email: string | null; birthday: string | null; default_drink_size: string | null; notify_order_updates: boolean; notify_promotions: boolean; notify_rewards_reminders: boolean }>) {
  const uid = state.customer?.id
  if (!uid) throw new Error('Log in first.')
  await write(() => db().from('customer').update(patch).eq('customer_id', uid).select('customer_id'), true)
}

export async function saveAddress(a: Address) {
  const uid = state.customer?.id
  if (!uid) throw new Error('Log in first.')
  const parts = splitStreet(a.street)
  const row = {
    customer_id: uid,
    label: a.label,
    recipient_name: a.name.trim(),
    ...parts,
    mobile_no: a.phone ? toE164(a.phone) : null,
    notes: a.notes?.trim() || null,
  }
  const exists = state.addresses.some((x) => x.id === a.id)
  const data = await write(() =>
    exists ? db().from('address').update(row).eq('address_id', a.id).select('address_id') : db().from('address').insert(row).select('address_id'),
  )
  return ((data as { address_id: string }[] | null)?.[0]?.address_id ?? a.id) as string
}

export async function addPaymentMethod(last4: string, makeDefault: boolean) {
  const uid = state.customer?.id
  if (!uid) throw new Error('Log in first.')
  // NFR-SEC-03: only a provider token and the last four digits; test tokens until a gateway is chosen
  if (makeDefault) await db().from('payment_method').update({ is_default: false }).eq('customer_id', uid).eq('is_default', true)
  await write(() =>
    db()
      .from('payment_method')
      .insert({ customer_id: uid, type: 'card', provider: 'test', provider_token: `tok_test_${last4}_${Date.now().toString(36)}`, brand: 'Card', last4, is_default: makeDefault }),
  )
}

/* ---------- Store settings and templates (staff) ---------- */

export async function setStore(change: Partial<StoreSettings> | ((s: StoreSettings) => Partial<StoreSettings>)) {
  const next = typeof change === 'function' ? change(state.store) : change
  const row: Record<string, unknown> = {}
  if (next.acceptingOrders !== undefined) row.accepting_orders = next.acceptingOrders
  if (next.hours !== undefined) row.opening_hours = next.hours
  if (next.prepMinutes !== undefined) row.default_prep_minutes = next.prepMinutes
  if (next.deliveryEnabled !== undefined) row.delivery_enabled = next.deliveryEnabled
  if (next.deliveryFee !== undefined) row.delivery_fee = Math.round(next.deliveryFee * 100)
  if (next.chime !== undefined) row.new_order_chime = next.chime
  if (next.autoAdvance !== undefined) row.auto_advance_demo = next.autoAdvance
  if (next.demoMode !== undefined) row.demo_mode = next.demoMode
  if (Object.keys(row).length) {
    await write(() => db().from('store_settings').update(row).eq('settings_id', state.store.settingsId).select('settings_id'), true)
  }
  // FR-OPS-04: sold-out toggles are menu rows
  if (next.availability) {
    for (const p of products) {
      const want = next.availability[p.id] ?? { available: true }
      if (want.available !== p.available || (!want.available && (want.reason ?? '') !== (p.unavailableReason ?? ''))) {
        await write(
          () => db().from('menu_item').update({ is_available: want.available, unavailable_reason: want.available ? null : want.reason || null }).eq('item_id', p.id).select('item_id'),
          true,
        )
      }
    }
  }
  await refreshCatalog()
}

export async function setTemplate(t: Template) {
  await write(
    () => db().from('response_template').update({ title: t.title, body: t.body, enabled: t.enabled }).eq('event', DB_EVENT[t.event]).select('template_id'),
    true,
  )
}

/* ---------- Sign-in (FR-ACC-06/07, FR-STF-01): the lockout is kept by the database ---------- */

export type LoginResult = { ok: true } | { ok: false; lockedUntil: number; left: number; notStaff?: boolean; offline?: boolean }

async function signIn(id: string, password: string, audience: 'customer' | 'staff'): Promise<LoginResult> {
  const c = db()
  const key = id.trim()
  const { data: locked, error: lockErr } = await c.rpc('login_locked_until', { p_identifier: key, p_audience: audience })
  if (lockErr) return { ok: false, lockedUntil: 0, left: LOCK_AFTER, offline: true }
  if (locked) return { ok: false, lockedUntil: Date.parse(locked as string), left: 0 }
  const { data: email } = await c.rpc(audience === 'staff' ? 'staff_login_address' : 'customer_login_address', { p_identifier: key })
  const res = email ? await c.auth.signInWithPassword({ email: email as string, password }) : null
  if (res && !res.error) {
    await c.rpc('login_succeeded', { p_identifier: key, p_audience: audience })
    return { ok: true }
  }
  const { data: f } = await c.rpc('login_failed', { p_identifier: key, p_audience: audience })
  const r = (f ?? {}) as { left?: number; locked_until?: string | null }
  return { ok: false, lockedUntil: r.locked_until ? Date.parse(r.locked_until) : 0, left: r.left ?? 0 }
}

export async function customerLogin(account: string, password: string): Promise<LoginResult> {
  const r = await signIn(account, password, 'customer')
  if (r.ok) await reloadShared()
  return r
}

export async function staffLogin(username: string, password: string): Promise<LoginResult> {
  const r = await signIn(username, password, 'staff')
  if (!r.ok) {
    set({ staff: { ...state.staff, lockedUntil: r.lockedUntil } })
    return r
  }
  await reloadShared()
  if (!state.staff.signedIn) {
    await db().auth.signOut()
    return { ok: false, lockedUntil: 0, left: LOCK_AFTER, notStaff: true }
  }
  return r
}

export async function staffLogout() {
  await db().auth.signOut()
  await reloadShared()
}

/** FR-ACC-02/03: creates the account once the (simulated) code step passes */
export async function customerSignUp(p: { name: string; phone: string; email: string; password: string }) {
  const mobile = toE164(p.phone)
  const { error } = await db().auth.signUp({
    email: loginAddress(mobile),
    password: p.password,
    options: { data: { account_type: 'customer', full_name: p.name.trim(), mobile_no: mobile, contact_email: p.email.trim(), terms_accepted: true } },
  })
  if (error) throw problem(error, /registered|exists/i.test(error.message) ? 'This number already has an account. Log in instead.' : "Couldn't create your account. Try again.")
  await reloadShared()
}

/** 3.2.1.5: a number that already has an account gets a link to Log in */
export async function isMobileRegistered(phone: string) {
  const { data } = await db().rpc('is_mobile_registered', { p_mobile: phone })
  return !!data
}

export async function customerLogout() {
  await db().auth.signOut()
  await reloadShared()
}

/* ---------- Demo tools (only while demo mode is on) ---------- */

/** ?demo=member and the screen index: signs this tab in as Maria */
export async function demoSignInCustomer() {
  if (state.customer || !state.store.demoMode) return
  await customerLogin(DEMO_CUSTOMER.mobile, DEMO_CUSTOMER.password)
}

/** The screen index's staff entries: signs the console in as the demo staff member */
export async function staffSignIn() {
  if (state.staff.signedIn || !state.store.demoMode) return
  await staffLogin(STAFF_LOGIN.username, STAFF_LOGIN.password)
}

/** Screen index: puts the demo order into a state (pickup or delivery) */
export async function demoSetOrderState(number: number, status: OrderStatus, fulfillment?: Fulfillment) {
  await write(() => db().rpc('demo_set_order_state', { p_order_no: number, p_status: status, p_fulfillment: fulfillment ?? null }))
}

/** Screen index: sets the demo customer's balance (an adjustment keeps the ledger whole) */
export async function setPoints(n: number) {
  await write(() => db().rpc('demo_set_points', { p_points: n }))
}

/** Staff console → Settings → Reset demo data: re-seeds the demo (demo-reset Edge Function) */
export async function resetDemoData() {
  const { error } = await callFunction('demo-reset', {})
  if (error) throw new Error(error.message)
  await refreshCatalog()
  await reloadShared()
}

/* ---------- Automated orders (FR-AOM-01 … 05), run by the staff-automations function ---------- */

async function automation(action: 'simulate' | 'retry' | 'convert', id?: string) {
  if (failNext) {
    failNext = false
    throw new Error('Simulated write failure')
  }
  const { error } = await callFunction('staff-automations', { action, id })
  if (error) throw new Error(error.message)
  await reloadShared()
}
export const runAutomation = (automationId: string) => automation('retry', automationId)
export const convertAutomation = (automationId: string) => automation('convert', automationId)
export const simulateAutomation = () => automation('simulate')

/* ---------- Demo auto-advance ---------- */

const AUTO_EVERY = 8000

/** When the staff "Auto-advance orders (demo)" switch is on, the open console moves every open order on a
 *  step every 8 s, as real updates the customer app follows live. Runs in the staff console only. */
export function useAutoAdvance() {
  useEffect(() => {
    const t = setInterval(() => {
      const s = getShared()
      if (!isStaffTab() || !s.staff.signedIn || !s.store.autoAdvance) return
      const now = Date.now()
      for (const o of s.orders) {
        const to = NEXT[o.status][0]
        if (!to || to === 'Cancelled') continue
        const last = o.timeline[o.timeline.length - 1]?.at ?? o.placedAt
        if (now - last < AUTO_EVERY) continue
        moveOrder(o.number, to, 'cafe').catch(() => {
          /* another console moved it first */
        })
      }
    }, 1000)
    return () => clearInterval(t)
  }, [])
}

/* ---------- Account deletion and data export (FR-ACC-11, NFR-SEC-07) ---------- */

/** Deletes the account: the cafe keeps anonymized order records (SRS 3.8) */
export async function deleteCustomerData() {
  const { error } = await callFunction('delete-account', {})
  if (error) throw new Error(error.message)
  await db().auth.signOut()
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('megs.') && k !== 'megs.onboarded' && !k.startsWith('megs.cache.catalog'))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* nothing saved */
  }
  await reloadShared()
}

/** The customer's own data, for Privacy → Download my data */
export function customerDataExport() {
  const s = state
  return {
    profile: s.customer,
    addresses: s.addresses,
    paymentMethods: s.paymentMethods.map(({ token: _token, ...m }) => {
      void _token
      return m
    }),
    points: s.points,
    pointsHistory: s.pointsLog,
    rewards: s.myRewards,
    notifications: s.notifications,
    // The customer's own orders, without anything staff-only (IR-03)
    orders: s.orders.map((o) => {
      const copy: Partial<Order> = { ...o }
      delete copy.internalNotes
      delete copy.paymentRef
      return copy
    }),
  }
}
