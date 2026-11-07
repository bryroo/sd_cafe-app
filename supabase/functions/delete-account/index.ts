// delete-account: FR-ACC-11, NFR-SEC-07, SRS 3.8 "Deletion". The cafe keeps its order and payment
// records with the customer's name, phone and address removed; everything personal is deleted with the
// login (customer, addresses, payment methods, vouchers, points, notifications cascade from auth.users).
import { admin, caller, cors, fail, json } from '../_shared/server.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()
  const user = await caller(req, db)
  if (!user) return fail('SIGN_IN', 'Sign in first.', 401)
  const { data: customer } = await db.from('customer').select('customer_id').eq('customer_id', user.id).maybeSingle()
  if (!customer) return fail('NOT_A_CUSTOMER', 'Only customer accounts can be deleted here.', 403)

  // Anonymize the orders first; deleting the login then unlinks them (customer_id becomes null)
  // A delivery order must keep an address (constraint), so its address becomes a "removed" marker
  const [pickup, delivery] = await Promise.all([
    db.from('orders').update({ customer_name: 'Deleted customer', customer_mobile: '—', delivery_address: null })
      .eq('customer_id', user.id).eq('fulfillment', 'pickup'),
    db.from('orders').update({ customer_name: 'Deleted customer', customer_mobile: '—', delivery_address: { removed: true } })
      .eq('customer_id', user.id).eq('fulfillment', 'delivery'),
  ])
  if (pickup.error || delivery.error) return fail('FAILED', "Couldn't delete your account. Try again.", 500)
  await db.from('automated_order').update({ customer_name: 'Deleted customer', customer_mobile: null }).eq('customer_id', user.id)

  const { error } = await db.auth.admin.deleteUser(user.id)
  if (error) return fail('FAILED', "Couldn't delete your account. Try again.", 500)
  return json({ deleted: true })
})
