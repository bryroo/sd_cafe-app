// Loads the demo content into the database: Maria Santos and the other demo customers, orders #1027 to
// #1042, points and vouchers, and the six automated orders. The same as staff console → Settings →
// "Reset demo data": it signs in as a staff member and calls the demo-reset Edge Function, which works
// only while demo mode is on. Everything else in the database is left alone, except that the order
// queue and automated orders are cleared and store settings return to their defaults.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... node scripts/seed-demo.mjs
//
// Optional: STAFF_EMAIL (default staff@megscafe.ph), STAFF_PASSWORD (default megs2026).

const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
const key = process.env.SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY first.')
  process.exit(1)
}
const email = process.env.STAFF_EMAIL ?? 'staff@megscafe.ph'
const password = process.env.STAFF_PASSWORD ?? 'megs2026'

const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json())
if (!auth.access_token) {
  console.error(`Staff sign-in failed: ${auth.msg ?? auth.error_description ?? JSON.stringify(auth)}`)
  process.exit(1)
}

const started = Date.now()
const res = await fetch(`${url}/functions/v1/demo-reset`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
  body: '{}',
})
const out = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error(`Seeding failed (${res.status}): ${out.error?.message ?? JSON.stringify(out)}`)
  process.exit(1)
}
console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)} s:`, out)
console.log('Demo customer: 0917 123 4567 / password1')
