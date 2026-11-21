// Address search and "what's at this pin", straight from the customer's browser to OpenStreetMap Nominatim
// (https://nominatim.org). Nominatim refuses requests from Supabase's cloud servers (403), so lookups can't
// go through an Edge Function; each phone asks for itself. Never called for guests (the address screen is
// members only).
//
// Nominatim's usage policy, kept per phone:
//   * at most one request per second: every lookup goes through one queue, 1.1 s apart
//   * no search-as-you-type: the screen only searches when the person presses Search
//   * cache answers: kept in memory for this visit (not on the device), so a repeat costs nothing
//   * identify the app: browsers send the site as Referer; we can't set a User-Agent from a page
//   * show "© OpenStreetMap contributors" (the map does)
// Heavy traffic is not an error: 429 / 5xx answers and dropped connections wait (Retry-After, else 1, 2,
// 4… up to 15 s; offline: until the connection is back) and ask again, for as long as the screen wants the
// answer. The screen keeps showing "loading" and is told once it has been waiting a while.
import { cleanQuery, reverseKey, reverseUrl, searchKey, searchUrl, toPlace, validPoint, type Bounds, type GeoPlace } from '../../supabase/functions/_shared/geocode'

export type { GeoPlace }

export type LookupError = { code: string; message: string }
export type LookupOptions = {
  /** Stop waiting (a new search, the pin moved, the screen closed) */
  signal?: AbortSignal
  /** Called once the lookup has had to wait (show "busy, still trying") */
  onWaiting?: () => void
}

const FAILED: LookupError = {
  code: 'LOOKUP_FAILED',
  message: "Address lookup isn't working right now. Tap the map, or type the address.",
}

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

// One request at a time, at least 1.1 s apart, for this whole page
const GAP_MS = 1100
let queue: Promise<unknown> = Promise.resolve()
let lastAt = 0
function inTurn<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const next = queue.then(async () => {
    if (signal?.aborted) throw new Aborted()
    const wait = lastAt + GAP_MS - Date.now()
    if (wait > 0) await sleep(wait, signal)
    lastAt = Date.now()
    return run()
  })
  queue = next.catch(() => undefined)
  return next
}

const cache = new Map<string, unknown>()

type Outcome = { ok: true; body: unknown } | { ok: false; retry: boolean; retryAfter?: number; offline?: boolean }

async function fetchOnce(url: string, signal?: AbortSignal): Promise<Outcome> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal, referrerPolicy: 'strict-origin-when-cross-origin' })
    if (r.ok) return { ok: true, body: await r.json() }
    // Overloaded or throttling (429, 5xx): wait and ask again. Anything else (403 blocked, 400) won't fix itself.
    if (r.status === 429 || r.status >= 500) return { ok: false, retry: true, retryAfter: Number(r.headers.get('Retry-After')) || undefined }
    return { ok: false, retry: false }
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === 'AbortError') throw new Aborted()
    return { ok: false, retry: true, offline: !navigator.onLine }
  }
}

/** Asks Nominatim until it answers, or fails for a reason waiting won't fix. null = aborted. */
async function patiently(key: string, url: string, opts: LookupOptions): Promise<{ body: unknown } | { error: LookupError } | null> {
  if (cache.has(key)) return { body: cache.get(key) }
  let attempt = 0
  try {
    for (;;) {
      if (!navigator.onLine) {
        if (attempt === 0) opts.onWaiting?.()
        attempt++
        await online(opts.signal)
      }
      const r = await inTurn(() => fetchOnce(url, opts.signal), opts.signal)
      if (r.ok) {
        cache.set(key, r.body)
        return { body: r.body }
      }
      if (!r.retry) return { error: FAILED }
      if (attempt === 0) opts.onWaiting?.()
      attempt++
      if (r.offline) await online(opts.signal)
      const wait = r.retryAfter && r.retryAfter > 0 ? r.retryAfter * 1000 : Math.min(15_000, 1000 * 2 ** (attempt - 1))
      // A little jitter so many phones don't all come back at the same instant
      await sleep(wait + Math.random() * 300, opts.signal)
    }
  } catch (err) {
    if (err instanceof Aborted) return null
    throw err
  }
}

/** Places matching the text, in the Philippines, inside a box around the delivery area */
export async function searchPlaces(
  q: string,
  bounds: Bounds,
  opts: LookupOptions = {},
): Promise<{ places: GeoPlace[] } | { error: LookupError } | null> {
  const text = cleanQuery(q)
  if (!text) return { error: { code: 'BAD_REQUEST', message: 'Type at least 3 letters, like a street or a landmark.' } }
  const r = await patiently(searchKey(text), searchUrl(text, bounds), opts)
  if (!r) return null
  if ('error' in r) return r
  const items = Array.isArray(r.body) ? r.body : []
  return { places: items.map((i) => toPlace(i as Parameters<typeof toPlace>[0])).filter((p): p is GeoPlace => !!p) }
}

/** What's at the pin (street, barangay, town). The caller only asks for pins inside the delivery area. */
export async function reversePlace(
  lat: number,
  lng: number,
  opts: LookupOptions = {},
): Promise<{ place: GeoPlace | null } | { error: LookupError } | null> {
  if (!validPoint(lat, lng)) return { place: null }
  const r = await patiently(reverseKey(lat, lng), reverseUrl(lat, lng), opts)
  if (!r) return null
  if ('error' in r) return r
  return { place: toPlace(r.body as Parameters<typeof toPlace>[0]) }
}
