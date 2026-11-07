// place-order: turns a customer's cart into an order (SRS 3.2.4, UC-04).
// The price charged is worked out here from the database, never taken from the app (FR-PRO-08).
// One idempotency key per checkout: a retry or double tap returns the same order (IR-08, NFR-REL-01).
// Payments are simulated until a gateway is chosen (TBD-04): test card 0002 is always declined.
import { computeTotals, isOpen, priceLine, type LineIn, type PricedLine } from '../_shared/pricing.ts'
import { admin, caller, cents, cors, fail, json, loadCatalog } from '../_shared/server.ts'

type Body = {
  idempotencyKey: string
  lines: LineIn[]
  fulfillment: 'pickup' | 'delivery'
  addressId?: string | null
  note?: string
  /** 'counter' or a payment_method id */
  payment: string
  promoCode?: string | null
  customerRewardId?: string | null
  /** The total the customer saw and confirmed, in pesos */
  expectedTotal: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('METHOD', 'Use POST.', 405)
  const db = admin()

  // 1. Who: a signed-in customer (FR-ACC-01: guests sign in before checkout)
  const user = await caller(req, db)
  if (!user) return fail('SIGN_IN', 'Sign in to place your order.', 401)
  const { data: customer } = await db
    .from('customer')
    .select('customer_id, full_name, mobile_no, tier_id')
    .eq('customer_id', user.id)
    .maybeSingle()
  if (!customer) return fail('SIGN_IN', 'Sign in to place your order.', 401)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return fail('BAD_REQUEST', 'The order could not be read.')
  }
  if (!UUID.test(body.idempotencyKey ?? '')) return fail('BAD_REQUEST', 'Missing order attempt id.')
  if (!Array.isArray(body.lines) || body.lines.length === 0) return fail('EMPTY_CART', 'Your cart is empty.')
  if (body.fulfillment !== 'pickup' && body.fulfillment !== 'delivery') return fail('BAD_REQUEST', 'Choose pickup or delivery.')
  if ((body.note ?? '').length > 140) return fail('BAD_REQUEST', 'The note for the cafe is limited to 140 characters.')

  // 2. A retry returns the order this attempt already made
  const { data: existing } = await db
    .from('orders')
    .select('order_no, eta, total, points_to_earn, customer_id')
    .eq('idempotency_key', body.idempotencyKey)
    .maybeSingle()
  if (existing) {
    if (existing.customer_id !== user.id) return fail('BAD_REQUEST', 'Missing order attempt id.')
    return json({ order: { number: existing.order_no, eta: existing.eta, total: existing.total / 100, points: existing.points_to_earn } })
  }

  const cat = await loadCatalog(db)
  const store = cat.store
  const now = Date.now()

  // 3. Can the cafe take it (IR-10, FR-CHK-11, FR-OPS-05, FR-CHK-06)
  if (!isOpen(store.accepting_orders, store.opening_hours, now))
    return fail('STORE_CLOSED', "We're not taking orders right now. Your cart is saved.", 409)
  if (body.fulfillment === 'delivery' && !store.delivery_enabled)
    return fail('DELIVERY_OFF', 'Delivery is off right now. Choose pickup.', 409)

  // 4. Every line checked against the menu and priced
  const lines: PricedLine[] = []
  for (const l of body.lines) {
    const r = priceLine(cat.items.get(l.itemId), { key: String(l.key), itemId: String(l.itemId), options: (l.options ?? []).map(String), qty: Number(l.qty), note: l.note ?? '' })
    if (!r.ok) return fail('ITEM_UNAVAILABLE', r.error, 409, { itemId: l.itemId })
    lines.push(r.line)
  }

  // Delivery address: one of the customer's saved addresses (FR-CHK-02)
  let address: Record<string, unknown> | null = null
  if (body.fulfillment === 'delivery') {
    if (!body.addressId) return fail('ADDRESS', 'Add a delivery address.')
    const { data: a } = await db.from('address').select('*').eq('address_id', body.addressId).eq('customer_id', user.id).maybeSingle()
    if (!a) return fail('ADDRESS', 'Add a delivery address.')
    address = {
      label: a.label,
      recipient_name: a.recipient_name,
      street: a.street,
      barangay: a.barangay,
      city: a.city,
      mobile_no: a.mobile_no,
      notes: a.notes,
    }
  }

  // Payment method (FR-CHK-06: pay at counter for pickup only)
  let payment: { method: 'card' | 'e_wallet' | 'counter'; payment_method_id: string | null; method_label: string; token: string | null }
  if (body.payment === 'counter') {
    if (body.fulfillment === 'delivery') return fail('PAYMENT', 'Pay at counter is for pickup orders. Choose a card or e-wallet.')
    payment = { method: 'counter', payment_method_id: null, method_label: 'Pay at counter', token: null }
  } else {
    const { data: m } = await db.from('payment_method').select('*').eq('method_id', body.payment).eq('customer_id', user.id).maybeSingle()
    if (!m) return fail('PAYMENT', 'Choose a payment method.')
    payment = {
      method: m.type,
      payment_method_id: m.method_id,
      method_label: m.type === 'card' ? `Card ending ${m.last4}` : m.wallet_name ?? 'E-wallet',
      token: m.provider_token,
    }
  }

  // Promo code, voucher, first order, offers already used
  const [{ data: used }, { count: earlier }] = await Promise.all([
    db.from('promotion_redemption').select('promotion_id').eq('customer_id', user.id),
    db.from('orders').select('order_id', { count: 'exact', head: true }).eq('customer_id', user.id).neq('status', 'Cancelled'),
  ])
  const usedIds = (used ?? []).map((u: { promotion_id: string }) => u.promotion_id)

  let promo = null
  if (body.promoCode) {
    const { data: p } = await db
      .from('promotion')
      .select('promotion_id, title, rule, starts_at, ends_at, is_one_time, code, usage_limit')
      .eq('code', body.promoCode.trim().toUpperCase())
      .eq('is_published', true)
      .maybeSingle()
    if (!p) return fail('PROMO_INVALID', "This code can't be used with your order.", 409)
    const { count: uses } = await db.from('promotion_redemption').select('redemption_id', { count: 'exact', head: true }).eq('promotion_id', p.promotion_id)
    if (p.usage_limit && (uses ?? 0) >= p.usage_limit) return fail('PROMO_INVALID', "This code can't be used with your order.", 409)
    promo = {
      offer: { id: p.promotion_id, title: p.title, rule: p.rule, startsAt: Date.parse(p.starts_at), endsAt: Date.parse(p.ends_at), isOneTime: p.is_one_time, code: p.code },
      used: usedIds.includes(p.promotion_id),
    }
  }

  let reward = null
  let voucher: { customer_reward_id: string; reward_id: string } | null = null
  if (body.customerRewardId) {
    const { data: v } = await db
      .from('customer_reward')
      .select('customer_reward_id, reward_id, status, expires_on')
      .eq('customer_reward_id', body.customerRewardId)
      .eq('customer_id', user.id)
      .maybeSingle()
    if (!v || v.status !== 'unused' || Date.parse(v.expires_on) <= now)
      return fail('REWARD_INVALID', "This reward can't be used with your order.", 409)
    voucher = v
    reward = cat.rewards.get(v.reward_id) ?? null
  }

  const tier = cat.tiers.get(customer.tier_id) ?? null
  const totals = computeTotals({
    lines,
    member: true,
    tier,
    offers: cat.offers,
    usedOfferIds: usedIds,
    isFirstOrder: (earlier ?? 0) === 0,
    promo,
    reward,
    fulfillment: body.fulfillment,
    deliveryFee: store.delivery_fee,
    pointsPerPeso: store.points_per_peso,
    now,
  })

  if (voucher && !totals.reward)
    return fail('REWARD_INVALID', `Add ${totals.rewardMissing ?? 'an eligible item'} to use this reward.`, 409)

  // 5. Prices or offers changed since the customer looked: nothing is charged, they see the new total
  if (totals.promoProblem || Math.abs(totals.total - Number(body.expectedTotal)) >= 0.005) {
    return fail('TOTAL_CHANGED', totals.promoProblem ?? 'Prices or offers changed. Check your new total, then place your order.', 409, { totals })
  }

  // 6. Simulated payment (test tokens; the provider is TBD-04)
  if (payment.token === 'tok_test_0002')
    return fail('PAYMENT_DECLINED', "Payment didn't go through. You haven't been charged.", 402)
  const ref = payment.method === 'counter' ? null : `PAY-TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  // 7. Everything in one transaction
  const eta = new Date(now + (body.fulfillment === 'delivery' ? store.delivery_eta_minutes : store.default_prep_minutes) * 60_000)
  const { data: order, error } = await db.rpc('create_order', {
    p: {
      idempotency_key: body.idempotencyKey,
      cafe_id: store.settings_id,
      customer_id: user.id,
      customer_name: customer.full_name,
      customer_mobile: customer.mobile_no,
      fulfillment: body.fulfillment,
      address_id: body.fulfillment === 'delivery' ? body.addressId : null,
      delivery_address: address,
      note: body.note?.trim() || null,
      subtotal: cents(totals.subtotal),
      tier_name: totals.tierName,
      tier_discount: cents(totals.discount),
      promotion_id: totals.offer?.id ?? null,
      promotion_label: totals.offer?.name ?? null,
      promo_discount: cents(totals.offer?.amount ?? 0),
      customer_reward_id: totals.reward ? voucher?.customer_reward_id : null,
      reward_name: totals.reward?.name ?? null,
      reward_discount: cents(totals.reward?.amount ?? 0),
      delivery_fee: cents(totals.deliveryFee),
      total: cents(totals.total),
      points_to_earn: totals.points,
      eta: eta.toISOString(),
      source: 'app',
      lines: lines.map((l) => ({
        item_id: l.itemId,
        item_name: l.name,
        unit_price: cents(l.unitPrice),
        quantity: l.qty,
        note: l.note,
        options: l.chosen.map((c) => ({ value_id: c.valueId ?? null, group_title: c.groupTitle, label: c.label, price: cents(c.price) })),
      })),
      payment: {
        method: payment.method,
        payment_method_id: payment.payment_method_id,
        method_label: payment.method_label,
        amount: cents(totals.total),
        status: payment.method === 'counter' ? 'pending' : 'authorized',
        provider_ref: ref,
      },
    },
  })
  if (error) {
    console.error('create_order failed', error)
    return fail('ORDER_FAILED', error.message || "We couldn't place your order. You haven't been charged.", 409)
  }

  // 8. What the confirmation screen needs
  return json({ order: { number: order.order_no, eta: order.eta, total: order.total / 100, points: order.points_to_earn } })
})
