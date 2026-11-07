// The shared store: what the customer app and the staff console both read and write.
// Orders, store settings, the customer's notifications, points and vouchers, response templates,
// automated orders and the staff sign-in all live here, saved in localStorage under `megs.` and kept
// in step across tabs (the `storage` event plus a BroadcastChannel). There is no backend: in the full
// system each write below is a server call.
import { useEffect, useSyncExternalStore } from 'react'
import { applyAvailability, defaultOrder, priceFor, productById } from '../data/menu'
import { featuredPromotion, type MyReward } from '../data/rewards'
import { defaultTemplates, fill, type Template, type TemplateEvent, type Vars } from '../data/templates'
import { seedAutomations, simulatedRules, type Automation } from '../data/automations'

/* ---------- Types ---------- */

export type CartLine = {
  key: string
  productId: string
  /** Chosen options, e.g. ["Cold · 16 oz", "100%", "Oat milk"] */
  options: string[]
  note: string
  unitPrice: number
  qty: number
}

export type Address = {
  id: string
  label: 'Home' | 'Work' | 'Other'
  name: string
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
  number: number
  /** Same id on a retried submission: never a second order (SRS NFR-REL-01, IR-08) */
  attemptId?: string
  customerId: string
  customerName: string
  customerPhone: string
  fulfillment: Fulfillment
  address?: Address
  lines: CartLine[]
  /** Note for the cafe */
  note?: string
  subtotal: number
  /** Tier discount */
  discount: number
  /** The order's one promotion: an automatic offer or a promo code */
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
  paymentRef?: string
  /** Points this order earns when Completed (AS-03: 1 pt per ₱1 paid) */
  points: number
  pointsCredited?: boolean
  status: OrderStatus
  isDelayed?: boolean
  /** When it should be ready (pickup) or arrive (delivery) */
  eta: number
  placedAt: number
  timeline: TimelineEvent[]
  cancelReason?: string
  cancelledBy?: 'customer' | 'cafe'
  /** Staff only: never shown in the customer app (IR-03) */
  internalNotes: InternalNote[]
  source: 'app' | 'automated'
}

export type Hours = { open: string; close: string; closed: boolean }

export type StoreSettings = {
  acceptingOrders: boolean
  /** Opening hours per weekday, Sunday first, Asia/Manila time */
  hours: Hours[]
  /** Default preparation time: the pickup ETA (FR-OPS-03) */
  prepMinutes: number
  deliveryEnabled: boolean
  deliveryFee: number
  /** Staff overrides over the menu sheet (FR-OPS-04) */
  availability: Record<string, { available: boolean; reason?: string }>
  /** New-order chime in the staff console */
  chime: boolean
  /** Demo only: the cafe moves every order on by itself every 8 s */
  autoAdvance: boolean
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
  name: string
  role: string
  fails: number
  lockedUntil: number
}

export type LoginAttempts = Record<string, { fails: number; lockedUntil: number }>

type Shared = {
  orders: Order[]
  store: StoreSettings
  notifications: CustomerNote[]
  points: number
  myRewards: MyReward[]
  /** Promo codes this customer has used (one use each) */
  promoUses: string[]
  /** Points credited or spent in the app, newest first (shown above the sample history) */
  pointsLog: PointsEntry[]
  templates: Template[]
  automations: Automation[]
  staff: StaffState
  loginAttempts: LoginAttempts
}

/* ---------- Constants and helpers ---------- */

/** The one customer this demo signs in as */
export const CUSTOMER_ID = 'demo-customer'
export const CAFE_NAME = "MEGS' Cafe"
export const COUNTER = 'Pay at counter'
export const MIN = 60_000
/** Delivery takes about this long on top of nothing: the delivery ETA */
export const DELIVERY_MINUTES = 35
export const STAFF_LOGIN = { username: 'staff', password: 'megs2026' }
export const LOCK_AFTER = 5
export const LOCK_MINUTES = 15

const PREFIX = 'megs.'

const line = (productId: string, options?: string[], qty = 1, note = ''): CartLine => {
  const base = defaultOrder(productId)
  const opts = options ?? base.options
  return {
    key: [productId, ...opts, note].join('|'),
    productId,
    options: opts,
    note,
    unitPrice: priceFor(productId, opts) ?? base.unitPrice,
    qty,
  }
}

/** The demo cart for the checkout screens (₱480 subtotal), priced from the menu boards:
 *  Caramel Macchiato cold 22 oz ₱140 · Carbonara ₱180 · Spanish Latte cold 16 oz ₱110 + oat milk ₱50. */
