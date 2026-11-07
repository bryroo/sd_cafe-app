import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useLocation } from 'react-router-dom'
import { computeTotals } from '../../supabase/functions/_shared/pricing'
import { defaultOrder, productById } from '../data/menu'
import { automaticOffers, pricedCart, promoByCode, rewardById, type MyReward } from '../data/rewards'
import { callFunction } from '../lib/supabase'
import {
  COUNTER,
  addPaymentMethod as addCard,
  customerLogout,
  demoSetOrderState,
  demoSignInCustomer,
  openState,
  redeem,
  reloadShared,
  sampleLines,
  saveAddress as saveAddressRow,
  saveProfile,
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
export type PaymentMethod = { label: string; status?: string; id?: string }

/** An order as the customer sees it (staff-only fields are never loaded in the customer app) */
export type PlacedOrder = Order

/** The money in the cart, worked out once and shown the same in the cart, checkout and the order. */
export type Totals = {
  subtotal: number
  /** The applied reward: which items it made free and what it took off */
  reward: { name: string; amount: number; items: { name: string; amount: number }[] } | null
  /** The order's one promotion: a promo code if one is applied, else the best automatic offer */
  offer: { name: string; amount: number; note: string; code?: string } | null
  /** Regular discount on the subtotal, applied first and not removable (FR-CHK-05) */
  discount: number
  deliveryFee: number
  total: number
  /** Points this order earns when Completed (AS-03) */
  points: number
  /** Why an applied promo code no longer counts (the code row is dropped and a banner says why) */
  promoProblem?: string
}

/** What placing an order came back with: the order, or what the customer needs to know */
export type PlaceResult =
  | { ok: true; number: number }
  | { ok: false; code: string; message: string }

/** Tier discount on a subtotal, at the customer's tier (Regular 5% unless the cafe changes it) */
export const tierDiscount = (subtotal: number, pct = 5) => Math.round((subtotal * pct) / 100)
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
  /** Phone number: the account's when signed in, the sign-up form's while signing up */
  phone: string
  setPhone: (v: string) => void
  name: string
  setName: (v: string) => void
  email: string

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
  /** Every order this customer placed, newest first */
  myOrders: Order[]

  promoDismissed: boolean
  setPromoDismissed: (v: boolean) => void

  recentSearches: string[]
  setRecentSearches: (v: string[]) => void

  fulfillment: Fulfillment
  setFulfillment: (f: Fulfillment) => void
  addresses: Address[]
  /** Saves an address to the account; resolves to its id */
  saveAddress: (a: Address) => Promise<string>
  addressId: string
  setAddressId: (id: string) => void
  payment: string
  setPayment: (p: string) => void
  /** The tier discount is always applied (FR-CHK-05: not removable) */
  useTierDiscount: boolean
  setUseTierDiscount: (v: boolean) => void

  /** The order placed last on this phone (confirmation, tracking) */
  lastOrder: Order | null
  setLastOrderNumber: (n: number | null) => void
  /** Places the cart as an order on the server; the same attempt id never makes a second order */
  placeOrder: (note: string, attemptId: string) => Promise<PlaceResult>

  notificationsOn: boolean
  setNotificationsOn: (v: boolean) => void
  /** DPA consent for promotional messages (Privacy, Settings) — off until the customer turns it on */
  promoConsent: boolean
  setPromoConsent: (v: boolean) => void
  remindersOn: boolean
  setRemindersOn: (v: boolean) => void

  paymentMethods: PaymentMethod[]
  addPaymentMethod: (m: PaymentMethod, makeDefault: boolean) => Promise<void>

  points: number
  setPoints: (n: number) => void
  myRewards: MyReward[]
  redeemReward: (rewardId: string, cost: number) => Promise<void>
  /** The redeemed reward chosen for this order (Discounts and rewards sheet) */
  appliedReward: string | null
  setAppliedReward: (id: string | null) => void
  /** The promo code applied to this order */
  appliedPromo: string | null
  setAppliedPromo: (code: string | null) => void
  promoUses: string[]
  totals: Totals
  /** The customer's tier name and discount (FR-TIR) */
  tierName: string
  tierPct: number

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
  /** Prototype helper: make the demo order #1042 this phone's last order, in this state. */
  seedDemoOrder: (f: Fulfillment, status?: OrderStatus) => void
}

const Ctx = createContext<AppState | null>(null)

/* ----- What stays on the phone: the cart (FR-CRT-09), choices in progress, UI preferences ----- */

const STORE = 'megs.'
// Prototype-only: ?demo=member or ?demo=cart signs in as the demo customer (and fills the sample cart)
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

/** Clears what this device saved (cart, choices, cached data) and starts again. Server data is untouched. */
export function resetDemo() {
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(STORE))
      .forEach((k) => window.localStorage.removeItem(k))
  } catch {
    /* nothing saved */
  }
  void customerLogout().finally(() => {
    window.location.replace(window.location.pathname + '#/')
    window.location.reload()
  })
}

