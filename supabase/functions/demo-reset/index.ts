// demo-reset: staff console Settings → "Reset demo data", and scripts/seed-demo.mjs.
// Staff only, and only while demo mode is on (store_settings.demo_mode), so it can't run once the
// cafe switches demo mode off for a real launch.
import { admin, caller, cors, fail, isStaff, json } from '../_shared/server.ts'
import { seedDemo } from './seed.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()
  const user = await caller(req, db)
  if (!user || !(await isStaff(db, user.id))) return fail('STAFF_ONLY', 'Staff only.', 403)
  const { data: on } = await db.rpc('demo_mode_on')
  if (!on) return fail('DEMO_OFF', 'Demo mode is off. Turn it on in Settings to reset the demo.', 409)
  try {
    return json(await seedDemo(db))
  } catch (e) {
    console.error('demo-reset', e)
    return fail('FAILED', `Couldn't reset the demo: ${(e as Error).message ?? e}`, 500)
  }
})