export const sampleLines: CartLine[] = [
  { key: 'sample-1', productId: 'caramel-macchiato', options: ['Cold · 22 oz', 'Regular milk'], note: '', unitPrice: 140, qty: 1 },
  { key: 'sample-2', productId: 'carbonara', options: [], note: '', unitPrice: 180, qty: 1 },
  { key: 'sample-3', productId: 'spanish-latte', options: ['Cold · 16 oz', 'Oat milk'], note: 'less ice', unitPrice: 160, qty: 1 },
]

const sum = (lines: CartLine[]) => lines.reduce((n, l) => n + l.unitPrice * l.qty, 0)
/** '0917 123 4567' → '+63 917 123 4567' */
export function toIntlPhone(phone: string) {
  const digits = phone.replace(/\D/g, '').replace(/^(63|0)/, '')
  if (digits.length !== 10) return phone
  return `+63 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there'
const id = () => Math.random().toString(36).slice(2, 10)

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
  const h = store.hours[day]
  const today = h.closed ? 'Closed today' : `Today ${hourLabel(h.open)} – ${hourLabel(h.close)}`
  const inHours = !h.closed && minutes >= toMinutes(h.open) && minutes < toMinutes(h.close)
  if (store.acceptingOrders && inHours) return { open: true, today }
  let next: string | undefined
  if (!h.closed && minutes < toMinutes(h.open)) next = `Opens today at ${hourLabel(h.open)}`
  else
    for (let i = 1; i <= 7; i++) {
      const d = store.hours[(day + i) % 7]
      if (d.closed) continue
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

/* ---------- Defaults ---------- */

const defaultStore = (): StoreSettings => ({
  acceptingOrders: true,
  hours: Array.from({ length: 7 }, () => ({ open: '07:00', close: '21:00', closed: false })),
  prepMinutes: 10,
  deliveryEnabled: true,
  deliveryFee: 25,
  availability: {},
  chime: true,
  autoAdvance: false,
})

const ev = (label: string, at: number, by: string, status?: OrderStatus): TimelineEvent => ({ label, status, at, by })

/** The queue the demo opens with: Maria's sample order #1042 plus a few other customers' orders */
function seedOrders(now: number): Order[] {
  const ago = (m: number) => now - m * MIN
  const order = (
    o: Partial<Order> & Pick<Order, 'number' | 'customerId' | 'customerName' | 'customerPhone' | 'lines' | 'status' | 'placedAt'>,
  ): Order => {
    const subtotal = sum(o.lines)
    const fulfillment = o.fulfillment ?? 'pickup'
    const deliveryFee = fulfillment === 'delivery' ? 25 : 0
    const discount = o.discount ?? 0
    const total = subtotal - discount + deliveryFee
    const payment = o.payment ?? COUNTER
    return {
      fulfillment,
      deliveryFee,
      discount,
      subtotal,
      total,
      payment,
      paymentStatus: payment === COUNTER ? 'Pay at counter' : 'Paid',
      paymentRef: payment === COUNTER ? undefined : `PAY-${o.number}-4F2A`,
      points: Math.floor(total),
      eta: o.placedAt + (fulfillment === 'delivery' ? DELIVERY_MINUTES : 10) * MIN,
      timeline: [ev('Order placed', o.placedAt, o.customerName, 'Received')],
      internalNotes: [],
      source: 'app',
      ...o,
    }
  }
  return [
    order({
      number: 1042,
      customerId: CUSTOMER_ID,
      customerName: 'Maria Santos',
      customerPhone: '+63 917 123 4567',
      lines: sampleLines,
      discount: 24,
      status: 'Preparing',
      placedAt: ago(6),
      timeline: [
        ev('Order placed', ago(6), 'Maria Santos', 'Received'),
        ev('Accepted', ago(5), 'Staff', 'Accepted'),
        ev('Preparing', ago(3), 'Staff', 'Preparing'),
      ],
    }),
    order({
      number: 1041,
      customerId: 'ana',
      customerName: 'Ana Cruz',
      customerPhone: '+63 917 555 0123',
      lines: [line('latte', ['Hot · 12 oz'])],
      payment: 'Saved card',
      status: 'Ready',
      placedAt: ago(15),
      source: 'automated',
      timeline: [
        ev('Order placed by recurring order', ago(15), 'System', 'Received'),
        ev('Accepted', ago(14), 'Staff', 'Accepted'),
        ev('Preparing', ago(12), 'Staff', 'Preparing'),
        ev('Ready', ago(3), 'Staff', 'Ready'),
      ],
    }),
    order({
      number: 1040,
      customerId: 'jen',
      customerName: 'Jen Dizon',
      customerPhone: '+63 927 555 0198',
      lines: [line('choco-lava', ['Cold · 22 oz']), line('potato-fries-plain')],
      status: 'Received',
      placedAt: ago(12),
    }),
    order({
      number: 1039,
      customerId: 'leo',
      customerName: 'Leo Tan',
      customerPhone: '+63 919 555 0177',
      fulfillment: 'delivery',
      address: {
        id: 'leo-work',
        label: 'Work',
        name: 'Leo Tan',
        street: '21F Greenfield Tower, Mandaluyong City',
        phone: '+63 919 555 0177',
      },
      lines: [line('carbonara', undefined, 2), line('nachos')],
      payment: 'Saved card',
      status: 'Completed',
      placedAt: ago(35),
      source: 'automated',
      pointsCredited: true,
      timeline: [
        ev('Order placed by office pre-order', ago(35), 'System', 'Received'),
        ev('Accepted', ago(34), 'Staff', 'Accepted'),
        ev('Preparing', ago(30), 'Staff', 'Preparing'),
        ev('Out for delivery', ago(20), 'Staff', 'Ready'),
        ev('Delivered', ago(5), 'Staff', 'Completed'),
      ],
    }),
  ]
}

function seedNotes(now: number): CustomerNote[] {
  return [
    {
      id: 'seed-points',
      title: 'You earned 120 points',
      body: 'Thanks for ordering. Points added to your balance.',
      at: now - 60 * MIN,
      to: '/rewards/activity',
      read: false,
    },
    {
      id: 'seed-promo',
      title: featuredPromotion?.title ?? 'New offers this week',
      body: 'Ends 30 Nov. Tap to see the offer.',
      at: now - 26 * 60 * MIN,
      to: featuredPromotion ? `/promotions/${featuredPromotion.id}` : '/promotions',
      read: true,
    },
    {
      id: 'seed-1038',
      title: 'Order #1038 completed',
      body: 'Rate your order or order it again.',
      at: now - 20 * 24 * 60 * MIN,
      to: '/orders/1038',
      read: true,
    },
  ]
}

const defaults = (now = Date.now()): Shared => ({
  orders: seedOrders(now),
  store: defaultStore(),
  notifications: seedNotes(now),
  points: 1240,
  myRewards: [
    { rewardId: 'free-drink', status: 'Redeemed' },
    { rewardId: 'free-pastry', status: 'Expired' },
  ],
  promoUses: [],
  pointsLog: [],
  templates: defaultTemplates,
  automations: seedAutomations(now),
  staff: { signedIn: false, name: 'Rina Bautista', role: 'Shift lead', fails: 0, lockedUntil: 0 },
  loginAttempts: {},
})

/* ---------- Load, save, subscribe ---------- */

const KEYS = Object.keys(defaults()) as (keyof Shared)[]

function load(): Shared {
  const base = defaults()
  const out = { ...base }
  for (const k of KEYS) {
    try {
      const raw = window.localStorage.getItem(PREFIX + k)
      if (raw !== null) (out as Record<string, unknown>)[k] = JSON.parse(raw)
    } catch {
      /* blocked or unreadable: the default stands */
    }
  }
  // Settings saved by an older build may lack newer fields
  out.store = { ...base.store, ...out.store }
  out.staff = { ...base.staff, ...out.staff }
  return out
}

let state: Shared = load()
let syncedAt = Date.now()
const listeners = new Set<() => void>()

function emit() {
  applyAvailability(state.store.availability)
  listeners.forEach((l) => l())
}
applyAvailability(state.store.availability)

// The first visit saves the seeded queue, so the staff tab and the customer tab start from the same orders
try {
  for (const k of KEYS)
    if (window.localStorage.getItem(PREFIX + k) === null) window.localStorage.setItem(PREFIX + k, JSON.stringify(state[k]))
} catch {
  /* storage blocked: each tab keeps its own copy */
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('megs') : null

/** Re-reads everything from storage (another tab wrote, or pull-to-refresh) */
export function reloadShared() {
  state = load()
  syncedAt = Date.now()
  emit()
}

channel?.addEventListener('message', reloadShared)
window.addEventListener('storage', (e) => {
  if (e.key === null || e.key.startsWith(PREFIX)) reloadShared()
})

export const getShared = () => state
export const lastSynced = () => syncedAt

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The whole shared store; re-renders on any change, in this tab or another */
export function useShared() {
  return useSyncExternalStore(subscribe, getShared)
}

let failNext = false
/** Demo: makes the next write fail, to show the "Couldn't update" state (staff `?fail=1`) */
export const failNextWrite = () => {
  failNext = true
}

/**
 * Applies a change on top of the latest saved copy and saves it. Throws when the write fails;
 * nothing is changed then. One call is one "transaction": every key it returns is written together.
 */
export function update(change: (s: Shared) => Partial<Shared>) {
  const fresh = load()
  const patch = change(fresh)
  if (failNext) {
    failNext = false
    throw new Error('Simulated write failure')
  }
  const written: (keyof Shared)[] = []
  try {
    for (const k of Object.keys(patch) as (keyof Shared)[]) {
      window.localStorage.setItem(PREFIX + k, JSON.stringify(patch[k]))
      written.push(k)
    }
  } catch (err) {
    // Roll back what was written, so a failure leaves no partial change (NFR-REL-02)
    for (const k of written) {
      try {
        window.localStorage.setItem(PREFIX + k, JSON.stringify(fresh[k]))
      } catch {
        /* nothing more to do */
      }
    }
    throw err
  }
  state = { ...fresh, ...patch }
  syncedAt = Date.now()
  channel?.postMessage('changed')
  emit()
}

/** For writes the customer app makes in passing: a failure is logged, not thrown at the screen */
export function quietly(change: (s: Shared) => Partial<Shared>) {
  try {
    update(change)
    return true
  } catch (err) {
    console.warn('MEGS: could not save', err)
    return false
  }
}

/* ---------- Notifications from templates ---------- */

const template = (s: Shared, event: TemplateEvent) =>
  s.templates.find((t) => t.event === event) ?? defaultTemplates.find((t) => t.event === event)!

export const varsFor = (o: Order, extra: Vars = {}): Vars => ({
  customer_name: firstName(o.customerName),
  order_number: String(o.number),
  pickup_time: `${minutesLeft(o.eta)} min`,
  cafe_name: CAFE_NAME,
  reason: o.cancelReason?.toLowerCase(),
  ...extra,
})

/** The customer message an event sends for this order (the staff action bar previews it) */
export function messageFor(s: Shared, event: TemplateEvent, o: Order, extra: Vars = {}) {
  const t = template(s, event)
  return { title: t.title, body: fill(t.body, varsFor(o, extra)), enabled: t.enabled || t.critical, push: t.channel === 'push' }
}

/** Adds the customer's notification for an order event (only for this demo's customer) */
function notify(s: Shared, event: TemplateEvent, o: Order, extra: Vars = {}): CustomerNote[] {
  if (o.customerId !== CUSTOMER_ID) return s.notifications
  const m = messageFor(s, event, o, extra)
  if (!m.enabled) return s.notifications
  const note: CustomerNote = {
    id: `${o.number}-${event}-${id()}`,
    title: m.title,
    body: m.body,
    at: Date.now(),
    to: `/orders/tracking?n=${o.number}`,
    read: false,
    event,
    push: m.push,
  }
  return [note, ...s.notifications]
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

/** How far along an order must be for a status message about it to still be true */
const EVENT_STAGE: Partial<Record<TemplateEvent, OrderStatus>> = {
  accepted: 'Accepted',
  preparing: 'Preparing',
  'ready-pickup': 'Ready',
  'ready-delivery': 'Ready',
  completed: 'Completed',
}
const STAGES: OrderStatus[] = ['Received', 'Accepted', 'Preparing', 'Ready', 'Completed']

/**
 * Drops this order's status notifications that are ahead of where the order is now (or that say it was
 * cancelled when it isn't), e.g. after the demo order is set back to Preparing. A "Ready for pickup"
 * message must never open an order that is still being prepared.
 */
export function notesMatching(notes: CustomerNote[], number: number, status: OrderStatus): CustomerNote[] {
  const at = STAGES.indexOf(status)
  return notes.filter((n) => {
    if (!n.event || !n.to.endsWith(`n=${number}`)) return true
    if (n.event === 'cancelled-cafe' || n.event === 'cancelled-customer') return status === 'Cancelled'
    const needs = EVENT_STAGE[n.event]
    if (!needs) return true
    return status !== 'Cancelled' && at >= STAGES.indexOf(needs)
  })
}

/* ---------- Order transitions (SRS Table 3-1, FR-STF-06) ---------- */

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  Received: ['Accepted', 'Cancelled'],
  Accepted: ['Preparing', 'Cancelled'],
  Preparing: ['Ready', 'Cancelled'],
  Ready: ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
}

/** The one place the rules live: anything else is rejected */
export function canMove(from: OrderStatus, to: OrderStatus, by: 'customer' | 'cafe') {
  if (!NEXT[from].includes(to)) return false
  // FR-TRK-04 / IR-02: a customer may only cancel, and only while Received or Accepted
  if (by === 'customer') return to === 'Cancelled' && (from === 'Received' || from === 'Accepted')
  return true
}

export const nextStatuses = (from: OrderStatus) => NEXT[from]

/** What a step is called for this order ("Out for delivery" for a delivery that is Ready) */
export const stepLabel = (o: Pick<Order, 'fulfillment'>, s: OrderStatus) =>
  o.fulfillment === 'delivery' && s === 'Ready' ? 'Out for delivery' : o.fulfillment === 'delivery' && s === 'Completed' ? 'Delivered' : s

export function moveOrder(number: number, to: OrderStatus, by: 'customer' | 'cafe', opts: { reason?: string; actor?: string } = {}) {
  update((s) => {
    const o = s.orders.find((x) => x.number === number)
    if (!o) throw new Error(`Order #${number} not found`)
    if (!canMove(o.status, to, by)) throw new Error(`Order #${number} can't go from ${o.status} to ${to}`)
    const now = Date.now()
    const actor = opts.actor ?? (by === 'customer' ? o.customerName : 'Staff')
    const next: Order = {
      ...o,
      status: to,
      // The Delayed flag clears when the status advances
      isDelayed: false,
      timeline: [...o.timeline, ev(to === 'Cancelled' ? `Cancelled by ${by === 'customer' ? 'customer' : 'cafe'}` : stepLabel(o, to), now, actor, to)],
    }
    const patch: Partial<Shared> = {}
    if (to === 'Accepted') next.eta = Math.max(o.eta, now + (o.fulfillment === 'delivery' ? DELIVERY_MINUTES : s.store.prepMinutes) * MIN)
    if (to === 'Cancelled') {
      next.cancelledBy = by
      next.cancelReason = opts.reason ?? (by === 'customer' ? 'Customer request' : 'Cancelled by the cafe')
      // FR-TRK-05: an in-app payment is refunded; the voucher and the promo code go back
      if (o.paymentStatus === 'Paid') next.paymentStatus = 'Refund started'
      if (o.paymentStatus === 'Pay at counter') next.paymentStatus = 'Not charged'
      if (o.rewardId && o.customerId === CUSTOMER_ID)
        patch.myRewards = s.myRewards.map((m) => (m.rewardId === o.rewardId && m.status === 'Used' ? { ...m, status: 'Redeemed' } : m))
      if (o.promoCode && o.customerId === CUSTOMER_ID) {
        const i = s.promoUses.indexOf(o.promoCode)
        if (i >= 0) patch.promoUses = s.promoUses.filter((_, j) => j !== i)
      }
    }
    // FR-LOY-01 / IR-05: points are credited in the same write that completes the order, once
    if (to === 'Completed') {
      if (o.paymentStatus === 'Pay at counter') next.paymentStatus = 'Paid'
      if (!o.pointsCredited && o.customerId === CUSTOMER_ID) {
        patch.points = s.points + o.points
        patch.pointsLog = [{ id: `order-${o.number}`, description: `Order #${o.number}`, at: now, points: o.points }, ...s.pointsLog]
      }
      next.pointsCredited = true
    }
    patch.orders = s.orders.map((x) => (x.number === number ? next : x))
    patch.notifications = notify(s, eventFor(o, to, by), next)
    return patch
  })
}

