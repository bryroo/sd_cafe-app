import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useLocation } from 'react-router-dom'
import { defaultOrder, productById } from '../data/menu'
import { bestOffer, checkPromo, rewardById, rewardSavings, type MyReward } from '../data/rewards'
import {
  COUNTER,
  CUSTOMER_ID,
  createOrder,
  notesMatching,
  openState,
  quietly,
  redeem,
  sampleLines,
  setPoints,
  toIntlPhone,
  useShared,
  type Address,
  type CartLine,
  type Fulfillment,
  type OpenState,
  type Order,
  type OrderStatus,
} from './shared'

export type { Address, CartLine, Fulfillment } from './shared'
export { COUNTER, sampleLines } from './shared'

export type Session = 'signed-out' | 'guest' | 'member'

/** Lines with the same item, options and note share a key and stack their quantities. */
const lineKey = (l: Omit<CartLine, 'key'>) => [l.productId, ...l.options, l.note].join('|')

/** C-31 Payment Methods row: label + status ("Default", "Linked"). */
export type PaymentMethod = { label: string; status?: string }

/** An order as the customer sees it (staff-only fields are never rendered in the customer app) */
export type PlacedOrder = Order

/** The money in the cart, worked out once and shown the same in the cart, checkout and the order. */
export type Totals = {
  subtotal: number
  /** The applied reward: which items it made free and what it took off */
  reward: { name: string; amount: number; items: { name: string; amount: number }[] } | null
  /** The order's one promotion: a promo code if one is applied, else the best automatic offer */
  offer: { name: string; amount: number; note: string; code?: string } | null
  /** Regular 5% discount on the subtotal, applied first */
  discount: number
  deliveryFee: number
  total: number
  /** Why an applied promo code no longer counts (the code row is dropped and a banner says why) */
  promoProblem?: string
}

/** Regular-tier discount: 5% of subtotal. */
export const tierDiscount = (subtotal: number) => Math.round(subtotal * 0.05)
/** Spend this much to unlock a free drink (cart nudge). */
export const FREE_DRINK_THRESHOLD = 500
/** Drink sizes a customer can save as their default (FR-CRT-05) */
export const DRINK_SIZES = ['Cold · 16 oz', 'Cold · 22 oz', 'Hot · 12 oz']

