// Shared by the Edge Functions: the service client, who is calling, and the menu, offers and store
// settings loaded from the database in the shape the pricing engine expects.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Group, Hours, Item, Offer, OfferRule, RewardDef } from './pricing.ts'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** A failure the app shows to the person: a code it can branch on and a plain message */
export const fail = (code: string, message: string, status = 400, extra: Record<string, unknown> = {}) =>
  json({ error: { code, message, ...extra } }, status)

/** Service client: bypasses RLS. Only ever used inside Edge Functions. */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** The signed-in user behind the request's bearer token, or null */
export async function caller(req: Request, db: SupabaseClient) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function isStaff(db: SupabaseClient, userId: string) {
  const { data } = await db.from('staff_user').select('staff_id, full_name').eq('staff_id', userId).eq('is_active', true).maybeSingle()
  return data as { staff_id: string; full_name: string } | null
}

const pesos = (centavos: number | null) => (centavos === null ? null : centavos / 100)

export type Catalog = {
  items: Map<string, Item>
  offers: Offer[]
  rewards: Map<string, RewardDef>
  store: {
    settings_id: number
    cafe_name: string
    accepting_orders: boolean
    opening_hours: Hours[]
    default_prep_minutes: number
    delivery_eta_minutes: number
    delivery_enabled: boolean
    delivery_fee: number
    points_per_peso: number
    demo_mode: boolean
  }
  tiers: Map<number, { name: string; pct: number }>
}

type ItemRow = {
  item_id: string
  name: string
  kind: 'drink' | 'food'
  category_id: string
  price: number | null
  is_available: boolean
  is_active: boolean
  option_group: {
    code: string
    title: string
    is_required: boolean
    pick: 'one' | 'many'
    is_size: boolean
    sort_order: number
    option_value: { value_id: number; label: string; price: number; is_available: boolean; is_default: boolean; badge: string | null; sort_order: number }[]
  }[]
}

export const toOffer = (p: {
  promotion_id: string
  title: string
  rule: OfferRule
  starts_at: string
  ends_at: string
  is_one_time: boolean
  code?: string | null
}): Offer => ({
  id: p.promotion_id,
  title: p.title,
  rule: p.rule,
  startsAt: Date.parse(p.starts_at),
  endsAt: Date.parse(p.ends_at),
  isOneTime: p.is_one_time,
  code: p.code ?? null,
})

/** Everything pricing needs, read fresh for each request (the menu is small) */
export async function loadCatalog(db: SupabaseClient): Promise<Catalog> {
  const [items, offers, rewards, store, tiers] = await Promise.all([
    db
      .from('menu_item')
      .select('item_id, name, kind, category_id, price, is_available, is_active, option_group(code, title, is_required, pick, is_size, sort_order, option_value(value_id, label, price, is_available, is_default, badge, sort_order))'),
    db.from('promotion').select('promotion_id, title, rule, starts_at, ends_at, is_one_time, code').eq('is_published', true).is('code', null),
    db.from('reward').select('reward_id, name, eligible_items').eq('is_active', true),
    db.from('store_settings').select('*').order('settings_id').limit(1).single(),
    db.from('tier').select('tier_id, name, discount_pct'),
  ])
  for (const r of [items, offers, rewards, store, tiers]) if (r.error) throw r.error

  const map = new Map<string, Item>()
  for (const row of items.data as ItemRow[]) {
    const groups: Group[] = [...row.option_group]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        code: g.code,
        title: g.title,
        required: g.is_required,
        pick: g.pick,
        isSize: g.is_size,
        choices: [...g.option_value]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((v) => ({
            valueId: v.value_id,
            label: v.label,
            price: v.price / 100,
            available: v.is_available,
            isDefault: v.is_default,
            badge: v.badge ?? undefined,
          })),
      }))
    map.set(row.item_id, {
      id: row.item_id,
      name: row.name,
      kind: row.kind,
      category: row.category_id,
      price: pesos(row.price),
      available: row.is_available,
      active: row.is_active,
      groups,
    })
  }

  const s = store.data
  return {
    items: map,
    offers: (offers.data ?? []).map(toOffer),
    rewards: new Map(
      (rewards.data ?? []).map((r: { reward_id: string; name: string; eligible_items: RewardDef['slots'] }) => [
        r.reward_id,
        { id: r.reward_id, name: r.name, slots: r.eligible_items },
      ]),
    ),
    store: { ...s, delivery_fee: s.delivery_fee / 100, points_per_peso: Number(s.points_per_peso) },
    tiers: new Map((tiers.data ?? []).map((t: { tier_id: number; name: string; discount_pct: number }) => [t.tier_id, { name: t.name, pct: Number(t.discount_pct) }])),
  }
}

/** Pesos → integer centavos (SRS 3.8) */
export const cents = (p: number) => Math.round(p * 100)
