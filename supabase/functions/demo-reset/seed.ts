// The demo's content as real rows: the prototype's sample customers, orders #1027 to #1042, Maria's
// points and vouchers, and the six automated orders. Times are relative to now, like the prototype.
// Resetting clears the order queue and automations and recreates the demo customers from scratch.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAutomatedOrder, type AutomationRow } from '../_shared/automation.ts'
import { computeTotals, priceLine, type PricedLine } from '../_shared/pricing.ts'
import { cents, loadCatalog, type Catalog } from '../_shared/server.ts'

export const DEMO_PASSWORD = 'password1'
const MIN = 60_000
const DAY = 24 * 60 * MIN

type Person = { key: string; name: string; mobile: string; email?: string }
const PEOPLE: Person[] = [
  { key: 'maria', name: 'Maria Santos', mobile: '+639171234567', email: 'maria.santos@example.com' },
  { key: 'ana', name: 'Ana Cruz', mobile: '+639175550123' },
  { key: 'jen', name: 'Jen Dizon', mobile: '+639275550198' },
  { key: 'leo', name: 'Leo Tan', mobile: '+639195550177' },
  { key: 'paolo', name: 'Paolo Reyes', mobile: '+639185550142' },
  { key: 'carlo', name: 'Carlo Lim', mobile: '+639055550164' },
]
/** The address Supabase Auth signs a customer in with (spec section 3) */
export const loginAddress = (mobile: string) => `${mobile.replace(/\D/g, '')}@phone.megs.local`

type Line = { item: string; options?: string[]; qty?: number; note?: string }
type Step = 'Received' | 'Accepted' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled'
const STEPS: Step[] = ['Received', 'Accepted', 'Preparing', 'Ready', 'Completed']
const STEP_AT: Record<string, string> = { Accepted: 'accepted_at', Preparing: 'preparing_at', Ready: 'ready_at', Completed: 'completed_at', Cancelled: 'cancelled_at' }
const EVENT_STATUS: Record<string, Step> = {
  order_received: 'Received',
  order_accepted: 'Accepted',
  order_preparing: 'Preparing',
  order_ready_pickup: 'Ready',
  order_ready_delivery: 'Ready',
  order_completed: 'Completed',
  order_cancelled_cafe: 'Cancelled',
  order_cancelled_customer: 'Cancelled',
}

const must = <T>(r: { data: T; error: unknown }) => {
  if (r.error) throw r.error
  return r.data
}

/** Keeps only options the item really has, so the seed survives menu sheet edits */
function priced(cat: Catalog, lines: Line[]): PricedLine[] {
  return lines.map((l, i) => {
    const item = cat.items.get(l.item)
    if (!item) throw new Error(`Seed: ${l.item} is not on the menu`)
    const known = new Set(item.groups.flatMap((g) => g.choices.map((c) => c.label)))
    const r = priceLine({ ...item, available: true }, { key: `${l.item}-${i}`, itemId: l.item, options: (l.options ?? []).filter((o) => known.has(o)), qty: l.qty ?? 1, note: l.note })
    if (!r.ok) throw new Error(`Seed: ${r.error}`)
    return r.line
  })
}

