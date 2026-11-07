// MEGS' Cafe pricing engine (SRS 3.4.6 PricingEngine). Pure TypeScript with no imports, shared by the app
// (instant cart and checkout totals) and the Edge Functions (the price actually charged). Everything it
// knows comes in as data: the menu, the customer's tier, published offers, a promo code, a voucher.
//
// Amounts are in pesos, as the app shows them; offer rules store centavos (SRS 3.8) and are converted here.
// Order of discounts (FR-CHK-04, AS-05): tier discount on the subtotal, then one promotion (a promo code
// if applied, else the best automatic offer), then one reward voucher, then the delivery fee.

/* ---------- Menu ---------- */

export type Choice = {
  valueId?: number
  label: string
  /** Pesos. A delta for ordinary options; the item's full price in that size for a Size group. */
  price: number
  available: boolean
  isDefault: boolean
  badge?: string
}

export type Group = {
  code: string
  title: string
  required: boolean
  pick: 'one' | 'many'
  /** A Size group: its choices carry the item's full price per size (SRS 1.3 "Size") */
  isSize: boolean
  choices: Choice[]
}

export type Item = {
  id: string
  name: string
  kind: 'drink' | 'food'
  /** The menu board it's printed on (menu_category) */
  category: string
  /** Single-price items; null when priced by size */
  price: number | null
  available: boolean
  active: boolean
  groups: Group[]
}

/* ---------- Cart ---------- */

export type LineIn = { key: string; itemId: string; options: string[]; qty: number; note?: string }

export type ChosenOption = { valueId?: number; groupTitle: string; label: string; price: number }

export type PricedLine = LineIn & {
  name: string
  kind: 'drink' | 'food'
  category: string
  unitPrice: number
  chosen: ChosenOption[]
}

export type LineResult = { ok: true; line: PricedLine } | { ok: false; error: string }

/** FR-CRT-02 / FR-CRT-03 / FR-CRT-04: validates a line against its item and prices one unit */
export function priceLine(item: Item | undefined, line: LineIn): LineResult {
  if (!item || !item.active) return { ok: false, error: 'This item is no longer on the menu.' }
  if (!item.available) return { ok: false, error: `${item.name} is sold out.` }
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 20) return { ok: false, error: 'Quantity must be between 1 and 20.' }
  if ((line.note ?? '').length > 140) return { ok: false, error: 'Special instructions are limited to 140 characters.' }

  const chosen: ChosenOption[] = []
  let base = item.price
  const left = [...line.options]
  for (const g of item.groups) {
    const picks = g.choices.filter((c) => left.includes(c.label))
    for (const c of picks) left.splice(left.indexOf(c.label), 1)
    if (g.pick === 'one' && picks.length > 1) return { ok: false, error: `Choose one ${g.title.toLowerCase()}.` }
    if (g.required && picks.length === 0) return { ok: false, error: `Choose a ${g.title.toLowerCase()} for ${item.name}.` }
    for (const c of picks) {
      if (!c.available) return { ok: false, error: `${c.label} isn't available right now.` }
      if (g.isSize) base = c.price
      chosen.push({ valueId: c.valueId, groupTitle: g.title, label: c.label, price: g.isSize ? c.price : c.price })
    }
  }
  if (left.length) return { ok: false, error: `${left[0]} isn't an option for ${item.name}.` }
  if (base === null) return { ok: false, error: `Choose a size for ${item.name}.` }
  const extras = chosen.filter((c) => !item.groups.find((g) => g.isSize && g.title === c.groupTitle)).reduce((s, c) => s + c.price, 0)
  return {
    ok: true,
    line: { ...line, name: item.name, kind: item.kind, category: item.category, unitPrice: base + extras, chosen },
  }
}

/** The item as it comes by default: each pick-one group's default (else the cheapest), no add-ons */
export function defaultOptions(item: Item): string[] {
  return item.groups
    .filter((g) => g.pick === 'one')
    .map((g) => {
      const usable = g.choices.filter((c) => c.available)
      const marked = usable.find((c) => c.isDefault)
      if (marked) return marked.label
      const min = Math.min(...usable.map((c) => c.price))
      return usable.find((c) => c.price === min)?.label
    })
    .filter((l): l is string => !!l)
}

/* ---------- Offers, promo codes and rewards ---------- */

export type OfferRule =
  | { type: 'free_item_with'; free_item_id: string; with_category_ids: string[] }
  | { type: 'free_option'; option_label: string; category_ids: string[] }
  | { type: 'amount_off_option'; amount: number; option_label: string; category_ids: string[] }
  | { type: 'amount_off_item'; amount: number; item_ids: string[]; max_units?: number }
  | { type: 'percent_after_tier'; percent: number; min_spend?: number; max_discount?: number; first_order_only?: boolean }

export type Offer = {
  id: string
  title: string
  rule: OfferRule
  /** ms since epoch */
  startsAt: number
  endsAt: number
  isOneTime: boolean
  /** Set for promo codes */
  code?: string | null
}

