// Attacks delivery from outside the app: only HTTP, a person's token, and the public API. Every attempt that
// should fail must fail with the expected code; one honest in-area order must succeed.
// LOCAL STACK ONLY (it changes store hours for a moment and adds test rows). Needs the demo seed and
// `npx supabase functions serve`:
//
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<local> SUPABASE_SECRET_KEY=<local> node scripts/attack-delivery.mjs
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
const pub = process.env.SUPABASE_PUBLISHABLE_KEY
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !pub || !secret) {
  console.error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (local values).')
  process.exit(1)
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error('Refusing to run against anything but the local stack.')
  process.exit(1)
}

const psql = (sql) => execSync('docker exec -i supabase_db_MEGS-Cafe-App psql -U postgres -Atq', { input: sql }).toString().trim()
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function signIn(identifier, password) {
  const r = await fetch(`${url}/functions/v1/sign-in`, {
    method: 'POST',
    headers: { apikey: pub, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password, audience: 'customer' }),
  })
  const j = await r.json()
  if (!j.ok) throw new Error(`sign-in failed for ${identifier}`)
  return j.session.access_token
}
const asUser = (token) => createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })

async function placeOrder(token, body) {
  const r = await fetch(`${url}/functions/v1/place-order`, {
    method: 'POST',
    headers: { apikey: pub, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, code: j.error?.code ?? (j.order ? 'OK' : 'UNKNOWN'), body: j }
}

// Store open around the clock for the run, restored afterwards
const hours = psql('select opening_hours::text || chr(31) || accepting_orders::text from public.store_settings where settings_id = 1').split('\x1f')
psql(`update public.store_settings set accepting_orders = true, delivery_enabled = true,
  opening_hours = (select jsonb_agg(jsonb_build_object('open','00:00','close','23:59','closed',false)) from generate_series(1,7)) where settings_id = 1`)

const created = []
try {
  const maria = await signIn('09171234567', 'password1')
  const leo = await signIn('09195550177', 'password1')
  const mariaDb = asUser(maria)
  const mariaId = JSON.parse(Buffer.from(maria.split('.')[1], 'base64url')).sub
  const leoId = JSON.parse(Buffer.from(leo.split('.')[1], 'base64url')).sub

  const { data: own } = await mariaDb.from('address').select('address_id').eq('is_default', true).single()
  const { data: card } = await mariaDb.from('payment_method').select('method_id').eq('last4', '4242').single()
  const { data: leoAddr } = await admin.from('address').select('address_id').eq('customer_id', leoId).limit(1).single()
  const { data: item } = await admin.from('menu_item').select('item_id').eq('is_available', true).eq('is_active', true).eq('kind', 'food').limit(1).single()

  // Test addresses for Maria: an old one with no pin, and one pinned in Marilao. The Marilao one can only be
  // written with the area trigger off (it stands for a pin saved before an area changed).
  const { data: legacy } = await admin.from('address')
    .insert({ customer_id: mariaId, label: 'Other', recipient_name: 'Maria Santos', street: '1 Old St', barangay: 'San Roque', city: 'Quezon City', mobile_no: '+639171234567' })
    .select('address_id').single()
  created.push(legacy.address_id)
  const outside = psql(`alter table public.address disable trigger address_check_area;
    insert into public.address (customer_id, label, recipient_name, street, barangay, city, mobile_no, lat, lng)
      values ('${mariaId}', 'Other', 'Maria Santos', '9 Test St', 'Abangan', 'Marilao', '+639171234567', 14.770195, 120.957623) returning address_id;
    alter table public.address enable trigger address_check_area;`).split('\n')[0]
  created.push(outside)

  const base = (over) => ({
    idempotencyKey: crypto.randomUUID(),
    lines: [{ key: 'l1', itemId: item.item_id, options: [], qty: 1 }],
    fulfillment: 'delivery',
    addressId: own.address_id,
    payment: card.method_id,
    expectedTotal: 0,
    ...over,
  })

  // 1. Guests and forged callers
  let r = await placeOrder(null, base())
  check('no token: refused', r.code === 'SIGN_IN', `${r.status} ${r.code}`)
  r = await placeOrder(pub, base())
  check('publishable key as the bearer (guest): refused', r.code === 'SIGN_IN', `${r.status} ${r.code}`)
  r = await placeOrder(maria.slice(0, -4) + 'AAAA', base())
  check('tampered token: refused', r.code === 'SIGN_IN', `${r.status} ${r.code}`)

  // 2. An anonymous Auth user (marked anonymous in auth.users, as anonymous sign-in would make it)
  const email = `anon-${Date.now()}@test.local`
  const { data: anonUser } = await admin.auth.admin.createUser({
    email, password: 'anon-pass-123', email_confirm: true,
    user_metadata: { account_type: 'customer', full_name: 'Anon Test', mobile_no: `+6399${String(Date.now()).slice(-8)}`, terms_accepted: true },
  })
  psql(`update auth.users set is_anonymous = true where id = '${anonUser.user.id}'`)
  const anonClient = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: anonSession } = await anonClient.auth.signInWithPassword({ email, password: 'anon-pass-123' })
  const anonToken = anonSession.session.access_token
  check('the anonymous token carries is_anonymous', JSON.parse(Buffer.from(anonToken.split('.')[1], 'base64url')).is_anonymous === true)
  r = await placeOrder(anonToken, base({ addressId: own.address_id }))
  check('anonymous user places an order: refused', r.code === 'SIGN_IN', `${r.status} ${r.code}`)
  const anonDb = asUser(anonToken)
  const ins = await anonDb.from('address').insert({ customer_id: anonUser.user.id, recipient_name: 'x', street: 'x', barangay: 'Poblacion', city: 'Bocaue', lat: 14.7949, lng: 120.9255 }).select()
  check('anonymous user saves an address: refused by RLS', !!ins.error, ins.error?.code)
  await admin.auth.admin.deleteUser(anonUser.user.id)

  // 3. Someone else's address
  r = await placeOrder(maria, base({ addressId: leoAddr.address_id }))
  check("Maria orders delivery to Leo's address: refused", r.code === 'ADDRESS', `${r.status} ${r.code}`)
  r = await placeOrder(maria, base({ addressId: "' or 1=1 --" }))
  check('malformed address id: refused', r.code === 'ADDRESS', `${r.status} ${r.code}`)
  const peek = await mariaDb.from('address').select('address_id').eq('address_id', leoAddr.address_id)
  check("Maria reads Leo's address over the API: nothing", (peek.data ?? []).length === 0)

  // 4. Out of area, with and without fake coordinates in the body
  r = await placeOrder(maria, base({ addressId: outside }))
  check('pinned in Marilao: refused', r.code === 'OUT_OF_AREA', `${r.status} ${r.code}`)
  r = await placeOrder(maria, base({ addressId: outside, lat: 14.7949, lng: 120.9255, inArea: true, deliveryAddress: { lat: 14.7949, lng: 120.9255 } }))
  check('Marilao address with Bocaue coordinates and an "inArea" flag in the body: still refused', r.code === 'OUT_OF_AREA', `${r.status} ${r.code}`)
  r = await placeOrder(maria, base({ addressId: legacy.address_id }))
  check('unpinned old address: refused', r.code === 'ADDRESS_NEEDS_PIN', `${r.status} ${r.code}`)
  const move = await mariaDb.from('address').update({ lat: 14.5896, lng: 120.9817 }).eq('address_id', own.address_id).select()
  check('Maria moves her pin to Manila over the API: refused', !!move.error, move.error?.message?.slice(0, 40))

  // 5. Going around the ordering service
  const direct = await mariaDb.from('orders').insert({ idempotency_key: crypto.randomUUID(), cafe_id: 1, customer_name: 'x', customer_mobile: 'x', fulfillment: 'delivery', delivery_address: { lat: 14.77, lng: 120.95 }, subtotal: 0, delivery_fee: 2500, total: 2500, eta: new Date().toISOString() }).select()
  check('direct insert into orders: refused', !!direct.error, direct.error?.code)
  const rpc = await mariaDb.rpc('create_order', { p: {} })
  check('direct create_order() call: refused', !!rpc.error, rpc.error?.code)
  const guest = createClient(url, pub, { auth: { persistSession: false } })
  const area = await guest.rpc('is_within_service_area', { p_lat: 14.79, p_lng: 120.92 })
  check('guest calls is_within_service_area: refused', !!area.error, area.error?.code)

  // 6. The honest order still works (first call learns the total, second places it)
  r = await placeOrder(maria, base())
  const total = r.body?.error?.totals?.total
  r = await placeOrder(maria, base({ expectedTotal: total }))
  check('in-area delivery with her own pinned address: placed', r.code === 'OK', `${r.status} ${r.code} #${r.body?.order?.number ?? ''}`)
  if (r.code === 'OK') {
    const snap = psql(`select delivery_address->>'lat', delivery_address->>'lng' from public.orders where order_no = ${r.body.order.number}`)
    check('the order keeps a snapshot of the pin', snap.startsWith('14.79'), snap.replace('|', ', '))
  }
} finally {
  for (const id of created) await admin.from('address').delete().eq('address_id', id)
  psql(`update public.store_settings set opening_hours = '${hours[0].replace(/'/g, "''")}'::jsonb, accepting_orders = ${hours[1] === 't'} where settings_id = 1`)
}

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
