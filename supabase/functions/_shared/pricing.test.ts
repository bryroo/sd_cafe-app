// Unit tests for the pricing engine (NFR-MNT-03). Run: npm test
import { describe, expect, it } from 'vitest'
import {
  checkPromo,
  computeTotals,
  defaultOptions,
  isOpen,
  priceLine,
  rewardSavings,
  type Item,
  type LineIn,
  type Offer,
  type PricedLine,
  type RewardDef,
  type TotalsInput,
} from './pricing'

/* ---------- A small menu built like the real one ---------- */

const size = (p16: number, p22: number, hot?: number) => ({
  code: 'size',
  title: 'Size',
  required: true,
  pick: 'one' as const,
  isSize: true,
  choices: [
    { label: 'Cold · 16 oz', price: p16, available: true, isDefault: true },
    { label: 'Cold · 22 oz', price: p22, available: true, isDefault: false },
    ...(hot ? [{ label: 'Hot · 12 oz', price: hot, available: true, isDefault: false }] : []),
  ],
})
const milk = {
  code: 'milk',
  title: 'Milk',
  required: false,
  pick: 'one' as const,
  isSize: false,
  choices: [
    { label: 'Regular milk', price: 0, available: true, isDefault: true },
    { label: 'Oat milk', price: 50, available: true, isDefault: false },
  ],
}
const addOns = {
  code: 'add-ons',
  title: 'Add-ons',
  required: false,
  pick: 'many' as const,
  isSize: false,
  choices: [
    { label: 'Espresso shot', price: 30, available: true, isDefault: false },
    { label: 'Syrup', price: 20, available: false, isDefault: false },
  ],
}

const menu: Record<string, Item> = {
  latte: { id: 'latte', name: 'Spanish Latte', kind: 'drink', category: 'espresso', price: null, available: true, active: true, groups: [size(110, 130, 120), milk, addOns] },
  matcha: { id: 'matcha', name: 'Matcha Lava', kind: 'drink', category: 'matcha', price: null, available: true, active: true, groups: [size(130, 150)] },
  carbonara: { id: 'carbonara', name: 'Carbonara', kind: 'food', category: 'pastas', price: 180, available: true, active: true, groups: [] },
  tapa: { id: 'tapa', name: 'Beef Tapa', kind: 'food', category: 'rice-meals', price: 160, available: true, active: true, groups: [] },
  fries: { id: 'potato-fries-plain', name: 'Potato Fries · Plain', kind: 'food', category: 'snacks', price: 110, available: true, active: true, groups: [] },
  nachos: { id: 'nachos', name: 'Nachos', kind: 'food', category: 'snacks', price: 180, available: true, active: true, groups: [] },
  soldOut: { id: 'sold-out', name: 'Ube Lava', kind: 'drink', category: 'non-coffee', price: 120, available: false, active: true, groups: [] },
}
const byId = (id: string) => Object.values(menu).find((m) => m.id === id)

function priced(...lines: LineIn[]): PricedLine[] {
  return lines.map((l) => {
    const r = priceLine(byId(l.itemId), l)
    if (!r.ok) throw new Error(r.error)
    return r.line
  })
}
const line = (itemId: string, options: string[] = [], qty = 1, key = `${itemId}|${options.join('|')}`): LineIn => ({ key, itemId, options, qty })

const NOW = Date.parse('2026-11-08T10:00:00+08:00')
const DAY = 86_400_000
const offer = (o: Partial<Offer> & Pick<Offer, 'id' | 'rule'>): Offer => ({
  title: o.id,
  startsAt: NOW - DAY,
  endsAt: NOW + DAY,
  isOneTime: false,
  code: null,
  ...o,
})