/** Staff can take back an Accept within 5 seconds (FR-STF-06) */
export function undoAccept(number: number) {
  update((s) => {
    const o = s.orders.find((x) => x.number === number)
    if (!o || o.status !== 'Accepted') throw new Error('Nothing to undo')
    const timeline = o.timeline.slice(0, -1)
    return {
      orders: s.orders.map((x) => (x.number === number ? { ...o, status: 'Received', timeline } : x)),
      notifications: s.notifications.filter((n) => !(n.event === 'accepted' && n.to.endsWith(`n=${number}`))),
    }
  })
}

/** FR-STF-08: only Accepted or Preparing orders can be marked delayed */
export function markDelayed(number: number, minutes: number, actor = 'Staff') {
  update((s) => {
    const o = s.orders.find((x) => x.number === number)
    if (!o || (o.status !== 'Accepted' && o.status !== 'Preparing')) throw new Error('Only Accepted or Preparing orders can be delayed')
    const now = Date.now()
    const next: Order = {
      ...o,
      isDelayed: true,
      eta: now + minutes * MIN,
      timeline: [...o.timeline, ev(`Delayed: new estimate ${minutes} min`, now, actor)],
    }
    return {
      orders: s.orders.map((x) => (x.number === number ? next : x)),
      notifications: notify(s, 'delayed', next),
    }
  })
}