export type RewardSlot = { label: string; kind?: 'drink' | 'food'; categories?: string[] }
export type RewardDef = { id: string; name: string; slots: RewardSlot[] }

/** "₱1,234.00" (SRS 3.7: two decimals) */
export const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Manila' })

type Unit = PricedLine

/** One entry per unit (a line of 3 is 3 units), leaving out units a reward already made free */
function unitsOf(lines: PricedLine[], skipKeys: string[] = []): Unit[] {
  const left = [...skipKeys]
  return lines
    .flatMap((l) => Array.from({ length: l.qty }, () => l))
    .filter((u) => {
      const i = left.indexOf(u.key)
      if (i < 0) return true
      left.splice(i, 1)
      return false
    })
}

export type RewardResult =
  | { applies: true; amount: number; items: { name: string; amount: number; key: string }[] }
  | { applies: false; amount: 0; missing: string }

/** FR-LOY-09: for each slot, the cheapest unit that fits is 100% off */
export function rewardSavings(reward: RewardDef, lines: PricedLine[]): RewardResult {
  const units = unitsOf(lines)
  const taken = new Set<number>()
  const items: { name: string; amount: number; key: string }[] = []
  for (const slot of reward.slots) {
    let best = -1
    units.forEach((u, i) => {
      if (taken.has(i)) return
      if (slot.kind && u.kind !== slot.kind) return
      if (slot.categories && !slot.categories.includes(u.category)) return
      if (best < 0 || u.unitPrice < units[best].unitPrice) best = i
    })
    if (best < 0) return { applies: false, amount: 0, missing: slot.label }
    taken.add(best)
    items.push({ name: units[best].name, amount: units[best].unitPrice, key: units[best].key })
  }
  return { applies: true, amount: items.reduce((s, i) => s + i.amount, 0), items }
}

export type OfferResult = { offer: Offer; amount: number; note: string }

