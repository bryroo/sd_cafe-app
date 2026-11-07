// The app's connection to the MEGS' Cafe database (Supabase).
// The URL and the publishable key come from the environment (.env.local, Vercel project settings).
// The publishable key is public by design: Row Level Security decides what each person may read or write.
//
// The customer app and the staff console keep separate sessions, so Maria and a staff member can be
// signed in side by side in one browser (README demo), each with their own permissions.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const configured = !!url && !!key
if (!configured) console.error('MEGS: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set')

const clients: Partial<Record<'customer' | 'staff', SupabaseClient>> = {}

function client(role: 'customer' | 'staff') {
  return (clients[role] ??= createClient(url ?? 'http://localhost', key ?? 'missing', {
    auth: { storageKey: `megs-${role}-auth`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  }))
}

/** Which app this tab is: the staff console lives under #/staff */
export const isStaffTab = () => window.location.hash.startsWith('#/staff')

/** The client for this tab's app */
export const db = () => client(isStaffTab() ? 'staff' : 'customer')

export type FnError = { code: string; message: string; [k: string]: unknown }
export type FnResult<T> = { data: T; error: null } | { data: null; error: FnError }

/** Calls one of the cafe's Edge Functions as the signed-in person */
export async function callFunction<T>(name: string, body: unknown): Promise<FnResult<T>> {
  const { data: s } = await db().auth.getSession()
  try {
    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: key ?? '',
        'Content-Type': 'application/json',
        ...(s.session ? { Authorization: `Bearer ${s.session.access_token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) return { data: null, error: out.error ?? { code: 'FAILED', message: "Couldn't reach the cafe. Try again." } }
    return { data: out as T, error: null }
  } catch {
    return { data: null, error: { code: 'OFFLINE', message: "You're offline. Connect and try again." } }
  }
}

/** Customers sign in with an address made from their mobile number (spec section 3) */
export const loginAddress = (e164: string) => `${e164.replace(/\D/g, '')}@phone.megs.local`