/** FR-STF-10: internal notes, with author and time, never shown to customers */
export function addInternalNote(number: number, text: string, author: string) {
  update((s) => ({
    orders: s.orders.map((x) =>
      x.number === number ? { ...x, internalNotes: [...x.internalNotes, { author, at: Date.now(), text }] } : x,
    ),
  }))
}

/* ---------- Placing orders ---------- */

export type NewOrder = Omit<
  Order,
  'number' | 'status' | 'placedAt' | 'timeline' | 'internalNotes' | 'eta' | 'paymentStatus' | 'paymentRef' | 'pointsCredited'
>

const nextNumber = (s: Shared) => Math.max(1042, ...s.orders.map((o) => o.number)) + 1

function build(s: Shared, input: NewOrder, now: number, by: string): Order {
  const number = nextNumber(s)
  const paid = input.payment !== COUNTER
  return {
    ...input,
    number,
    status: 'Received',
    placedAt: now,
    eta: now + (input.fulfillment === 'delivery' ? DELIVERY_MINUTES : s.store.prepMinutes) * MIN,
    paymentStatus: paid ? 'Paid' : 'Pay at counter',
    paymentRef: paid ? `PAY-${number}-${id().slice(0, 4).toUpperCase()}` : undefined,
    timeline: [ev(input.source === 'automated' ? 'Order placed by automation' : 'Order placed', now, by, 'Received')],
    internalNotes: [],
  }
}