const friesWithRice = offer({ id: 'fries-with-rice-meal', title: 'Free plain fries with any rice meal', rule: { type: 'free_item_with', free_item_id: 'potato-fries-plain', with_category_ids: ['rice-meals'] } })
const oatSwap = offer({ id: 'oat-swap', title: 'Free oat milk swap', rule: { type: 'free_option', option_label: 'Oat milk', category_ids: ['espresso'] } })
const matcha22 = offer({ id: 'matcha-22', title: '₱10 off any 22 oz matcha', rule: { type: 'amount_off_option', amount: 1000, option_label: 'Cold · 22 oz', category_ids: ['matcha'] } })
const welcome = offer({ id: 'welcome-10', title: 'Welcome: 10% off', isOneTime: true, rule: { type: 'percent_after_tier', percent: 10, max_discount: 10000, first_order_only: true } })
const megs10 = offer({ id: 'promo-megs10', title: 'Promo MEGS10', code: 'MEGS10', isOneTime: true, rule: { type: 'percent_after_tier', percent: 10, min_spend: 20000 } })

const freeDrink: RewardDef = { id: 'free-drink', name: 'Free any drink', slots: [{ label: 'a drink', kind: 'drink' }] }
const drinkSnack: RewardDef = { id: 'drink-pastry', name: 'Free drink + snack', slots: [{ label: 'a drink', kind: 'drink' }, { label: 'a snack', categories: ['snacks'] }] }

const base = (lines: PricedLine[], over: Partial<TotalsInput> = {}): TotalsInput => ({
  lines,
  member: true,
  tier: { name: 'Regular', pct: 5 },
  offers: [],
  usedOfferIds: [],
  isFirstOrder: false,
  fulfillment: 'pickup',
  deliveryFee: 25,
  pointsPerPeso: 1,
  now: NOW,
  ...over,
})

/* ---------- Lines (FR-CRT-01 to 04) ---------- */

describe('priceLine', () => {
  it('prices a drink by its size plus options', () => {
    const [l] = priced(line('latte', ['Cold · 22 oz', 'Oat milk', 'Espresso shot']))
    expect(l.unitPrice).toBe(130 + 50 + 30)
    expect(l.chosen.map((c) => c.label)).toEqual(['Cold · 22 oz', 'Oat milk', 'Espresso shot'])
  })
  it('prices a single-price item', () => {
    expect(priced(line('carbonara'))[0].unitPrice).toBe(180)
  })
  it('requires a size', () => {
    expect(priceLine(menu.latte, line('latte', ['Oat milk']))).toEqual({ ok: false, error: 'Choose a size for Spanish Latte.' })
  })
  it('allows only one choice in a pick-one group', () => {
    const r = priceLine(menu.latte, line('latte', ['Cold · 16 oz', 'Cold · 22 oz']))
    expect(r.ok).toBe(false)
  })
  it('rejects options the item does not have', () => {
    const r = priceLine(menu.carbonara, line('carbonara', ['Oat milk']))
    expect(r).toEqual({ ok: false, error: "Oat milk isn't an option for Carbonara." })
  })
  it('rejects an unavailable add-on', () => {
    const r = priceLine(menu.latte, line('latte', ['Cold · 16 oz', 'Syrup']))
    expect(r).toEqual({ ok: false, error: "Syrup isn't available right now." })
  })
  it('rejects sold-out and unknown items', () => {
    expect(priceLine(menu.soldOut, line('sold-out'))).toEqual({ ok: false, error: 'Ube Lava is sold out.' })
    expect(priceLine(undefined, line('nope'))).toEqual({ ok: false, error: 'This item is no longer on the menu.' })
    expect(priceLine({ ...menu.carbonara, active: false }, line('carbonara')).ok).toBe(false)
  })
  it('limits quantity to 1–20 and notes to 140 characters', () => {
    expect(priceLine(menu.carbonara, line('carbonara', [], 21)).ok).toBe(false)
    expect(priceLine(menu.carbonara, line('carbonara', [], 0)).ok).toBe(false)
    expect(priceLine(menu.carbonara, { ...line('carbonara'), note: 'x'.repeat(141) }).ok).toBe(false)
  })
})

describe('defaultOptions', () => {
  it('picks the menu default in each pick-one group, no add-ons', () => {
    expect(defaultOptions(menu.latte)).toEqual(['Cold · 16 oz', 'Regular milk'])
  })
  it('falls back to the cheapest when none is marked', () => {
    const g = { ...size(140, 130), choices: size(140, 130).choices.map((c) => ({ ...c, isDefault: false })) }
    expect(defaultOptions({ ...menu.matcha, groups: [g] })).toEqual(['Cold · 22 oz'])
  })
})

