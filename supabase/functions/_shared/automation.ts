// Automated orders (SRS 3.2.12, AS-08): the checks a standing rule runs, and the order it creates.
// Used by the staff-automations function (simulate, retry, convert) and by the demo seed.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { isOpen, priceLine, type PricedLine } from './pricing.ts'
import { cents, type Catalog } from './server.ts'

export type AutomationRow = {
  automated_order_id: string
  cafe_id: number
  source: string
  rule: string
  customer_id: string | null
  customer_name: string
  customer_mobile: string | null
  fulfillment: 'pickup' | 'delivery'
  contents: { item_id: string; options?: string[]; quantity: number }[]
  state: 'queued' | 'processing' | 'succeeded' | 'failed'
  retries: number
  timeline: { label: string; at: string }[]
}

export type Blocker = { code: string; message: string; reason: string }

/** What stops this automated order right now, if anything (FR-AOM-02) */
export function blocker(cat: Catalog, a: AutomationRow, now = Date.now()): Blocker | null {
  if (!isOpen(cat.store.accepting_orders, cat.store.opening_hours, now))
    return { code: 'STORE_CLOSED', message: 'STORE_CLOSED: not accepting orders', reason: 'The cafe is not accepting orders' }
  for (const l of a.contents) {
    const item = cat.items.get(l.item_id)
    if (!item || !item.active || !item.available) {
      const name = item?.name ?? 'An item'
      return { code: 'ITEM_UNAVAILABLE', message: `ITEM_UNAVAILABLE: ${name}`, reason: `${name} is sold out` }
    }
  }
  return null
}

/** Prices the rule's lines; `anyway` ignores sold-out items (staff converting to a manual order) */
export function priceContents(cat: Catalog, a: AutomationRow, anyway = false): PricedLine[] {
  return a.contents.map((l, i) => {
    const item = cat.items.get(l.item_id)
    const r = priceLine(item && anyway ? { ...item, available: true, active: true } : item, {
      key: `${l.item_id}-${i}`,
      itemId: l.item_id,
      options: l.options ?? [],
      qty: l.quantity,
    })
    if (!r.ok) throw new Error(r.error)
    return r.line
  })
}

/** Writes the order an automation makes: priced from the menu, paid by the saved card, no discounts */
export async function createAutomatedOrder(
  db: SupabaseClient,
  cat: Catalog,
  a: AutomationRow,
  opts: { anyway?: boolean; placedAt?: Date; orderNo?: number } = {},
) {
  const lines = priceContents(cat, a, opts.anyway)
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const fee = a.fulfillment === 'delivery' ? cat.store.delivery_fee : 0
  const total = subtotal + fee
  const placed = opts.placedAt ?? new Date()

  let address: Record<string, unknown> | null = null
  if (a.fulfillment === 'delivery') {
    const { data } = a.customer_id
      ? await db.from('address').select('*').eq('customer_id', a.customer_id).order('is_default', { ascending: false }).limit(1).maybeSingle()
      : { data: null }
    address = data
      ? { label: data.label, recipient_name: data.recipient_name, street: data.street, barangay: data.barangay, city: data.city, mobile_no: data.mobile_no, notes: data.notes }
      : { label: 'Work', recipient_name: a.customer_name, street: a.rule, barangay: '—', city: '—' }
  }

  const { data, error } = await db.rpc('create_order', {
    p: {
      order_no: opts.orderNo ?? null,
      idempotency_key: crypto.randomUUID(),
      cafe_id: a.cafe_id,
      customer_id: a.customer_id,
      customer_name: a.customer_name,
      customer_mobile: a.customer_mobile ?? '—',
      fulfillment: a.fulfillment,
      delivery_address: address,
      subtotal: cents(subtotal),
      delivery_fee: cents(fee),
      total: cents(total),
      points_to_earn: Math.floor(total * cat.store.points_per_peso),
      eta: new Date(placed.getTime() + (a.fulfillment === 'delivery' ? cat.store.delivery_eta_minutes : cat.store.default_prep_minutes) * 60_000).toISOString(),
      source: 'automated',
      placed_at: placed.toISOString(),
      lines: lines.map((l) => ({
        item_id: l.itemId,
        item_name: l.name,
        unit_price: cents(l.unitPrice),
        quantity: l.qty,
        options: l.chosen.map((c) => ({ value_id: c.valueId ?? null, group_title: c.groupTitle, label: c.label, price: cents(c.price) })),
      })),
      payment: {
        method: 'card',
        method_label: 'Saved card',
        amount: cents(total),
        status: 'authorized',
        provider_ref: `PAY-TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      },
    },
  })
  if (error) throw error
  return data as { order_id: string; order_no: number }
}