/**
 * Places an order. A retried submission with the same attempt id returns the order it already
 * made instead of creating a second one (NFR-REL-01, IR-08). Marks the reward voucher and the
 * promo code as used in the same write.
 */
export function createOrder(input: NewOrder, attemptId?: string): Order {
  const existing = attemptId ? getShared().orders.find((o) => o.attemptId === attemptId) : undefined
  if (existing) return existing
  let made: Order | undefined
  update((s) => {
    const again = attemptId ? s.orders.find((o) => o.attemptId === attemptId) : undefined
    if (again) {
      made = again
      return {}
    }
    const o = { ...build(s, input, Date.now(), input.customerName), attemptId }
    made = o
    const patch: Partial<Shared> = { orders: [...s.orders, o], notifications: notify(s, 'received', o) }
    if (o.rewardId) patch.myRewards = s.myRewards.map((m) => (m.rewardId === o.rewardId && m.status === 'Redeemed' ? { ...m, status: 'Used' } : m))
    if (o.promoCode) patch.promoUses = [...s.promoUses, o.promoCode]
    return patch
  })
  return made!
}

/* ---------- Points and vouchers ---------- */

export function setPoints(n: number | ((p: number) => number)) {
  quietly((s) => ({ points: typeof n === 'function' ? n(s.points) : n }))
}

