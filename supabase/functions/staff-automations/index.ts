// staff-automations: the staff console's actions on automated orders (SRS 3.2.12, UC-10).
//   simulate  a standing rule fires now (demo): processing for a moment, then the live checks
//   retry     run a failed one's checks again (FR-AOM-04); a second failure keeps it Failed with the new reason
//   convert   staff take it as a manual order past the failed check (FR-AOM-04)
import { createAutomatedOrder, blocker, type AutomationRow } from '../_shared/automation.ts'
import { admin, caller, cors, fail, isStaff, json, loadCatalog } from '../_shared/server.ts'

/** Rules "Simulate automated order" takes turns with (the prototype's samples) */
const SIMULATED = [
  {
    mobile: '+639171234567',
    source: 'Recurring order',
    rule: 'Weekday 8:00 recurring order',
    fulfillment: 'pickup' as const,
    contents: [{ item_id: 'spanish-latte', options: ['Cold · 16 oz'], quantity: 1 }],
  },
  {
    mobile: '+639185550142',
    source: 'Office pre-order',
    rule: 'Office pre-order, Greenfield Tower',
    fulfillment: 'delivery' as const,
    contents: [
      { item_id: 'ube-lava', options: ['Cold · 16 oz'], quantity: 1 },
      { item_id: 'carbonara', quantity: 1 },
    ],
  },
]

const stamp = (label: string) => ({ label, at: new Date().toISOString() })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()
  const user = await caller(req, db)
  const staff = user && (await isStaff(db, user.id))
  if (!staff) return fail('STAFF_ONLY', 'Staff only.', 403)

  const { action, id } = (await req.json().catch(() => ({}))) as { action?: string; id?: string }
  const cat = await loadCatalog(db)

  async function process(a: AutomationRow, label: string) {
    const stop = blocker(cat, a)
    if (stop) {
      const { error } = await db
        .from('automated_order')
        .update({
          state: 'failed',
          failure_reason: stop.reason,
          error_code: stop.code,
          system_response: stop.message,
          retries: a.retries + (label === 'Retried by staff' ? 1 : 0),
          timeline: [...a.timeline, stamp(label), stamp(`Failed: ${stop.reason.toLowerCase()}`)],
        })
        .eq('automated_order_id', a.automated_order_id)
      if (error) throw error
      return { state: 'failed', reason: stop.reason }
    }
    const order = await createAutomatedOrder(db, cat, a)
    const { error } = await db
      .from('automated_order')
      .update({
        state: 'succeeded',
        failure_reason: null,
        error_code: null,
        system_response: null,
        linked_order_id: order.order_id,
        retries: a.retries + (label === 'Retried by staff' ? 1 : 0),
        customer_message: `Your ${a.rule.toLowerCase()} #${order.order_no} is in.`,
        timeline: [...a.timeline, stamp(label), stamp(`Order #${order.order_no} created`)],
      })
      .eq('automated_order_id', a.automated_order_id)
    if (error) throw error
    return { state: 'succeeded', orderNumber: order.order_no }
  }

  try {
    if (action === 'simulate') {
      const { count } = await db.from('automated_order').select('automated_order_id', { count: 'exact', head: true })
      const pick = SIMULATED[(count ?? 0) % SIMULATED.length]
      const { data: c } = await db.from('customer').select('customer_id, full_name').eq('mobile_no', pick.mobile).maybeSingle()
      const { data: a, error } = await db
        .from('automated_order')
        .insert({
          cafe_id: cat.store.settings_id,
          source: pick.source,
          rule: pick.rule,
          customer_id: c?.customer_id ?? null,
          customer_name: c?.full_name ?? 'Demo customer',
          customer_mobile: pick.mobile,
          fulfillment: pick.fulfillment,
          contents: pick.contents,
          state: 'processing',
          timeline: [stamp('Rule fired')],
        })
        .select()
        .single()
      if (error) throw error
      // The console shows it processing for a moment, as a real rule would (FR-AOM-01)
      await new Promise((r) => setTimeout(r, 2500))
      return json(await process(a as AutomationRow, 'Checks run'))
    }

    const { data: a } = await db.from('automated_order').select('*').eq('automated_order_id', id).maybeSingle()
    if (!a) return fail('NOT_FOUND', 'Automated order not found.', 404)
    // FR-AOM-04: retry and convert are for failed automated orders that haven't made an order yet
    if (a.state !== 'failed' || a.linked_order_id) return fail('NOT_FAILED', 'Only a failed automated order can be retried or converted.', 409)

    if (action === 'retry') return json(await process(a as AutomationRow, 'Retried by staff'))

    if (action === 'convert') {
      const order = await createAutomatedOrder(db, cat, a as AutomationRow, { anyway: true })
      await db
        .from('order_status_event')
        .update({ label: 'Order placed manually from a failed automation', actor_type: 'staff', staff_id: staff.staff_id, actor_name: staff.full_name })
        .eq('order_id', order.order_id)
        .eq('to_status', 'Received')
      const { error } = await db
        .from('automated_order')
        .update({
          linked_order_id: order.order_id,
          converted_by: staff.staff_id,
          converted_at: new Date().toISOString(),
          timeline: [...(a.timeline ?? []), stamp(`Converted to manual order #${order.order_no} by ${staff.full_name}`)],
        })
        .eq('automated_order_id', a.automated_order_id)
      if (error) throw error
      return json({ state: a.state, orderNumber: order.order_no })
    }
    return fail('BAD_REQUEST', 'Unknown action.')
  } catch (e) {
    console.error('staff-automations', e)
    return fail('FAILED', "Couldn't update. Try again.", 500)
  }
})