/* ---------- Totals (FR-CHK-04) ---------- */

describe('computeTotals', () => {
  it('applies the tier discount first, then the delivery fee', () => {
    const t = computeTotals(base(priced(line('carbonara'), line('latte', ['Cold · 16 oz', 'Oat milk'])), { fulfillment: 'delivery' }))
    expect(t.subtotal).toBe(340)
    expect(t.discount).toBe(17) // 5% of 340
    expect(t.deliveryFee).toBe(25)
    expect(t.total).toBe(340 - 17 + 25)
    expect(t.points).toBe(348)
  })
  it('charges no delivery fee for pickup (FR-CHK-03)', () => {
    expect(computeTotals(base(priced(line('carbonara')))).deliveryFee).toBe(0)
  })
  it('gives guests no tier discount, vouchers or percent offers', () => {
    const t = computeTotals(base(priced(line('latte', ['Cold · 16 oz'])), { member: false, reward: freeDrink, offers: [welcome], isFirstOrder: true }))
    expect(t.discount).toBe(0)
    expect(t.reward).toBeNull()
    expect(t.offer).toBeNull()
  })
  it('picks the automatic offer that saves the most (FR-PRO-06)', () => {
    const lines = priced(line('tapa'), line('potato-fries-plain'), line('latte', ['Cold · 16 oz', 'Oat milk']))
    const t = computeTotals(base(lines, { offers: [oatSwap, friesWithRice] }))
    expect(t.offer).toMatchObject({ id: 'fries-with-rice-meal', amount: 110 })
  })
  it('free_item_with: one free item per qualifying meal', () => {
    const t = computeTotals(base(priced(line('tapa', [], 1), line('potato-fries-plain', [], 2)), { offers: [friesWithRice] }))
    expect(t.offer?.amount).toBe(110)
  })
  it('free_option: the option is free on each qualifying unit', () => {
    const t = computeTotals(base(priced(line('latte', ['Cold · 16 oz', 'Oat milk'], 2)), { offers: [oatSwap] }))
    expect(t.offer).toMatchObject({ amount: 100, note: 'Oat milk free on 2 drinks' })
  })
  it('amount_off_option: a fixed amount per qualifying unit (rule in centavos)', () => {
    const t = computeTotals(base(priced(line('matcha', ['Cold · 22 oz'], 3), line('matcha', ['Cold · 16 oz'])), { offers: [matcha22] }))
    expect(t.offer?.amount).toBe(30)
  })
  it('amount_off_item: capped per unit and by max_units', () => {
    const o = offer({ id: 'carb', rule: { type: 'amount_off_item', amount: 2000, item_ids: ['carbonara'], max_units: 1 } })
    expect(computeTotals(base(priced(line('carbonara', [], 3)), { offers: [o] })).offer?.amount).toBe(20)
  })
  it('skips offers outside their dates', () => {
    const old = { ...oatSwap, endsAt: NOW - 1 }
    expect(computeTotals(base(priced(line('latte', ['Cold · 16 oz', 'Oat milk'])), { offers: [old] })).offer).toBeNull()
  })
  it('a first-order percent offer applies once, only on the first order, capped', () => {
    const lines = priced(line('carbonara', [], 10))
    const first = computeTotals(base(lines, { offers: [welcome], isFirstOrder: true }))
    expect(first.offer?.amount).toBe(100) // 10% of 1710 = 171, capped at ₱100
    expect(computeTotals(base(lines, { offers: [welcome], isFirstOrder: false })).offer).toBeNull()
    expect(computeTotals(base(lines, { offers: [welcome], isFirstOrder: true, usedOfferIds: ['welcome-10'] })).offer).toBeNull()
  })
  it('a promo code replaces the automatic offer (AS-05)', () => {
    const lines = priced(line('tapa'), line('potato-fries-plain'))
    const t = computeTotals(base(lines, { offers: [friesWithRice], promo: { offer: megs10, used: false } }))
    expect(t.offer).toMatchObject({ code: 'MEGS10', amount: Math.round((270 - 14) * 0.1) })
  })
  it('an invalid promo code is dropped with a reason and the automatic offer returns', () => {
    const lines = priced(line('tapa'), line('potato-fries-plain'))
    const t = computeTotals(base(lines, { offers: [friesWithRice], promo: { offer: megs10, used: true } }))
    expect(t.promoProblem).toBe("MEGS10 was removed: You've already used this code.")
    expect(t.offer?.id).toBe('fries-with-rice-meal')
  })
  it('a reward makes the cheapest eligible drink free, and offers skip that unit', () => {
    const lines = priced(line('latte', ['Cold · 16 oz', 'Oat milk']), line('latte', ['Cold · 22 oz', 'Oat milk']))
    const t = computeTotals(base(lines, { reward: freeDrink, offers: [oatSwap] }))
    expect(t.reward).toMatchObject({ amount: 160, items: [{ name: 'Spanish Latte', amount: 160 }] })
    expect(t.offer?.amount).toBe(50) // oat milk only on the unit that wasn't free
    expect(t.total).toBe(340 - 17 - 50 - 160)
  })
  it('says what to add when the voucher has nothing to apply to', () => {
    const t = computeTotals(base(priced(line('latte', ['Cold · 16 oz'])), { reward: drinkSnack }))
    expect(t.reward).toBeNull()
    expect(t.rewardMissing).toBe('a snack')
  })
  it('never goes below zero before the delivery fee', () => {
    const t = computeTotals(base(priced(line('latte', ['Cold · 16 oz'])), { reward: freeDrink, tier: { name: 'Loyal', pct: 10 }, fulfillment: 'delivery' }))
    expect(t.total).toBe(25)
  })
  it('earns points at the configured rate', () => {
    expect(computeTotals(base(priced(line('carbonara')), { pointsPerPeso: 0.5, tier: null })).points).toBe(90)
  })
})