export function setMyRewards(m: MyReward[] | ((p: MyReward[]) => MyReward[])) {
  quietly((s) => ({ myRewards: typeof m === 'function' ? m(s.myRewards) : m }))
}

/** FR-LOY-05: points out and voucher in, in one write */
export function redeem(rewardId: string, cost: number, name: string) {
  quietly((s) => ({
    points: s.points - cost,
    myRewards: [{ rewardId, status: 'Redeemed' }, ...s.myRewards.filter((r) => r.rewardId !== rewardId)],
    pointsLog: [{ id: `redeem-${id()}`, description: name, at: Date.now(), points: -cost }, ...s.pointsLog],
  }))
}

/* ---------- Notifications (customer) ---------- */

export function markNoteRead(noteId: string) {
  quietly((s) => ({ notifications: s.notifications.map((n) => (n.id === noteId ? { ...n, read: true } : n)) }))
}

/* ---------- Store settings ---------- */

export function setStore(change: Partial<StoreSettings> | ((s: StoreSettings) => Partial<StoreSettings>)) {
  update((s) => ({ store: { ...s.store, ...(typeof change === 'function' ? change(s.store) : change) } }))
}

export function setTemplate(t: Template) {
  update((s) => ({ templates: s.templates.map((x) => (x.event === t.event ? t : x)) }))
}

/* ---------- Staff sign-in (FR-STF-01) ---------- */

export type LoginResult = { ok: true } | { ok: false; lockedUntil: number; left: number }

export function staffLogin(username: string, password: string): LoginResult {
  const s = getShared().staff
  const now = Date.now()
  if (s.lockedUntil > now) return { ok: false, lockedUntil: s.lockedUntil, left: 0 }
  const ok = [STAFF_LOGIN.username, 'staff@megscafe.ph'].includes(username.trim().toLowerCase()) && password === STAFF_LOGIN.password
  if (ok) {
    quietly((x) => ({ staff: { ...x.staff, signedIn: true, fails: 0, lockedUntil: 0 } }))
    return { ok: true }
  }
  const fails = (s.lockedUntil && s.lockedUntil <= now ? 0 : s.fails) + 1
  const lockedUntil = fails >= LOCK_AFTER ? now + LOCK_MINUTES * MIN : 0
  quietly((x) => ({ staff: { ...x.staff, fails: lockedUntil ? 0 : fails, lockedUntil } }))
  return { ok: false, lockedUntil, left: LOCK_AFTER - fails }
}