type AppState = {
  session: Session
  setSession: (s: Session) => void
  /** Set after sign up so Home shows its "First launch" state once. */
  firstLaunch: boolean
  setFirstLaunch: (v: boolean) => void
  /** Phone number captured at sign up, shown on the verification screen. */
  phone: string
  setPhone: (v: string) => void
  name: string
  setName: (v: string) => void

  cart: CartLine[]
  cartCount: number
  cartTotal: number
  addToCart: (line: Omit<CartLine, 'key'>) => void
  /** Replaces the line with this key (cart Edit). Merges into a matching line if the edit makes them identical. */
  updateLine: (key: string, line: Omit<CartLine, 'key'>) => void
  setQty: (key: string, qty: number) => void
  clearCart: () => void
  /** Cart lines whose item has since been marked sold out: checkout waits until they are removed */
  unavailableLines: CartLine[]

  /** This customer's orders that are still in progress, newest first */
  activeOrders: Order[]
  /** Every order this customer placed in the app, newest first */
  myOrders: Order[]

  promoDismissed: boolean
  setPromoDismissed: (v: boolean) => void

  recentSearches: string[]
  setRecentSearches: (v: string[]) => void

  fulfillment: Fulfillment
  setFulfillment: (f: Fulfillment) => void
  addresses: Address[]
  saveAddress: (a: Address) => void
  addressId: string
  setAddressId: (id: string) => void
  payment: string
  setPayment: (p: string) => void
  /** Whether the Regular tier discount is applied at checkout. */
  useTierDiscount: boolean
  setUseTierDiscount: (v: boolean) => void

  /** The order placed last on this phone (confirmation, tracking) */
  lastOrder: Order | null
  setLastOrderNumber: (n: number | null) => void
  /** Places the cart as an order; the same attempt id never makes a second order */
  placeOrder: (note: string, attemptId: string) => Order

  notificationsOn: boolean
  setNotificationsOn: (v: boolean) => void
  /** DPA consent for promotional messages (Privacy, Settings) — off until the customer turns it on */
  promoConsent: boolean
  setPromoConsent: (v: boolean) => void
  remindersOn: boolean
  setRemindersOn: (v: boolean) => void

  paymentMethods: PaymentMethod[]
  addPaymentMethod: (m: PaymentMethod, makeDefault: boolean) => void

  points: number
  setPoints: (n: number) => void
  myRewards: MyReward[]
  redeemReward: (rewardId: string, cost: number) => void
  /** The redeemed reward chosen for this order (Discounts and rewards sheet) */
  appliedReward: string | null
  setAppliedReward: (id: string | null) => void
  /** The promo code applied to this order */
  appliedPromo: string | null
  setAppliedPromo: (code: string | null) => void
  promoUses: string[]
  totals: Totals

  /** Saved default drink size, preselected on product pages (FR-CRT-05) */
  defaultSize: string
  setDefaultSize: (s: string) => void

  /** Whether the cafe takes orders right now (FR-CHK-11) */
  open: OpenState
  deliveryEnabled: boolean
  deliveryFee: number
  prepMinutes: number

  /** Prototype helper: fill the cart with the 3 items shown in the Figma checkout frames. */
  seedCart: () => void
  /** Prototype helper: make the sample order #1042 this phone's last order, in this state. */
  seedDemoOrder: (f: Fulfillment, status?: OrderStatus) => void
}

const Ctx = createContext<AppState | null>(null)

/* ----- Saved between visits (the demo has no backend, so the phone keeps its own state) ----- */

const STORE = 'megs.'
// Prototype-only: ?demo=member or ?demo=cart starts signed in (and with the sample cart) so a
// screen can be opened straight from a URL for review and screenshots. Those visits start fresh.
const demo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('demo') : null

function usePersisted<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (!demo) {
      try {
        const raw = window.localStorage.getItem(STORE + key)
        if (raw !== null) return JSON.parse(raw) as T
      } catch {
        /* storage blocked (private window): start from the defaults */
      }
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(STORE + key, JSON.stringify(value))
    } catch {
      /* storage full or blocked: the session still works, it just won't be remembered */
    }
  }, [key, value])
  return [value, setValue]
}