describe('rewardSavings', () => {
  it('fills each slot with a different unit', () => {
    const r = rewardSavings(drinkSnack, priced(line('nachos'), line('potato-fries-plain'), line('latte', ['Cold · 16 oz'])))
    expect(r).toMatchObject({ applies: true, amount: 110 + 110 })
  })
})

/* ---------- Promo codes (FR-PRO-08) ---------- */

describe('checkPromo', () => {
  const ctx = { subtotal: 300, afterTier: 285, used: false, now: NOW }
  it('takes the percent off what is left after the tier discount', () => {
    expect(checkPromo(megs10, ctx)).toEqual({ ok: true, amount: 29, note: '10% off' })
  })
  it('explains a minimum spend', () => {
    expect(checkPromo(megs10, { ...ctx, subtotal: 150 })).toEqual({ ok: false, error: 'Spend ₱200.00 or more to use this code. Add ₱50.00 more.' })
  })
  it('explains dates and one use per customer', () => {
    expect(checkPromo({ ...megs10, startsAt: NOW + DAY }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('This code starts on') })
    expect(checkPromo({ ...megs10, endsAt: NOW - DAY }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('This code ended on') })
    expect(checkPromo(megs10, { ...ctx, used: true })).toEqual({ ok: false, error: "You've already used this code." })
  })
  it('rejects codes whose rule is not a percent', () => {
    expect(checkPromo({ ...oatSwap, code: 'OAT' }, ctx).ok).toBe(false)
  })
})

/* ---------- Opening hours (IR-10) ---------- */

describe('isOpen', () => {
  const week = Array.from({ length: 7 }, () => ({ open: '07:00', close: '21:00', closed: false }))
  it('is open inside Manila hours and closed outside them', () => {
    expect(isOpen(true, week, Date.parse('2026-11-08T10:00:00+08:00'))).toBe(true)
    expect(isOpen(true, week, Date.parse('2026-11-08T22:00:00+08:00'))).toBe(false)
    expect(isOpen(true, week, Date.parse('2026-11-08T06:59:00+08:00'))).toBe(false)
  })
  it('is closed when orders are off or the day is closed', () => {
    expect(isOpen(false, week, NOW)).toBe(false)
    const sundayOff = week.map((h, i) => (i === 0 ? { ...h, closed: true } : h))
    expect(isOpen(true, sundayOff, Date.parse('2026-11-08T10:00:00+08:00'))).toBe(false) // 8 Nov 2026 is a Sunday
  })
})