const inCats = (u: Unit, cats: string[]) => cats.includes(u.category)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What one automatic offer takes off these units (null when it doesn't apply) */
export function offerOn(offer: Offer, units: Unit[], ctx: { subtotal: number; afterTier: number; isFirstOrder: boolean }): OfferResult | null {
  const r = offer.rule
  switch (r.type) {
    case 'free_item_with': {
      const meals = units.filter((u) => inCats(u, r.with_category_ids)).length
      const free = units.filter((u) => u.itemId === r.free_item_id)
      const n = Math.min(meals, free.length)
      if (!n) return null
      const cheapest = [...free].sort((a, b) => a.unitPrice - b.unitPrice).slice(0, n)
      return { offer, amount: cheapest.reduce((s, u) => s + u.unitPrice, 0), note: `${n} × ${free[0].name} free` }
    }
    case 'free_option': {
      const hits = units.filter((u) => inCats(u, r.category_ids) && u.options.includes(r.option_label))
      if (!hits.length) return null
      const amount = hits.reduce((s, u) => s + (u.chosen.find((c) => c.label === r.option_label)?.price ?? 0), 0)
      if (!amount) return null
      return { offer, amount, note: `${r.option_label} free on ${plural(hits.length, 'drink')}` }
    }
    case 'amount_off_option': {
      const hits = units.filter((u) => inCats(u, r.category_ids) && u.options.includes(r.option_label))
      if (!hits.length) return null
      const each = r.amount / 100
      return { offer, amount: hits.length * each, note: `${peso(each)} off ${plural(hits.length, 'drink')}` }
    }
    case 'amount_off_item': {
      const hits = units.filter((u) => r.item_ids.includes(u.itemId)).slice(0, r.max_units ?? Infinity)
      if (!hits.length) return null
      const each = r.amount / 100
      return { offer, amount: hits.reduce((s, u) => s + Math.min(each, u.unitPrice), 0), note: `${peso(each)} off ${hits[0].name}` }
    }
    case 'percent_after_tier': {
      if (r.first_order_only && !ctx.isFirstOrder) return null
      if (r.min_spend && ctx.subtotal < r.min_spend / 100) return null
      let amount = Math.round((ctx.afterTier * r.percent) / 100)
      if (r.max_discount) amount = Math.min(amount, r.max_discount / 100)
      if (!amount) return null
      return { offer, amount, note: `${r.percent}% off` }
    }
  }
}

export type PromoCheck = { ok: true; amount: number; note: string } | { ok: false; error: string }

/** FR-CHK-05 / FR-PRO-08: a promo code against its window, use and minimum spend */
export function checkPromo(
  offer: Offer,
  ctx: { subtotal: number; afterTier: number; used: boolean; now: number },
): PromoCheck {
  const code = offer.code ?? ''
  if (ctx.now < offer.startsAt) return { ok: false, error: `This code starts on ${shortDate(offer.startsAt)}.` }
  if (ctx.now > offer.endsAt) return { ok: false, error: `This code ended on ${shortDate(offer.endsAt)}.` }
  if (offer.isOneTime && ctx.used) return { ok: false, error: "You've already used this code." }
  const r = offer.rule
  if (r.type === 'percent_after_tier' && r.min_spend && ctx.subtotal < r.min_spend / 100) {
    const min = r.min_spend / 100
    return { ok: false, error: `Spend ${peso(min)} or more to use this code. Add ${peso(min - ctx.subtotal)} more.` }
  }
  if (r.type !== 'percent_after_tier') return { ok: false, error: `${code}: this code can't be used with your order.` }
  let amount = Math.round((ctx.afterTier * r.percent) / 100)
  if (r.max_discount) amount = Math.min(amount, r.max_discount / 100)
  return { ok: true, amount, note: `${r.percent}% off` }
}

/* ---------- Totals ---------- */

export type TotalsInput = {
  lines: PricedLine[]
  /** Signed-in customer: gets the tier discount, promo codes and vouchers */
  member: boolean
  tier?: { name: string; pct: number } | null
  /** Published automatic offers (no code) */
  offers: Offer[]
  /** Automatic offers this customer already used (one-time ones are skipped) */
  usedOfferIds: string[]
  isFirstOrder: boolean
  promo?: { offer: Offer; used: boolean } | null
  reward?: RewardDef | null
  fulfillment: 'pickup' | 'delivery'
  deliveryFee: number
  pointsPerPeso: number
  now: number
}

export type Totals = {
  subtotal: number
  tierName: string | null
  /** Tier discount, first and not removable (FR-CHK-05) */
  discount: number
  offer: { id: string; name: string; amount: number; note: string; code?: string } | null
  reward: { name: string; amount: number; items: { name: string; amount: number; key: string }[] } | null
  /** What the cart needs for the chosen voucher to apply (FR-LOY-09) */
  rewardMissing?: string
  /** Why an applied promo code no longer counts (3.2.4.5: the row goes and a banner says why) */
  promoProblem?: string
  deliveryFee: number
  total: number
  /** AS-03: points this order earns when Completed */
  points: number
}

export function computeTotals(t: TotalsInput): Totals {
  const subtotal = t.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const tierName = t.member && t.tier ? t.tier.name : null
  const discount = t.member && t.tier ? Math.round((subtotal * t.tier.pct) / 100) : 0
  const afterTier = subtotal - discount

  let reward: Totals['reward'] = null
  let rewardMissing: string | undefined
  if (t.member && t.reward) {
    const r = rewardSavings(t.reward, t.lines)
    if (r.applies) reward = { name: t.reward.name, amount: r.amount, items: r.items }
    else rewardMissing = r.missing
  }

  let offer: Totals['offer'] = null
  let promoProblem: string | undefined
  if (t.member && t.promo && t.lines.length) {
    const c = checkPromo(t.promo.offer, { subtotal, afterTier, used: t.promo.used, now: t.now })
    if (c.ok) offer = { id: t.promo.offer.id, name: t.promo.offer.title, amount: c.amount, note: c.note, code: t.promo.offer.code ?? undefined }
    else promoProblem = `${t.promo.offer.code} was removed: ${c.error}`
  }
  if (!offer) {
    // AS-05: an automatic offer never discounts a unit a reward already made free
    const units = unitsOf(t.lines, reward?.items.map((i) => i.key) ?? [])
    const best = t.offers
      .filter((o) => !o.code && t.now >= o.startsAt && t.now <= o.endsAt)
      .filter((o) => !(o.isOneTime && t.usedOfferIds.includes(o.id)))
      .filter((o) => t.member || o.rule.type !== 'percent_after_tier')
      .map((o) => offerOn(o, units, { subtotal, afterTier, isFirstOrder: t.isFirstOrder }))
      .filter((o): o is OfferResult => !!o && o.amount > 0)
      .sort((a, b) => b.amount - a.amount)[0]
    if (best) offer = { id: best.offer.id, name: best.offer.title, amount: best.amount, note: best.note }
  }

  const deliveryFee = t.fulfillment === 'delivery' ? t.deliveryFee : 0
  const total = Math.max(0, subtotal - discount - (offer?.amount ?? 0) - (reward?.amount ?? 0)) + deliveryFee
  return {
    subtotal,
    tierName,
    discount,
    offer,
    reward,
    rewardMissing,
    promoProblem,
    deliveryFee,
    total,
    points: Math.floor(total * t.pointsPerPeso),
  }
}

/* ---------- Opening hours (IR-10, FR-CHK-11) ---------- */

export type Hours = { open: string; close: string; closed: boolean }

/** Whether orders are taken right now, in Asia/Manila time */
export function isOpen(acceptingOrders: boolean, hours: Hours[], now: number): boolean {
  if (!acceptingOrders) return false
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  const minutes = Number(get('hour')) * 60 + Number(get('minute'))
  const h = hours[day]
  if (!h || h.closed) return false
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
  return minutes >= toMin(h.open) && minutes < toMin(h.close)
}