/** Clears everything the demo saved on this device — customer, staff, store and orders — and starts again. */
export function resetDemo() {
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(STORE))
      .forEach((k) => window.localStorage.removeItem(k))
  } catch {
    /* nothing saved */
  }
  window.location.replace(window.location.pathname + '#/')
  window.location.reload()
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const shared = useShared()
  const [session, setSession] = usePersisted<Session>('session', demo ? 'member' : 'signed-out')
  const [firstLaunch, setFirstLaunch] = usePersisted('firstLaunch', false)
  const [phone, setPhone] = usePersisted('phone', '0917 123 4567')
  const [name, setName] = usePersisted('name', 'Maria Santos')
  const [cart, setCart] = usePersisted<CartLine[]>('cart', demo === 'cart' ? sampleLines : [])
  // The member's cart while they're logged out, so logging back in picks the order up where they left it
  const [savedCart, setSavedCart] = usePersisted<CartLine[]>('savedCart', [])
  const [promoDismissed, setPromoDismissed] = usePersisted('promoDismissed', false)
  const [recentSearches, setRecentSearches] = usePersisted('recentSearches', ['Spanish Latte', 'Matcha', 'Carbonara', 'Hot Chocolate'])
  const [fulfillment, setFulfillment] = usePersisted<Fulfillment>('fulfillment', 'pickup')
  const [addresses, setAddresses] = usePersisted<Address[]>('addresses', [
    {
      id: 'home',
      label: 'Home',
      name: 'Maria Santos',
      street: '12 Mabini St, Brgy. San Roque, Quezon City',
      phone: '+63 917 123 4567',
      notes: 'Leave at the door',
      isDefault: true,
    },
    {
      id: 'work',
      label: 'Work',
      name: 'Maria Santos',
      street: 'Unit 8B, Greenfield Tower, Mandaluyong City',
      phone: '+63 917 123 4567',
    },
  ])
  const [addressId, setAddressId] = usePersisted('addressId', 'home')
  const [payment, setPayment] = usePersisted('payment', 'Pay at counter')
  const [useTierDiscount, setUseTierDiscount] = usePersisted('useTierDiscount', true)
  const [lastOrderNumber, setLastOrderNumber] = usePersisted<number | null>('lastOrderNumber', 1042)
  const [notificationsOn, setNotificationsOn] = usePersisted('notificationsOn', false)
  const [promoConsent, setPromoConsent] = usePersisted('promoConsent', false)
  const [remindersOn, setRemindersOn] = usePersisted('remindersOn', true)
  const [paymentMethods, setPaymentMethods] = usePersisted<PaymentMethod[]>('paymentMethods', [
    { label: 'Card ending 4242', status: 'Default' },
    // Test cards for the error states (see the README): 0002 always declines, 0119 fails once after payment
    { label: 'Card ending 0002', status: 'Test · declines' },
    { label: 'Card ending 0119', status: 'Test · order fails once' },
    { label: 'E-wallet', status: 'Linked' },
    { label: 'Pay at counter' },
  ])
  const [appliedReward, setAppliedReward] = usePersisted<string | null>('appliedReward', null)
  const [appliedPromo, setAppliedPromo] = usePersisted<string | null>('appliedPromo', null)
  const [defaultSize, setDefaultSize] = usePersisted('defaultSize', '')

  const { store, orders, points, myRewards, promoUses } = shared
  // `?closed=1` shows the closed state for the screen index without touching the cafe's settings
  const previewClosed = new URLSearchParams(useLocation().search).get('closed') === '1'
  const open = useMemo(
    () => openState(previewClosed ? { ...store, hours: store.hours.map((h) => ({ ...h, closed: true })) } : store),
    [store, previewClosed],
  )

  // Delivery can't be paid at the counter: move to the first other method
  useEffect(() => {
    if (fulfillment === 'delivery' && payment === COUNTER) {
      setPayment(paymentMethods.find((m) => m.label !== COUNTER)?.label ?? COUNTER)
    }
  }, [fulfillment, payment, paymentMethods, setPayment])

  // FR-OPS-05: when the cafe turns delivery off, a delivery cart becomes pickup
  useEffect(() => {
    if (!store.deliveryEnabled && fulfillment === 'delivery') setFulfillment('pickup')
  }, [store.deliveryEnabled, fulfillment, setFulfillment])

  const value = useMemo<AppState>(() => {
    const addToCart: AppState['addToCart'] = (line) =>
      setCart((prev) => {
        const key = lineKey(line)
        const existing = prev.find((l) => l.key === key)
        if (existing) return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + line.qty } : l))
        return [...prev, { ...line, key }]
      })

    const updateLine: AppState['updateLine'] = (oldKey, line) =>
      setCart((prev) => {
        const key = lineKey(line)
        const twin = key !== oldKey && prev.find((l) => l.key === key)
        if (twin) {
          return prev
            .filter((l) => l.key !== oldKey)
            .map((l) => (l.key === key ? { ...l, qty: l.qty + line.qty } : l))
        }
        return prev.map((l) => (l.key === oldKey ? { ...line, key } : l))
      })

    const member = session === 'member'
    const subtotal = cart.reduce((n, l) => n + l.qty * l.unitPrice, 0)

    // SRS AS-05 / FR-CHK-04: the tier discount first (on the subtotal), then one promotion, then one
    // reward. A promo code is the order's promotion when applied; otherwise the best automatic offer.
    // The reward makes its item(s) free; the offer skips units the reward already covers.
    const discount = useTierDiscount && member ? tierDiscount(subtotal) : 0
    const usable = appliedReward && myRewards.some((m) => m.rewardId === appliedReward && m.status === 'Redeemed')
    const def = usable && member ? rewardById(appliedReward!) : undefined
    const saved = def ? rewardSavings(def, cart) : null
    const reward = def && saved?.applies ? { name: def.name, amount: saved.amount, items: saved.items } : null
    let offer: Totals['offer'] = null
    let promoProblem: string | undefined
    if (appliedPromo && member && cart.length) {
      const check = checkPromo(appliedPromo, subtotal, subtotal - discount, promoUses)
      if (check.ok) offer = { name: check.promo.label, amount: check.amount, note: `${check.promo.percent}% off`, code: check.promo.code }
      else promoProblem = `${appliedPromo} was removed: ${check.error}`
    }
    if (!offer) {
      const best = bestOffer(cart, reward?.items.map((i) => i.key) ?? [])
      offer = best ? { name: best.promo.title, amount: best.amount, note: best.note } : null
    }
    const deliveryFee = fulfillment === 'delivery' ? store.deliveryFee : 0
    const total = Math.max(0, subtotal - discount - (offer?.amount ?? 0) - (reward?.amount ?? 0)) + deliveryFee
    const totals: Totals = { subtotal, reward, offer, discount, deliveryFee, total, promoProblem }

    const mine = orders.filter((o) => o.customerId === CUSTOMER_ID).sort((a, b) => b.placedAt - a.placedAt)
    const lastOrder = mine.find((o) => o.number === lastOrderNumber) ?? null

    const placeOrder: AppState['placeOrder'] = (note, attemptId) => {
      const order = createOrder(
        {
          customerId: CUSTOMER_ID,
          customerName: name,
          customerPhone: toIntlPhone(phone),
          fulfillment,
          address: fulfillment === 'delivery' ? addresses.find((a) => a.id === addressId) : undefined,
          lines: cart,
          note: note.trim() || undefined,
          subtotal,
          discount,
          deliveryFee,
          total,
          payment,
          points: Math.floor(total), // SRS AS-03: 1 pt per ₱1 paid, credited on Completed
          rewardId: reward ? appliedReward! : undefined,
          rewardName: reward?.name,
          rewardDiscount: reward?.amount,
          offerName: offer?.name,
          offerDiscount: offer?.amount,
          promoCode: offer?.code,
          source: 'app',
        },
        attemptId,
      )
      if (reward) setAppliedReward(null)
      if (offer?.code) setAppliedPromo(null)
      setLastOrderNumber(order.number)
      setCart([])
      setFirstLaunch(false)
      return order
    }

    // Logging out keeps the member's cart for this account (not for a guest using the phone);
    // logging back in brings it back, unless they've started a new cart since.
    const changeSession = (next: Session) => {
      if (next === 'signed-out' && session === 'member') {
        if (cart.length) setSavedCart(cart)
        setCart([])
      }
      if (next === 'member' && session !== 'member' && savedCart.length) {
        setCart((prev) => (prev.length ? prev : savedCart))
        setSavedCart([])
      }
      setSession(next)
    }

    return {
      session,
      setSession: changeSession,
      firstLaunch,
      setFirstLaunch,
      phone,
      setPhone,
      name,
      setName,
      cart,
      cartCount: cart.reduce((n, l) => n + l.qty, 0),
      cartTotal: subtotal,
      addToCart,
      updateLine,
      setQty: (key, qty) =>
        setCart((prev) =>
          qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, qty } : l)),
        ),
      clearCart: () => setCart([]),
      unavailableLines: cart.filter((l) => !productById(l.productId)?.available),
      activeOrders: mine.filter((o) => o.status !== 'Completed' && o.status !== 'Cancelled'),
      myOrders: mine,
      promoDismissed,
      setPromoDismissed,
      recentSearches,
      setRecentSearches,
      fulfillment,
      setFulfillment,
      addresses,
      saveAddress: (a) =>
        setAddresses((prev) => (prev.some((x) => x.id === a.id) ? prev.map((x) => (x.id === a.id ? a : x)) : [...prev, a])),
      addressId,
      setAddressId,
      payment,
      setPayment,
      useTierDiscount,
      setUseTierDiscount,
      lastOrder,
      setLastOrderNumber,
      placeOrder,
      notificationsOn,
      setNotificationsOn,
      promoConsent,
      setPromoConsent,
      remindersOn,
      setRemindersOn,
      paymentMethods,
      addPaymentMethod: (m, makeDefault) =>
        setPaymentMethods((prev) => {
          const rest = makeDefault
            ? prev.map((p) => (p.status === 'Default' ? { ...p, status: undefined } : p))
            : prev
          const card = { ...m, status: makeDefault ? 'Default' : m.status }
          // Cards first, "Pay at counter" stays last.
          return [card, ...rest.filter((p) => p.label !== m.label)]
        }),
      points,
      setPoints: (n) => setPoints(n),
      myRewards,
      appliedReward,
      setAppliedReward,
      appliedPromo,
      setAppliedPromo,
      promoUses,
      totals,
      redeemReward: (rewardId, cost) => redeem(rewardId, cost, rewardById(rewardId)?.name ?? 'Reward'),
      defaultSize,
      setDefaultSize,
      open,
      deliveryEnabled: store.deliveryEnabled,
      deliveryFee: store.deliveryFee,
      prepMinutes: store.prepMinutes,
      seedCart: () => setCart(sampleLines),
      seedDemoOrder: (f, status = 'Preparing') => {
        // The sample order #1042 in the shared queue, in the shape a screen-index frame needs
        quietly((s) => {
          const o = s.orders.find((x) => x.number === 1042)
          if (!o) return {}
          const fee = f === 'delivery' ? s.store.deliveryFee : 0
          const next: Order = {
            ...o,
            customerId: CUSTOMER_ID,
            fulfillment: f,
            address: f === 'delivery' ? addresses[0] : undefined,
            deliveryFee: fee,
            total: o.subtotal - o.discount + fee,
            status,
            isDelayed: false,
            cancelReason: status === 'Cancelled' ? 'Out of stock' : undefined,
            cancelledBy: status === 'Cancelled' ? 'cafe' : undefined,
          }
          return {
            orders: s.orders.map((x) => (x.number === 1042 ? next : x)),
            notifications: notesMatching(s.notifications, 1042, status),
          }
        })
        setLastOrderNumber(1042)
      },
    }
  }, [
    store,
    orders,
    points,
    myRewards,
    promoUses,
    open,
    paymentMethods,
    appliedReward,
    appliedPromo,
    notificationsOn,
    promoConsent,
    remindersOn,
    session,
    firstLaunch,
    phone,
    name,
    cart,
    savedCart,
    promoDismissed,
    recentSearches,
    fulfillment,
    addresses,
    addressId,
    payment,
    useTierDiscount,
    lastOrderNumber,
    defaultSize,
    setSession,
    setFirstLaunch,
    setPhone,
    setName,
    setCart,
    setSavedCart,
    setPromoDismissed,
    setRecentSearches,
    setFulfillment,
    setAddresses,
    setAddressId,
    setPayment,
    setUseTierDiscount,
    setLastOrderNumber,
    setNotificationsOn,
    setPromoConsent,
    setRemindersOn,
    setPaymentMethods,
    setAppliedReward,
    setAppliedPromo,
    setDefaultSize,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider')
  return ctx
}

/** Default configuration used by quick add (+) buttons. */
export function quickAddLine(productId: string): Omit<CartLine, 'key'> {
  return { ...defaultOrder(productId), note: '', qty: 1 }
}

/** "0917 123 4567" → "+63 917 123 4567" */
export const toIntl = toIntlPhone

