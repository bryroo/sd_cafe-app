// Creates (or updates) the demo staff accounts: a Supabase Auth user with a hashed password, plus a
// staff_user row (SRS STAFF_USER, FR-STF-01). Staff can't be created through customer sign-up, so
// this is the way in. Safe to run again: existing accounts get their password and details reset.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... node scripts/create-staff.mjs
//
// The secret key bypasses Row Level Security: keep it in your shell or a git-ignored file, never in the app.
// These are demo credentials. Change the passwords (or delete the accounts) before a real launch.

const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY first.')
  process.exit(1)
}

const PASSWORD = process.env.STAFF_PASSWORD ?? 'megs2026'
const CAFE_ID = 1

const staff = [
  { username: 'staff', email: 'staff@megscafe.ph', full_name: 'Rina Bautista', role: 'staff' },
  { username: 'manager', email: 'manager@megscafe.ph', full_name: 'Paolo Reyes', role: 'manager' },
  { username: 'barista', email: 'barista@megscafe.ph', full_name: 'Joy Mendoza', role: 'staff' },
]

// New-style secret keys go in the apikey header only; legacy service_role JWTs also go in Authorization
const headers = {
  apikey: key,
  'Content-Type': 'application/json',
  ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }),
}

async function call(path, init = {}) {
  const res = await fetch(url + path, { ...init, headers: { ...headers, ...init.headers } })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body?.msg ?? body?.message ?? text}`)
  return body
}

async function findUser(email) {
  for (let page = 1; ; page++) {
    const { users } = await call(`/auth/v1/admin/users?page=${page}&per_page=200`)
    const hit = users.find((u) => u.email?.toLowerCase() === email)
    if (hit || users.length < 200) return hit
  }
}

for (const s of staff) {
  const attrs = {
    email: s.email,
    password: PASSWORD,
    email_confirm: true,
    // account_type 'staff' means the sign-up trigger does not make a customer row
    user_metadata: { account_type: 'staff', full_name: s.full_name },
  }
  let user = await findUser(s.email)
  if (user) {
    user = await call(`/auth/v1/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify(attrs) })
  } else {
    user = await call('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify(attrs) })
  }

  await call('/rest/v1/staff_user?on_conflict=staff_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      staff_id: user.id,
      username: s.username,
      email: s.email,
      full_name: s.full_name,
      role: s.role,
      cafe_id: CAFE_ID,
      is_active: true,
    }),
  })
  console.log(`${s.role.padEnd(7)}  ${s.username.padEnd(8)} ${s.email.padEnd(22)} ${s.full_name}`)
}
console.log(`\nPassword for all: ${PASSWORD === 'megs2026' ? 'megs2026 (demo default)' : '(the STAFF_PASSWORD you set)'}`)