export const staffLogout = () => quietly((s) => ({ staff: { ...s.staff, signedIn: false } }))
export const staffSignIn = () => quietly((s) => ({ staff: { ...s.staff, signedIn: true, lockedUntil: 0, fails: 0 } }))

/* ---------- Customer sign-in lockout (FR-ACC-07) ---------- */

export const CUSTOMER_PASSWORD = 'password1'

export function customerLogin(account: string, password: string): LoginResult {
  const key = account.trim().toLowerCase()
  const now = Date.now()
  const a = getShared().loginAttempts[key] ?? { fails: 0, lockedUntil: 0 }
  if (a.lockedUntil > now) return { ok: false, lockedUntil: a.lockedUntil, left: 0 }
  if (password === CUSTOMER_PASSWORD) {
    quietly((s) => ({ loginAttempts: { ...s.loginAttempts, [key]: { fails: 0, lockedUntil: 0 } } }))
    return { ok: true }
  }
  const fails = (a.lockedUntil && a.lockedUntil <= now ? 0 : a.fails) + 1
  const lockedUntil = fails >= LOCK_AFTER ? now + LOCK_MINUTES * MIN : 0
  quietly((s) => ({ loginAttempts: { ...s.loginAttempts, [key]: { fails: lockedUntil ? 0 : fails, lockedUntil } } }))
  return { ok: false, lockedUntil, left: LOCK_AFTER - fails }
}

/* ---------- Automated orders (FR-AOM-01 … 05) ---------- */

const automationOrder = (s: Shared, a: Automation): NewOrder => {
  const lines = a.lines.map((l) => line(l.productId, l.options, l.qty))
  const subtotal = sum(lines)
  const deliveryFee = a.fulfillment === 'delivery' ? s.store.deliveryFee : 0
  return {
    customerId: a.customerId,
    customerName: a.customer,
    customerPhone: a.phone,
    fulfillment: a.fulfillment,
    lines,
    subtotal,
    discount: 0,
    deliveryFee,
    total: subtotal + deliveryFee,
    payment: 'Saved card',
    points: Math.floor(subtotal + deliveryFee),
    source: 'automated',
  }
}

/** What stops an automated order right now, if anything */
function blocker(s: Shared, a: Automation): { code: string; message: string; reason: string } | null {
  const os = openState(s.store)
  if (!os.open) return { code: 'STORE_CLOSED', message: 'STORE_CLOSED: not accepting orders', reason: 'The cafe is not accepting orders' }
  const out = a.lines.map((l) => productById(l.productId)).find((p) => !p || !p.available)
  if (out !== undefined)
    return { code: 'ITEM_UNAVAILABLE', message: `ITEM_UNAVAILABLE: ${out?.name ?? 'unknown item'}`, reason: `${out?.name ?? 'An item'} is sold out` }
  return null
}

/** Runs the automation's checks again: on success it places a real order in the queue */
export function runAutomation(automationId: string, label = 'Retried by staff') {
  update((s) => {
    const a = s.automations.find((x) => x.id === automationId)
    if (!a) throw new Error('Automation not found')
    const now = Date.now()
    const stop = blocker(s, a)
    if (stop) {
      const failed: Automation = {
        ...a,
        state: 'failed',
        reason: stop.reason,
        response: { code: stop.code, message: stop.message },
        timeline: [...a.timeline, { label, at: now }, { label: `Failed: ${stop.reason.toLowerCase()}`, at: now }],
      }
      return { automations: s.automations.map((x) => (x.id === a.id ? failed : x)) }
    }
    const o = build(s, automationOrder(s, a), now, 'Automation')
    const done: Automation = {
      ...a,
      state: 'succeeded',
      orderNumber: o.number,
      customerMessage: `Your ${a.rule.toLowerCase()} #${o.number} is in.`,
      timeline: [...a.timeline, { label, at: now }, { label: `Order #${o.number} created`, at: now }],
    }
    return {
      orders: [...s.orders, o],
      automations: s.automations.map((x) => (x.id === a.id ? done : x)),
      notifications: notify(s, 'received', o),
    }
  })
}