const warn = (what: string) => (err: unknown) => console.warn(`MEGS: could not ${what}`, err)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const shared = useShared()
  const { customer } = shared
  const member = !!customer
  // Guest or signed out, while no account is signed in
  const [visitor, setVisitor] = usePersisted<'signed-out' | 'guest'>('session', 'signed-out')
  const session: Session = member ? 'member' : visitor
  const [firstLaunch, setFirstLaunch] = usePersisted('firstLaunch', false)
  // Sign-up form values until the account exists
  const [draftPhone, setDraftPhone] = useState('')
  const [draftName, setDraftName] = useState('')
  const [cart, setCart] = usePersisted<CartLine[]>('cart', demo === 'cart' ? sampleLines : [])
  // The member's cart while they're logged out, so logging back in picks the order up where they left it
  const [savedCart, setSavedCart] = usePersisted<CartLine[]>('savedCart', [])
  const [promoDismissed, setPromoDismissed] = usePersisted('promoDismissed', false)
  const [recentSearches, setRecentSearches] = usePersisted('recentSearches', ['Spanish Latte', 'Matcha', 'Carbonara', 'Hot Chocolate'])
  const [fulfillment, setFulfillment] = usePersisted<Fulfillment>('fulfillment', 'pickup')
  const [addressId, setAddressId] = usePersisted('addressId', '')
  const [payment, setPayment] = usePersisted('payment', COUNTER)
  const [lastOrderNumber, setLastOrderNumber] = usePersisted<number | null>('lastOrderNumber', null)
  const [appliedReward, setAppliedReward] = usePersisted<string | null>('appliedReward', null)
  const [appliedPromo, setAppliedPromo] = usePersisted<string | null>('appliedPromo', null)

  // ?demo=member / ?demo=cart: sign in as the demo customer
  useEffect(() => {
    if (demo && !member && shared.ready) void demoSignInCustomer()
  }, [member, shared.ready])

  const { store, orders, points, myRewards, promoUses, addresses } = shared
  // `?closed=1` shows the closed state for the screen index without touching the cafe's settings
  const previewClosed = new URLSearchParams(useLocation().search).get('closed') === '1'
  const open = useMemo(
    () => openState(previewClosed ? { ...store, hours: store.hours.map((h) => ({ ...h, closed: true })) } : store),
    [store, previewClosed],
  )

  const paymentMethods = useMemo<PaymentMethod[]>(
    () => [
      ...shared.paymentMethods.map((m) => ({
        id: m.id,
        label: m.label,
        // README test cards: 0002 always declines; 0119 fails once after payment
        status: m.token.startsWith('tok_test_0002')
          ? 'Test · declines'
          : m.token.startsWith('tok_test_0119')
            ? 'Test · order fails once'
            : m.isDefault
              ? 'Default'
              : m.type === 'e_wallet'
                ? 'Linked'
                : undefined,
      })),
      { label: COUNTER },
    ],
    [shared.paymentMethods],
  )

  // The default address is preselected for delivery
  useEffect(() => {
    if (addresses.length && !addresses.some((a) => a.id === addressId)) setAddressId((addresses.find((a) => a.isDefault) ?? addresses[0]).id)
  }, [addresses, addressId, setAddressId])

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

  const tier = shared.tiers.find((t) => t.id === customer?.tierId) ?? shared.tiers.find((t) => t.isDefault)

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

    // SRS AS-05 / FR-CHK-04 through the shared pricing engine (the same code the server charges with):
    // the tier discount first, then one promotion, then one reward.
    const usable = appliedReward && myRewards.some((m) => m.rewardId === appliedReward && m.status === 'Redeemed')
    const def = usable && member ? rewardById(appliedReward!) : undefined
    const promo = member ? promoByCode(appliedPromo) : null
    const lines = pricedCart(cart)
    const t = computeTotals({
      lines,
      member,
      tier: tier ? { name: tier.name, pct: tier.pct } : null,
      offers: automaticOffers(),
      usedOfferIds: promoUses,
      isFirstOrder: member && !orders.some((o) => o.status !== 'Cancelled'),
      promo,
      reward: def ? { id: def.id, name: def.name, slots: def.slots } : null,
      fulfillment,
      deliveryFee: store.deliveryFee,
      pointsPerPeso: store.pointsPerPeso,
      now: Date.now(),
    })
    const totals: Totals = {
      subtotal: t.subtotal,
      discount: t.discount,
      reward: t.reward,
      offer: t.offer,
      deliveryFee: t.deliveryFee,
      total: t.total,
      points: t.points,
      promoProblem: appliedPromo && member && !promo ? `${appliedPromo} was removed: open Discounts to apply it again.` : t.promoProblem,
    }

    const mine = [...orders].sort((a, b) => b.placedAt - a.placedAt)
    const lastOrder = mine.find((o) => o.number === lastOrderNumber) ?? null

    const placeOrder: AppState['placeOrder'] = async (note, attemptId) => {
      const method = paymentMethods.find((m) => m.label === payment)
      const voucher = def ? myRewards.find((m) => m.rewardId === def.id && m.status === 'Redeemed')?.voucherId : undefined
      const { data, error } = await callFunction<{ order: { number: number } }>('place-order', {
        idempotencyKey: attemptId,
        lines: cart.map((l) => ({ key: l.key, itemId: l.productId, options: l.options, qty: l.qty, note: l.note })),
        fulfillment,
        addressId: fulfillment === 'delivery' ? addressId : null,
        note: note.trim(),
        payment: payment === COUNTER || !method?.id ? 'counter' : method.id,
        promoCode: t.offer?.code ?? null,
        customerRewardId: t.reward ? voucher ?? null : null,
        expectedTotal: t.total,
      })
      if (error) return { ok: false, code: error.code, message: error.message }
      const number = data.order.number
      if (t.reward) setAppliedReward(null)
      if (t.offer?.code) setAppliedPromo(null)
      setLastOrderNumber(number)
      setCart([])
      setFirstLaunch(false)
      await reloadShared()
      return { ok: true, number }
    }

    // Logging out keeps the member's cart for this account (not for a guest using the phone);
    // logging back in brings it back, unless they've started a new cart since.
    const changeSession = (next: Session) => {
      if (next === 'signed-out' && member) {
        if (cart.length) setSavedCart(cart)
        setCart([])
        setVisitor('signed-out')
        void customerLogout()
        return
      }
      if (next === 'member') {
        // Sign-in itself happens on Log in / Verification; the screen index signs in as the demo customer
        if (!member) void demoSignInCustomer()
        if (savedCart.length) {
          setCart((prev) => (prev.length ? prev : savedCart))
          setSavedCart([])
        }
        return
      }
      setVisitor(next)
    }

    const setProfile = (patch: Parameters<typeof saveProfile>[0]) => void saveProfile(patch).catch(warn('save your profile'))

    return {
      session,
      setSession: changeSession,
      firstLaunch,
      setFirstLaunch,
      phone: customer ? toIntlPhone(customer.mobile) : draftPhone,
      setPhone: setDraftPhone,
      name: customer?.name ?? draftName,
      setName: (v) => (member ? setProfile({ full_name: v }) : setDraftName(v)),
      email: customer?.email ?? '',
      cart,
      cartCount: cart.reduce((n, l) => n + l.qty, 0),
      cartTotal: t.subtotal,
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
      saveAddress: async (a) => {
        const id = await saveAddressRow(a)
        return id
      },
      addressId,
      setAddressId,
      payment,
      setPayment,
      useTierDiscount: true,
      setUseTierDiscount: () => {},
      lastOrder,
      setLastOrderNumber,
      placeOrder,
      notificationsOn: customer?.notifyOrders ?? false,
      setNotificationsOn: (v) => setProfile({ notify_order_updates: v }),
      promoConsent: customer?.notifyPromotions ?? false,
      setPromoConsent: (v) => setProfile({ notify_promotions: v }),
      remindersOn: customer?.notifyRewards ?? true,
      setRemindersOn: (v) => setProfile({ notify_rewards_reminders: v }),
      paymentMethods,
      addPaymentMethod: async (m, makeDefault) => {
        const last4 = m.label.replace(/\D/g, '').slice(-4)
        await addCard(last4, makeDefault)
      },
      points,
      setPoints: (n) => void setPoints(n).catch(warn('set points')),
      myRewards,
      appliedReward,
      setAppliedReward,
      appliedPromo,
      setAppliedPromo,
      promoUses,
      totals,
      tierName: tier?.name ?? 'Regular',
      tierPct: tier?.pct ?? 5,
      redeemReward: (rewardId) => redeem(rewardId),
      defaultSize: customer?.defaultSize ?? '',
      setDefaultSize: (s) => setProfile({ default_drink_size: s || null }),
      open,
      deliveryEnabled: store.deliveryEnabled,
      deliveryFee: store.deliveryFee,
      prepMinutes: store.prepMinutes,
      seedCart: () => setCart(sampleLines),
      seedDemoOrder: (f, status = 'Preparing') => {
        // The demo order #1042 in the shared queue, in the state a screen-index frame needs
        void demoSetOrderState(1042, status, f).catch(warn('set the demo order'))
        setLastOrderNumber(1042)
      },
    }
  }, [
    store,
    orders,
    points,
    myRewards,
    promoUses,
    addresses,
    open,
    paymentMethods,
    appliedReward,
    appliedPromo,
    session,
    member,
    customer,
    tier,
    firstLaunch,
    draftPhone,
    draftName,
    cart,
    savedCart,
    promoDismissed,
    recentSearches,
    fulfillment,
    addressId,
    payment,
    lastOrderNumber,
    setVisitor,
    setFirstLaunch,
    setCart,
    setSavedCart,
    setPromoDismissed,
    setRecentSearches,
    setFulfillment,
    setAddressId,
    setPayment,
    setLastOrderNumber,
    setAppliedReward,
    setAppliedPromo,
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