export async function seedDemo(db: SupabaseClient) {
  const now = Date.now()
  const ago = (ms: number) => new Date(now - ms)

  // ---------- Clean slate: queue, automations, demo customers ----------
  must(await db.from('automated_order').delete().not('automated_order_id', 'is', null))
  must(await db.from('orders').delete().not('order_id', 'is', null))
  const emails = new Set(PEOPLE.map((p) => loginAddress(p.mobile)))
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    for (const u of data.users) if (u.email && emails.has(u.email)) must(await db.auth.admin.deleteUser(u.id))
    if (data.users.length < 200) break
  }

  // ---------- Store back to its defaults (demo mode stays as it is) ----------
  must(
    await db
      .from('store_settings')
      .update({
        accepting_orders: true,
        opening_hours: Array.from({ length: 7 }, () => ({ open: '07:00', close: '21:00', closed: false })),
        default_prep_minutes: 10,
        delivery_eta_minutes: 35,
        delivery_enabled: true,
        delivery_fee: 2500,
        new_order_chime: true,
        auto_advance_demo: false,
      })
      .not('settings_id', 'is', null),
  )
  must(await db.from('menu_item').update({ is_available: true, unavailable_reason: null }).eq('is_available', false))
  // Paolo's office pre-order failed because Ube Lava ran out: the menu says so too (FR-OPS-04)
  must(await db.from('menu_item').update({ is_available: false, unavailable_reason: 'Out of ube' }).eq('item_id', 'ube-lava'))
  // Sign-in lockouts start over too (FR-ACC-07, FR-STF-01)
  must(await db.from('login_attempt').delete().not('identifier', 'is', null))

  // ---------- Customers (the sign-up trigger makes each customer row) ----------
  const ids: Record<string, string> = {}
  for (const p of PEOPLE) {
    const { data, error } = await db.auth.admin.createUser({
      email: loginAddress(p.mobile),
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { account_type: 'customer', full_name: p.name, mobile_no: p.mobile, contact_email: p.email ?? '', terms_accepted: true },
    })
    if (error) throw error
    ids[p.key] = data.user.id
  }
  must(await db.from('customer').update({ mobile_verified_at: ago(90 * DAY).toISOString(), created_at: ago(90 * DAY).toISOString() }).in('customer_id', Object.values(ids)))

  // Addresses and payment methods (FR-PRF-03, FR-PRF-04)
  const [home, , leoWork] = must(
    await db
      .from('address')
      .insert([
        { customer_id: ids.maria, label: 'Home', recipient_name: 'Maria Santos', street: '12 Mabini St', barangay: 'San Roque', city: 'Quezon City', mobile_no: '+639171234567', notes: 'Leave at the door', is_default: true },
        { customer_id: ids.maria, label: 'Work', recipient_name: 'Maria Santos', street: 'Unit 8B, Greenfield Tower', barangay: 'Wack-Wack Greenhills', city: 'Mandaluyong City', mobile_no: '+639171234567' },
        { customer_id: ids.leo, label: 'Work', recipient_name: 'Leo Tan', street: '21F Greenfield Tower', barangay: 'Wack-Wack Greenhills', city: 'Mandaluyong City', mobile_no: '+639195550177', is_default: true },
        { customer_id: ids.paolo, label: 'Work', recipient_name: 'Paolo Reyes', street: '15F Greenfield Tower', barangay: 'Wack-Wack Greenhills', city: 'Mandaluyong City', mobile_no: '+639185550142', is_default: true },
      ], { defaultToNull: false })
      .select(),
  ) as { address_id: string }[]
  void leoWork
  const cards = must(
    await db
      .from('payment_method')
      .insert([
        { customer_id: ids.maria, type: 'card', provider_token: 'tok_test_4242', brand: 'Visa', last4: '4242', is_default: true },
        // README test cards: 0002 is always declined; 0119 fails once after payment (shown in the app)
        { customer_id: ids.maria, type: 'card', provider_token: 'tok_test_0002', brand: 'Visa', last4: '0002' },
        { customer_id: ids.maria, type: 'card', provider_token: 'tok_test_0119', brand: 'Visa', last4: '0119' },
        { customer_id: ids.maria, type: 'e_wallet', provider_token: 'tok_test_wallet', wallet_name: 'E-wallet' },
      ], { defaultToNull: false })
      .select(),
  ) as { method_id: string; last4: string | null }[]
  const card4242 = cards.find((c) => c.last4 === '4242')!

  const cat = await loadCatalog(db)
  const templates = must(await db.from('response_template').select('template_id, event')) as { template_id: number; event: string }[]
  const templateStatus = new Map(templates.map((t) => [t.template_id, EVENT_STATUS[t.event]]))

  /** Moves an order through its steps at the given times, then dates its timeline, messages and points */
  async function walk(orderId: string, steps: [Step, Date][], opts: { readBefore?: Date; eta?: Date; cancelledBy?: 'customer' | 'cafe' } = {}) {
    for (const [status, at] of steps) {
      const patch: Record<string, unknown> = { status, [STEP_AT[status]]: at.toISOString() }
      if (status === 'Cancelled') {
        patch.cancelled_by = opts.cancelledBy ?? 'cafe'
        patch.cancel_reason_code = opts.cancelledBy === 'customer' ? 'customer_request' : 'out_of_stock'
      }
      must(await db.from('orders').update(patch).eq('order_id', orderId))
    }
    if (opts.eta) must(await db.from('orders').update({ eta: opts.eta.toISOString() }).eq('order_id', orderId))
    const order = must(await db.from('orders').select('placed_at').eq('order_id', orderId).single()) as { placed_at: string }
    const when = new Map<Step, string>([['Received', order.placed_at], ...steps.map(([s, d]) => [s, d.toISOString()] as [Step, string])])
    for (const [status, at] of when) {
      must(await db.from('order_status_event').update({ created_at: at }).eq('order_id', orderId).eq('to_status', status))
      if (status === 'Completed') must(await db.from('points_txn').update({ created_at: at }).eq('order_id', orderId))
    }
    const notes = must(await db.from('notification').select('notification_id, template_id').eq('order_id', orderId)) as { notification_id: string; template_id: number }[]
    for (const n of notes) {
      const at = when.get(templateStatus.get(n.template_id) ?? 'Received') ?? order.placed_at
      const read = opts.readBefore && Date.parse(at) < opts.readBefore.getTime() ? at : null
      must(await db.from('notification').update({ created_at: at, read_at: read }).eq('notification_id', n.notification_id))
    }
  }

  /** An app order at a fixed number and time, priced from the menu with the Regular discount */
  async function appOrder(no: number, who: string, lines: Line[], at: Date, pay: 'counter' | { id: string; label: string }, fulfillment: 'pickup' | 'delivery' = 'pickup') {
    const p = PEOPLE.find((x) => x.key === who)!
    const pl = priced(cat, lines)
    const t = computeTotals({
      lines: pl, member: true, tier: { name: 'Regular', pct: 5 }, offers: [], usedOfferIds: [], isFirstOrder: false,
      fulfillment, deliveryFee: cat.store.delivery_fee, pointsPerPeso: cat.store.points_per_peso, now: at.getTime(),
    })
    const order = must(
      await db.rpc('create_order', {
        p: {
          order_no: no,
          idempotency_key: crypto.randomUUID(),
          cafe_id: cat.store.settings_id,
          customer_id: ids[who],
          customer_name: p.name,
          customer_mobile: p.mobile,
          fulfillment,
          address_id: fulfillment === 'delivery' ? home.address_id : null,
          delivery_address: fulfillment === 'delivery' ? { label: 'Home', recipient_name: p.name, street: '12 Mabini St', barangay: 'San Roque', city: 'Quezon City' } : null,
          subtotal: cents(t.subtotal),
          tier_name: t.tierName,
          tier_discount: cents(t.discount),
          delivery_fee: cents(t.deliveryFee),
          total: cents(t.total),
          points_to_earn: t.points,
          eta: new Date(at.getTime() + 10 * MIN).toISOString(),
          source: 'app',
          placed_at: at.toISOString(),
          lines: pl.map((l) => ({
            item_id: l.itemId, item_name: l.name, unit_price: cents(l.unitPrice), quantity: l.qty, note: l.note,
            options: l.chosen.map((c) => ({ value_id: c.valueId ?? null, group_title: c.groupTitle, label: c.label, price: cents(c.price) })),
          })),
          payment: pay === 'counter'
            ? { method: 'counter', method_label: 'Pay at counter', amount: cents(t.total), status: 'pending' }
            : { method: 'card', payment_method_id: pay.id, method_label: pay.label, amount: cents(t.total), status: 'authorized', provider_ref: `PAY-${no}-4F2A` },
        },
      }),
    ) as { order_id: string }
    return order.order_id
  }

  // ---------- Maria's history (C-18 History, C-19) ----------
  const d27 = ago(33 * DAY - 16.5 * 60 * MIN)
  const o1027 = await appOrder(1027, 'maria', [{ item: 'hot-chocolate', options: ['Hot · 12 oz'] }, { item: 'nachos' }], d27, 'counter')
  await walk(o1027, [['Cancelled', new Date(d27.getTime() + 2 * MIN)]], { cancelledBy: 'customer', readBefore: ago(DAY) })

  const d31 = ago(30 * DAY - 8.25 * 60 * MIN)
  const o1031 = await appOrder(1031, 'maria', [{ item: 'spanish-latte', options: ['Cold · 16 oz', 'Regular milk'] }], d31, { id: card4242.method_id, label: 'Card ending 4242' })
  await walk(o1031, STEPS.slice(1).map((s, i) => [s, new Date(d31.getTime() + (i + 1) * 3 * MIN)] as [Step, Date]), { readBefore: ago(DAY) })
  // Maria used the welcome offer on her first order (C-26 "You've used this offer")
  must(await db.from('promotion_redemption').insert({ promotion_id: 'welcome-10', customer_id: ids.maria, order_id: o1031, created_at: d31.toISOString() }))

  const d38 = ago(27 * DAY - 10.7 * 60 * MIN)
  const o1038 = await appOrder(1038, 'maria', [{ item: 'latte', options: ['Hot · 12 oz', 'Oat milk'] }, { item: 'beef-tapa' }], d38, 'counter')
  await walk(o1038, STEPS.slice(1).map((s, i) => [s, new Date(d38.getTime() + (i + 1) * 4 * MIN)] as [Step, Date]), { readBefore: ago(DAY) })

  // ---------- Today's queue: #1039 to #1042 ----------
  const auto = (key: string, extra: Partial<AutomationRow>): AutomationRow => {
    const p = PEOPLE.find((x) => x.key === key)!
    return {
      automated_order_id: '', cafe_id: cat.store.settings_id, source: 'Recurring order', rule: 'Weekday 8:00 recurring order',
      customer_id: ids[key], customer_name: p.name, customer_mobile: p.mobile, fulfillment: 'pickup', contents: [], state: 'succeeded', retries: 0, timeline: [],
      ...extra,
    }
  }
  const leoRule = auto('leo', { source: 'Office pre-order', rule: 'Office pre-order, Greenfield Tower', fulfillment: 'delivery', contents: [{ item_id: 'carbonara', quantity: 2 }, { item_id: 'nachos', quantity: 1 }] })
  const o1039 = await createAutomatedOrder(db, cat, leoRule, { orderNo: 1039, placedAt: ago(35 * MIN) })
  await walk(o1039.order_id, [['Accepted', ago(34 * MIN)], ['Preparing', ago(30 * MIN)], ['Ready', ago(20 * MIN)], ['Completed', ago(5 * MIN)]])

  const t40 = ago(12 * MIN)
  const o1040 = await appOrder(1040, 'jen', [{ item: 'choco-lava', options: ['Cold · 22 oz'] }, { item: 'potato-fries-plain' }], t40, 'counter')
  await walk(o1040, [], { eta: new Date(t40.getTime() + 10 * MIN) })

  const anaRule = auto('ana', { contents: [{ item_id: 'latte', options: ['Hot · 12 oz'], quantity: 1 }] })
  const o1041 = await createAutomatedOrder(db, cat, anaRule, { orderNo: 1041, placedAt: ago(15 * MIN) })
  await walk(o1041.order_id, [['Accepted', ago(14 * MIN)], ['Preparing', ago(12 * MIN)], ['Ready', ago(3 * MIN)]], { eta: ago(3 * MIN) })

  const t42 = ago(6 * MIN)
  const o1042 = await appOrder(
    1042, 'maria',
    [
      { item: 'caramel-macchiato', options: ['Cold · 22 oz', 'Regular milk'] },
      { item: 'carbonara' },
      { item: 'spanish-latte', options: ['Cold · 16 oz', 'Oat milk'], note: 'less ice' },
    ],
    t42, 'counter',
  )
  await walk(o1042, [['Accepted', ago(5 * MIN)], ['Preparing', ago(3 * MIN)]], { eta: new Date(now + 4 * MIN), readBefore: ago(4 * MIN) })

  // ---------- Maria's points and vouchers (C-20 to C-23): 1,240 pts, as in the prototype ----------
  const vouchers = must(
    await db
      .from('customer_reward')
      .insert([
        { customer_id: ids.maria, reward_id: 'free-drink', status: 'unused', redeemed_at: ago(2 * DAY).toISOString(), expires_on: new Date(now + 28 * DAY).toISOString() },
        { customer_id: ids.maria, reward_id: 'free-pastry', status: 'expired', redeemed_at: ago(45 * DAY).toISOString(), expires_on: ago(15 * DAY).toISOString() },
      ])
      .select(),
  ) as { customer_reward_id: string; reward_id: string }[]
  const balance = (must(await db.from('customer').select('points_balance').eq('customer_id', ids.maria).single()) as { points_balance: number }).points_balance
  const carried = 1240 - balance + 250 + 120
  const ledger = must(
    await db
      .from('points_txn')
      .insert([
        { customer_id: ids.maria, type: 'adjust', points: carried, description: 'Points from your MEGS stamp card' },
        { customer_id: ids.maria, type: 'redeem', points: -120, customer_reward_id: vouchers.find((v) => v.reward_id === 'free-pastry')!.customer_reward_id, description: 'Free snack' },
        { customer_id: ids.maria, type: 'redeem', points: -250, customer_reward_id: vouchers.find((v) => v.reward_id === 'free-drink')!.customer_reward_id, description: 'Free any drink' },
      ], { defaultToNull: false })
      .select('txn_id, type, points'),
  ) as { txn_id: number; type: string; points: number }[]
  for (const [txn, at] of [[ledger[0], ago(60 * DAY)], [ledger[1], ago(45 * DAY)], [ledger[2], ago(2 * DAY)]] as const)
    must(await db.from('points_txn').update({ created_at: at.toISOString() }).eq('txn_id', txn.txn_id))

  // An offer message, like the prototype's notification centre
  must(
    await db.from('notification').insert({
      customer_id: ids.maria,
      title: 'Free plain fries with any rice meal',
      body: 'Ends 30 Nov. Tap to see the offer.',
      deep_link: '/promotions/fries-with-rice-meal',
      created_at: ago(26 * 60 * MIN).toISOString(),
      read_at: ago(25 * 60 * MIN).toISOString(),
    }),
  )

  // ---------- Automated orders (A-05) ----------
  const tl = (...steps: [string, number][]) => steps.map(([label, m]) => ({ label, at: ago(m * MIN).toISOString() }))
  const row = (key: string, created: number, extra: Record<string, unknown>) => {
    const p = PEOPLE.find((x) => x.key === key)!
    return {
      cafe_id: cat.store.settings_id, source: 'Recurring order', rule: 'Weekday 8:00 recurring order', customer_id: ids[key],
      customer_name: p.name, customer_mobile: p.mobile, fulfillment: 'pickup', created_at: ago(created * MIN).toISOString(), ...extra,
    }
  }
  must(
    await db.from('automated_order').insert([
      row('paolo', 4, {
        source: 'Office pre-order', rule: 'Office pre-order, Greenfield Tower', fulfillment: 'delivery',
        contents: [{ item_id: 'ube-lava', options: ['Cold · 16 oz'], quantity: 2 }, { item_id: 'americano', options: ['Cold · 16 oz'], quantity: 1 }],
        state: 'failed', failure_reason: 'Ube Lava is sold out', error_code: 'ITEM_UNAVAILABLE', system_response: 'ITEM_UNAVAILABLE: Ube Lava',
        customer_message: 'Sorry, Ube Lava ran out for your office pre-order. The cafe will contact you.',
        timeline: tl(['Rule fired', 4], ['Checking items', 4], ['Failed: item unavailable', 4]),
      }),
      row('jen', 9, {
        contents: [{ item_id: 'spanish-latte', options: ['Hot · 12 oz'], quantity: 1 }],
        state: 'failed', failure_reason: 'The saved card has expired', error_code: 'PAYMENT_TOKEN_EXPIRED', system_response: 'PAYMENT_TOKEN_EXPIRED: card ending 7781',
        customer_message: "Payment for your recurring order didn't go through. You haven't been charged.",
        timeline: tl(['Rule fired', 9], ['Charging saved card', 9], ['Failed: payment token expired', 9]),
      }),
      row('carlo', 1, { contents: [{ item_id: 'latte', options: ['Hot · 12 oz'], quantity: 1 }], state: 'queued', timeline: tl(['Queued for 8:00', 1]) }),
      row('maria', 2, { contents: [{ item_id: 'caramel-macchiato', options: ['Cold · 16 oz'], quantity: 1 }], state: 'processing', timeline: tl(['Rule fired', 2], ['Charging saved card', 2]) }),
      row('leo', 35, {
        source: 'Office pre-order', rule: 'Office pre-order, Greenfield Tower', fulfillment: 'delivery',
        contents: leoRule.contents, state: 'succeeded', linked_order_id: o1039.order_id,
        customer_message: 'Your office pre-order #1039 is in. We will let you know when it is on the way.',
        timeline: tl(['Rule fired', 35], ['Charged saved card', 35], ['Order #1039 created', 35]),
      }),
      row('ana', 15, {
        contents: anaRule.contents, state: 'succeeded', linked_order_id: o1041.order_id, customer_message: 'Your recurring order #1041 is in.',
        timeline: tl(['Rule fired', 15], ['Charged saved card', 15], ['Order #1041 created', 15]),
      }),
    ], { defaultToNull: false }),
  )

  // New orders continue after the seeded numbers (#1043 next)
  must(await db.rpc('sync_order_no_seq'))
  return { customers: PEOPLE.length, orders: 7, automations: 6, mariaPoints: 1240 }
}
