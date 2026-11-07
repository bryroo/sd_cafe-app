// Rewards catalogue and promotions (Flow 5), loaded from the database (SRS REWARD, PROMOTION) by
// src/data/catalog.ts. Discounts are worked out by the shared pricing engine, the same code the
// place-order function charges with. Promo codes are never listed: the checkout picker looks one up
// when the customer types it (check_promo_code), and the server checks it again when ordering.
import {
  checkPromo as checkPromoRule,
  priceLine,
  rewardSavings as rewardSavingsFor,
  type Offer,
  type OfferRule,
  type PricedLine,
  type RewardSlot,
} from '../../supabase/functions/_shared/pricing'
import { db } from '../lib/supabase'
import type { CartLine } from '../state/shared'
import { peso, productById, toPricingItem } from './menu'

export type { RewardSlot }

export type Reward = {
  id: string
  name: string
  cost: number
  terms: string[]
  /** What it makes free, one item per slot */
  slots: RewardSlot[]
  /** "a free drink" (FR-LOY-02) */
  goal: string
}

export const rewards: Reward[] = []
export const rewardById = (id: string) => rewards.find((r) => r.id === id)

export type RewardRow = { reward_id: string; name: string; cost_pts: number; terms: string[]; eligible_items: RewardSlot[]; goal_label: string | null; sort_order: number }

export function setRewards(rows: RewardRow[]) {
  rewards.splice(
    0,
    rewards.length,
    ...[...rows]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({ id: r.reward_id, name: r.name, cost: r.cost_pts, terms: r.terms, slots: r.eligible_items, goal: r.goal_label ?? r.name })),
  )
}

/** SRS FR-LOY-02: the points needed for the next reward in words, and how far along the bar is */
export function nextReward(points: number): { text: string; progress: number } {
  const byCost = [...rewards].sort((a, b) => a.cost - b.cost)
  const next = byCost.find((r) => r.cost > points)
  if (!next) return { text: 'Enough points for any reward', progress: 1 }
  return { text: `${(next.cost - points).toLocaleString('en-PH')} pts to ${next.goal}`, progress: points / next.cost }
}

/** Cart lines as the pricing engine reads them (a line whose item has gone keeps its own price) */
export function pricedCart(cart: CartLine[]): PricedLine[] {
  return cart.map((l) => {
    const p = productById(l.productId)
    const r = p ? priceLine({ ...toPricingItem(p), available: true }, { key: l.key, itemId: l.productId, options: l.options, qty: l.qty, note: l.note }) : null
    if (r?.ok) return r.line
    return {
      key: l.key,
      itemId: l.productId,
      options: l.options,
      qty: l.qty,
      note: l.note,
      name: p?.name ?? l.name ?? l.productId,
      kind: p?.kind ?? 'food',
      category: p?.section ?? '',
      unitPrice: l.unitPrice,
      chosen: [],
    }
  })
}

export type RewardSavings =
  | { applies: true; amount: number; items: { name: string; amount: number; key: string }[] }
  | { applies: false; amount: 0; missing: string }

/** What a reward takes off this cart: for each slot, the cheapest single unit that fits, at 100% off. */
export function rewardSavings(reward: Reward, cart: CartLine[]): RewardSavings {
  return rewardSavingsFor({ id: reward.id, name: reward.name, slots: reward.slots }, pricedCart(cart))
}

/** "Spanish Latte (₱110)" or "Spanish Latte (₱110) and Nachos (₱180)" */
export const freeItemsLine = (items: { name: string; amount: number }[]) =>
  items.map((i) => `${i.name} (${peso(i.amount)})`).join(' and ')

/** A voucher in My rewards (SRS CUSTOMER_REWARD): Redeemed means unused and ready to apply */
export type MyReward = { rewardId: string; status: 'Redeemed' | 'Expired' | 'Used'; voucherId?: string; expiresOn?: number }

export type Activity = {
  id: string
  description: string
  date: string
  month: string
  points: number
}

/* ----- Promotions (C-25, C-26) ----- */

export type Promotion = {
  id: string
  title: string
  description: string
  terms: string[]
  /** Active: "Ends 30 Nov"; past: "Ended 5 Oct" / "You've used this offer" */
  validity: string
  status: 'Active' | 'Expired' | 'Used'
  /** The menu section "Order now" opens */
  section?: string
  /** For the pricing engine */
  offer: Offer
  featured: boolean
}

export type PromotionRow = {
  promotion_id: string
  title: string
  description: string
  terms: string[]
  rule: OfferRule
  starts_at: string
  ends_at: string
  is_one_time: boolean
  target_category_id: string | null
  is_featured: boolean
}

