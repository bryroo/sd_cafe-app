// Address search and "what's at this pin", through the `geocode` Edge Function (OpenStreetMap Nominatim,
// cached and rate-limited on the server for every phone at once). Never called for guests.
// Heavy traffic is not an error: when the server says BUSY or RATE_LIMIT, or the phone is offline, the
// lookup waits (the server's retryAfter, else 1, 2, 4… up to 15 s; offline: until the connection is back)
// and asks again, for as long as the screen wants the answer. The screen keeps showing "loading" and is
// told once it has been waiting a while. Only real errors (a bad query, not signed in) come back.
import { callFunction, type FnError } from './supabase'
import type { GeoPlace } from '../../supabase/functions/_shared/geocode'

export type { GeoPlace }

export type LookupError = { code: string; message: string }
export type LookupOptions = {
  /** Stop waiting (a new search, the pin moved, the screen closed) */
  signal?: AbortSignal
  /** Called once the lookup has had to wait (show "busy, still trying") */
  onWaiting?: () => void
}

const RETRYABLE = new Set(['BUSY', 'RATE_LIMIT', 'OFFLINE', 'FAILED'])

class Aborted extends Error {}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Aborted())
    const t = window.setTimeout(done, ms)
    function done() {
      signal?.removeEventListener('abort', stop)
      resolve()
    }
    function stop() {
      window.clearTimeout(t)
      reject(new Aborted())
    }
    signal?.addEventListener('abort', stop, { once: true })
  })
}

function online(signal?: AbortSignal) {
  if (navigator.onLine) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const back = () => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }
    const stop = () => {
      window.removeEventListener('online', back)
      reject(new Aborted())
    }
    window.addEventListener('online', back, { once: true })
    signal?.addEventListener('abort', stop, { once: true })
  })
}

/** Calls the function until it answers, or fails for a reason waiting won't fix. null = aborted. */
async function patiently<T>(body: unknown, opts: LookupOptions): Promise<{ data: T } | { error: LookupError } | null> {
  let attempt = 0
  try {
    for (;;) {
      if (opts.signal?.aborted) return null
      const r = await callFunction<T>('geocode', body)
      if (opts.signal?.aborted) return null
      if (!r.error) return { data: r.data }
      const e = r.error as FnError & { retryAfter?: number }
      if (!RETRYABLE.has(e.code)) return { error: { code: e.code, message: e.message } }
      if (attempt === 0) opts.onWaiting?.()
      attempt++
      if (e.code === 'OFFLINE') await online(opts.signal)
      const wait = typeof e.retryAfter === 'number' && e.retryAfter > 0 ? e.retryAfter * 1000 : Math.min(15_000, 1000 * 2 ** (attempt - 1))
      // A little jitter so many phones don't all come back at the same instant
      await sleep(wait + Math.random() * 300, opts.signal)
    }
  } catch (err) {
    if (err instanceof Aborted) return null
    throw err
  }
}

export async function searchPlaces(q: string, opts: LookupOptions = {}): Promise<{ places: GeoPlace[] } | { error: LookupError } | null> {
  const r = await patiently<{ places: GeoPlace[] }>({ action: 'search', q }, opts)
  if (!r) return null
  return 'error' in r ? { error: r.error } : { places: r.data.places ?? [] }
}

export async function reversePlace(lat: number, lng: number, opts: LookupOptions = {}): Promise<{ place: GeoPlace | null } | { error: LookupError } | null> {
  const r = await patiently<{ place: GeoPlace | null }>({ action: 'reverse', lat, lng }, opts)
  if (!r) return null
  return 'error' in r ? { error: r.error } : { place: r.data.place ?? null }
}