/** Convert to manual: staff take the order themselves, past the failed check */
export function convertAutomation(automationId: string, actor: string) {
  update((s) => {
    const a = s.automations.find((x) => x.id === automationId)
    if (!a) throw new Error('Automation not found')
    const now = Date.now()
    const o = build(s, automationOrder(s, a), now, actor)
    o.timeline[0] = ev('Order placed manually from a failed automation', now, actor, 'Received')
    const done: Automation = {
      ...a,
      handled: 'manual',
      orderNumber: o.number,
      timeline: [...a.timeline, { label: `Converted to manual order #${o.number} by ${actor}`, at: now }],
    }
    return { orders: [...s.orders, o], automations: s.automations.map((x) => (x.id === a.id ? done : x)) }
  })
}

let simCount = 0
/** Demo: a standing rule fires now; it processes for a moment, then succeeds or fails on the live checks */
export function simulateAutomation() {
  const rule = simulatedRules[simCount++ % simulatedRules.length]
  const now = Date.now()
  const a: Automation = { ...rule, id: `auto-${id()}`, at: now, state: 'processing', timeline: [{ label: 'Rule fired', at: now }] }
  update((s) => ({ automations: [a, ...s.automations] }))
  setTimeout(() => tryRun(a.id), 2500)
}
const tryRun = (automationId: string) => {
  try {
    runAutomation(automationId, 'Checks run')
  } catch (err) {
    console.warn('MEGS: automation run failed', err)
  }
}

/* ---------- Demo auto-advance ---------- */

const AUTO_EVERY = 8000

/** When the staff "Auto-advance orders (demo)" switch is on, every open order moves on a step every 8 s.
 *  Mounted in both apps; each step is re-checked against the saved copy, so two tabs don't double-step. */
export function useAutoAdvance() {
  useEffect(() => {
    const t = setInterval(() => {
      const s = getShared()
      if (!s.store.autoAdvance) return
      const now = Date.now()
      for (const o of s.orders) {
        const to = NEXT[o.status][0]
        if (!to || to === 'Cancelled') continue
        const last = o.timeline[o.timeline.length - 1]?.at ?? o.placedAt
        if (now - last < AUTO_EVERY) continue
        try {
          const fresh = load().orders.find((x) => x.number === o.number)
          if (fresh?.status !== o.status) continue
          moveOrder(o.number, to, 'cafe', { actor: 'Demo auto-advance' })
        } catch {
          /* another tab moved it first */
        }
      }
    }, 1000)
    return () => clearInterval(t)
  }, [])
}

/* ---------- Reset and delete ---------- */

/** Keys that belong to the cafe, not the customer: kept when the customer deletes their account */
const CAFE_KEYS: (keyof Shared)[] = ['orders', 'store', 'templates', 'automations', 'staff']

export function deleteCustomerData() {
  try {
    // Onboarding was seen on this phone, so a deleted account lands on Welcome, not the slides
    const keep = new Set([...CAFE_KEYS.map((k) => PREFIX + k), PREFIX + 'onboarded'])
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX) && !keep.has(k))
      .forEach((k) => window.localStorage.removeItem(k))
    // An empty account, not the demo's sample points, vouchers and notifications
    const empty: Partial<Shared> = { points: 0, myRewards: [], promoUses: [], pointsLog: [], notifications: [], loginAttempts: {} }
    for (const [k, v] of Object.entries(empty)) window.localStorage.setItem(PREFIX + k, JSON.stringify(v))
    // The cafe keeps its order records, with the customer's name, phone and address taken off
    const orders = load().orders.map((o) =>
      o.customerId === CUSTOMER_ID
        ? { ...o, customerId: 'deleted', customerName: 'Deleted customer', customerPhone: '—', address: undefined }
        : o,
    )
    window.localStorage.setItem(PREFIX + 'orders', JSON.stringify(orders))
    window.localStorage.setItem(PREFIX + 'lastOrderNumber', 'null')
  } catch {
    /* nothing saved */
  }
}

/** The customer's saved data, for Privacy → Download my data */
export function customerDataExport() {
  const out: Record<string, unknown> = {}
  const cafe = new Set(CAFE_KEYS.map((k) => PREFIX + k))
  try {
    for (const k of Object.keys(window.localStorage).sort()) {
      if (!k.startsWith(PREFIX) || cafe.has(k)) continue
      const raw = window.localStorage.getItem(k)
      try {
        out[k.slice(PREFIX.length)] = raw === null ? null : JSON.parse(raw)
      } catch {
        out[k.slice(PREFIX.length)] = raw
      }
    }
  } catch {
    /* storage blocked */
  }
  // The customer's own orders, without the cafe's internal notes (IR-03)
  out.orders = state.orders
    .filter((o) => o.customerId === CUSTOMER_ID)
    .map((o) => {
      const copy: Partial<Order> = { ...o }
      delete copy.internalNotes
      return copy
    })
  return out
}