export const promotions: Promotion[] = []
/** The offer Home, the welcome pop-up and the notification feature (live binding: updates on load) */
export let featuredPromotion: Promotion | undefined
export const promotionById = (id: string) => promotions.find((p) => p.id === id)

const dayMonth = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Manila' })

let promotionRows: PromotionRow[] = []
let usedPromotionIds: string[] = []

function rebuildPromotions() {
  const now = Date.now()
  promotions.splice(
    0,
    promotions.length,
    ...promotionRows
      .map((r): Promotion => {
        const offer: Offer = { id: r.promotion_id, title: r.title, rule: r.rule, startsAt: Date.parse(r.starts_at), endsAt: Date.parse(r.ends_at), isOneTime: r.is_one_time, code: null }
        const used = r.is_one_time && usedPromotionIds.includes(r.promotion_id)
        const ended = now > offer.endsAt
        const status = used ? 'Used' : ended ? 'Expired' : 'Active'
        return {
          id: r.promotion_id,
          title: r.title,
          description: r.description,
          terms: r.terms,
          validity: status === 'Used' ? "You've used this offer" : status === 'Expired' ? `Ended ${dayMonth(offer.endsAt)}` : `Ends ${dayMonth(offer.endsAt)}`,
          status,
          section: r.target_category_id ?? undefined,
          offer,
          featured: r.is_featured,
        }
      })
      .filter((p) => p.status !== 'Active' || Date.now() >= p.offer.startsAt)
      .sort((a, b) => a.offer.endsAt - b.offer.endsAt),
  )
  featuredPromotion = promotions.find((p) => p.status === 'Active' && p.featured) ?? promotions.find((p) => p.status === 'Active')
}

export function setPromotions(rows: PromotionRow[]) {
  promotionRows = rows
  rebuildPromotions()
}

/** The signed-in customer's used one-time offers ("You've used this offer", FR-PRO-07) */
export function setUsedPromotions(ids: string[]) {
  if (ids.join() === usedPromotionIds.join()) return
  usedPromotionIds = ids
  rebuildPromotions()
}

/** Published automatic offers, for the pricing engine */
export const automaticOffers = () => promotions.filter((p) => p.status === 'Active').map((p) => p.offer)

/** A nudge when the cart is one step from the fries offer, for the cart screen */
export function offerHint(cart: CartLine[]): string | null {
  const fries = promotions.find((p) => p.status === 'Active' && p.offer.rule.type === 'free_item_with')
  if (!fries || fries.offer.rule.type !== 'free_item_with') return null
  const rule = fries.offer.rule
  const units = pricedCart(cart).flatMap((l) => Array.from({ length: l.qty }, () => l))
  const meals = units.filter((u) => rule.with_category_ids.includes(u.category)).length
  const free = units.filter((u) => u.itemId === rule.free_item_id).length
  const name = productById(rule.free_item_id)?.name
  if (meals > free && name) return `Add ${name}: ${free ? 'another one is' : "it's"} free with your ${meals > 1 ? 'meals' : 'meal'}.`
  return null
}

/* ----- Promo codes (SRS FR-CHK-05, FR-PRO-08) ----- */

/** Codes the customer has looked up this session, by code */
const promoCodes = new Map<string, { offer: Offer; used: boolean }>()
export const promoByCode = (code: string | null) => (code ? promoCodes.get(code.trim().toUpperCase()) ?? null : null)

export type PromoCheck = { ok: true; code: string; amount: number } | { ok: false; error: string }

/** Looks a code up on the server and checks it against this cart (window, use, minimum spend) */
export async function checkPromo(code: string, subtotal: number, afterTier: number): Promise<PromoCheck> {
  const key = code.trim().toUpperCase()
  if (!key) return { ok: false, error: 'Enter a code.' }
  const { data, error } = await db().rpc('check_promo_code', { p_code: key })
  if (error) return { ok: false, error: "Couldn't check the code. Try again." }
  if (!data) return { ok: false, error: "This code can't be used with your order." }
  const offer: Offer = {
    id: data.id,
    title: data.title,
    rule: data.rule,
    startsAt: Date.parse(data.starts_at),
    endsAt: Date.parse(data.ends_at),
    isOneTime: data.is_one_time,
    code: data.code,
  }
  promoCodes.set(key, { offer, used: data.used })
  const r = checkPromoRule(offer, { subtotal, afterTier, used: data.used, now: Date.now() })
  return r.ok ? { ok: true, code: key, amount: r.amount } : r
}
