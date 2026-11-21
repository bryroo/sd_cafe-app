// geocode: address search and "what's at this pin" for the delivery address screen, using OpenStreetMap
// Nominatim. Signed-in, non-anonymous customers only (guests never reach delivery).
//   { action: 'search', q }        → { places: GeoPlace[] }   (Philippines, around the delivery area)
//   { action: 'reverse', lat, lng } → { place: GeoPlace | null }  (only for pins inside the delivery area)
// Nominatim's policy is kept here, for every phone at once: answers cached 30 days, at most one request
// per second app-wide, an identifying User-Agent, no search-as-you-type (the app searches on submit).
// Each person may make 30 lookups a minute. Results are hints: the delivery rule is PostGIS.
import { boundsOf, cleanQuery, reverseKey, reverseUrl, searchKey, searchUrl, toPlace, validPoint, type Bounds, type GeoPlace } from '../_shared/geocode.ts'
import { admin, caller, cors, fail, json } from '../_shared/server.ts'

// NOMINATIM_CONTACT (Supabase secret): a URL or email Nominatim can reach the operator at
const userAgent = () => `MEGS-Cafe-delivery/1.0 (${Deno.env.get('NOMINATIM_CONTACT') ?? 'contact not configured'})`

let bounds: Bounds | null = null

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('METHOD', 'Use POST.', 405)
  const db = admin()

  const user = await caller(req, db)
  if (!user || user.is_anonymous) return fail('SIGN_IN', 'Sign in to look up addresses.', 401)
  const { data: customer } = await db.from('customer').select('customer_id').eq('customer_id', user.id).maybeSingle()
  if (!customer) return fail('SIGN_IN', 'Sign in to look up addresses.', 401)

  const body = (await req.json().catch(() => null)) as { action?: unknown; q?: unknown; lat?: unknown; lng?: unknown } | null
  let key: string
  let url: string
  if (body?.action === 'search') {
    const q = cleanQuery(body.q)
    if (!q) return fail('BAD_REQUEST', 'Type at least 3 letters to search.')
    if (!bounds) {
      const { data, error } = await db.rpc('service_area_geojson')
      if (error || !data?.features?.length) return fail('LOOKUP_FAILED', "Address search isn't available right now. Tap the map instead.", 503)
      bounds = boundsOf(data)
    }
    key = searchKey(q)
    url = searchUrl(q, bounds)
  } else if (body?.action === 'reverse') {
    if (!validPoint(body.lat, body.lng)) return fail('BAD_REQUEST', 'That pin is not a valid location.')
    const lat = body.lat as number
    const lng = body.lng as number
    // Only pins we can deliver to need an address: nothing is sent to Nominatim for the rest
    const { data: inside } = await db.rpc('is_within_service_area', { p_lat: lat, p_lng: lng })
    if (inside !== true) return json({ place: null, outside: true })
    key = reverseKey(lat, lng)
    url = reverseUrl(lat, lng)
  } else {
    return fail('BAD_REQUEST', 'Unknown lookup.')
  }

  const answer = (response: unknown) =>
    body.action === 'search'
      ? json({ places: ((response as unknown[]) ?? []).map((i) => toPlace(i as never)).filter((p): p is GeoPlace => !!p) })
      : json({ place: toPlace(response as never) })

  // 1. Cached answer (still counts toward the person's limit)
  const { data: hit } = await db
    .from('geocode_cache')
    .select('response, fetched_at')
    .eq('cache_key', key)
    .gt('fetched_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .maybeSingle()
  if (hit) {
    const { data: slot } = await db.rpc('geocode_take_slot', { p_user: user.id, p_upstream: false })
    if (slot === 'user_limit') return fail('RATE_LIMIT', 'Too many lookups. Wait a minute, or type the address yourself.', 429)
    return answer(hit.response)
  }

  // 2. Nominatim, at most once a second for the whole app (one short wait, then "busy")
  let slot = (await db.rpc('geocode_take_slot', { p_user: user.id, p_upstream: true })).data
  if (slot === 'busy') {
    await new Promise((r) => setTimeout(r, 1200))
    slot = (await db.rpc('geocode_take_slot', { p_user: user.id, p_upstream: true })).data
  }
  if (slot === 'user_limit') return fail('RATE_LIMIT', 'Too many lookups. Wait a minute, or type the address yourself.', 429)
  if (slot !== 'ok') return fail('BUSY', 'Address lookup is busy. Try again in a moment.', 429)

  let response: unknown
  try {
    const r = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) {
      console.error('nominatim', r.status)
      return fail('LOOKUP_FAILED', "Address lookup isn't working right now. Tap the map, or type the address.", 502)
    }
    response = await r.json()
  } catch (e) {
    console.error('nominatim failed', e)
    return fail('LOOKUP_FAILED', "Address lookup isn't working right now. Tap the map, or type the address.", 502)
  }
  await db.from('geocode_cache').upsert({ cache_key: key, response, fetched_at: new Date().toISOString() })
  return answer(response)
})
