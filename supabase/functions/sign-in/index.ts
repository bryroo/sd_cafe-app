// sign-in: password sign-in with the lockout kept on the server (FR-ACC-06/07, FR-STF-01; DB_AUDIT.md
// findings 3, 4, 10). Before this, the app called the lockout RPCs itself, so anyone could lock any
// account out (login_failed), clear a lock (login_succeeded) or turn an email into its mobile number
// (customer_login_address). Here the lock is checked, the password is verified with Supabase Auth, and
// the failure or success is recorded, all server-side; the app only receives the session.
//
// Body: { identifier, password, audience: 'customer' | 'staff' }
// 200 { ok: true, session: { access_token, refresh_token } }
// 200 { ok: false, lockedUntil: ISO | null, left: number, notStaff?: true }
//
// Note: Supabase Auth rate-limits password sign-ins per IP. Every attempt now reaches Auth from this
// function, so check Dashboard -> Authentication -> Rate limits before launch.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { admin, cors, fail, isStaff, json } from '../_shared/server.ts'

type Audience = 'customer' | 'staff'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('METHOD', 'Use POST.', 405)

  const body = (await req.json().catch(() => null)) as { identifier?: unknown; password?: unknown; audience?: unknown } | null
  const identifier = typeof body?.identifier === 'string' ? body.identifier.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const audience = body?.audience as Audience
  if (!identifier || !password || (audience !== 'customer' && audience !== 'staff'))
    return fail('BAD_REQUEST', 'Enter your account and password.')
  if (identifier.length > 200 || password.length > 200) return fail('BAD_REQUEST', 'Enter your account and password.')

  const db = admin()
  const args = { p_identifier: identifier, p_audience: audience }

  // 1. Locked? Nothing is checked against Auth while the lock lasts.
  const locked = await db.rpc('login_locked_until', args)
  if (locked.error) return fail('FAILED', "Couldn't sign in. Try again.", 500)
  if (locked.data) return json({ ok: false, lockedUntil: locked.data, left: 0 })

  // 2. Mobile number, email or username -> the address Supabase Auth signs in with (never sent back)
  const address = await db.rpc(audience === 'staff' ? 'staff_login_address' : 'customer_login_address', { p_identifier: identifier })
  if (address.error) return fail('FAILED', "Couldn't sign in. Try again.", 500)

  // 3. Verify the password with a throwaway client (no session is stored here)
  let session: { access_token: string; refresh_token: string; user_id: string } | null = null
  if (address.data) {
    // A separate client, so the service client below keeps acting as the server, not as this user
    const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const auth = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await auth.auth.signInWithPassword({ email: address.data as string, password })
    if (!error && data.session) {
      session = { access_token: data.session.access_token, refresh_token: data.session.refresh_token, user_id: data.user.id }
    }
  }

  // 4. Record the result
  if (!session) {
    const f = await db.rpc('login_failed', args)
    const r = (f.data ?? {}) as { left?: number; locked_until?: string | null }
    return json({ ok: false, lockedUntil: r.locked_until ?? null, left: r.left ?? 0 })
  }
  await db.rpc('login_succeeded', args)

  // The staff console only signs in active staff; the session is ended, not handed over
  if (audience === 'staff' && !(await isStaff(db, session.user_id))) {
    await db.auth.admin.signOut(session.access_token).catch(() => undefined)
    return json({ ok: false, lockedUntil: null, left: 0, notStaff: true })
  }

  return json({ ok: true, session: { access_token: session.access_token, refresh_token: session.refresh_token } })
})
