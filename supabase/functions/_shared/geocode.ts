// Address lookups with OpenStreetMap Nominatim (https://nominatim.org): request URLs, input checks and the
// answer's shape. Pure helpers (tested by geocode.test.ts), used by the app (src/lib/geocode.ts), which
// calls Nominatim from the browser: Nominatim refuses Supabase's cloud servers (403). Kept here so a server
// caller can share them again if lookups ever move behind a keyed provider.
// Nominatim's usage policy: at most 1 request per second, identify the app, cache the answers, show
// "© OpenStreetMap contributors", and no search-as-you-type (searches run when the person submits them).

export const NOMINATIM = 'https://nominatim.openstreetmap.org'

/** One place, in the shape the app uses */
export type GeoPlace = {
  lat: number
  lng: number
  /** Nominatim's full label, e.g. "Mabini Street, Poblacion, Bocaue, Bulacan, …" */
  label: string
  /** House number and street, when known */
  line?: string
  /** Barangay-level name (OSM quarter / suburb / village / neighbourhood) */
  area?: string
  /** Town or city */
  town?: string
  /** "osm:N123", "osm:W456" or "osm:R789" */
  osmId?: string
}

export type Bounds = { north: number; south: number; east: number; west: number }

/** Trimmed, single-spaced, printable, 3–120 characters; otherwise null */
export function cleanQuery(q: unknown): string | null {
  if (typeof q !== 'string') return null
  // deno-lint-ignore no-control-regex
  // eslint-disable-next-line no-control-regex
  const s = q.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length >= 3 && s.length <= 120 ? s : null
}

export function validPoint(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  )
}

/** Search limited to the Philippines and a box around the delivery area */
export function searchUrl(q: string, b: Bounds, pad = 0.02) {
  const p = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'ph',
    viewbox: [b.west - pad, b.north + pad, b.east + pad, b.south - pad].map((n) => n.toFixed(5)).join(','),
    bounded: '1',
    'accept-language': 'en',
  })
  return `${NOMINATIM}/search?${p}`
}

export function reverseUrl(lat: number, lng: number) {
  const p = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
    'accept-language': 'en',
  })
  return `${NOMINATIM}/reverse?${p}`
}

/** Pins about 1 m apart share an answer */
export const searchKey = (q: string) => `s:${q.toLowerCase()}`
export const reverseKey = (lat: number, lng: number) => `r:${lat.toFixed(5)},${lng.toFixed(5)}`

type NominatimItem = {
  lat?: string
  lon?: string
  display_name?: string
  osm_type?: string
  osm_id?: number
  address?: Record<string, string | undefined>
  error?: string
}

export function toPlace(item: NominatimItem | null | undefined): GeoPlace | null {
  if (!item || item.error || item.lat === undefined || item.lon === undefined) return null
  const lat = Number(item.lat)
  const lng = Number(item.lon)
  if (!validPoint(lat, lng)) return null
  const a = item.address ?? {}
  const line = [a.house_number, a.road ?? a.pedestrian ?? a.footway].filter(Boolean).join(' ') || undefined
  const type = item.osm_type?.[0]?.toUpperCase()
  return {
    lat,
    lng,
    label: item.display_name ?? '',
    line,
    area: a.quarter ?? a.suburb ?? a.village ?? a.neighbourhood ?? a.hamlet,
    town: a.town ?? a.city ?? a.municipality,
    osmId: type && item.osm_id ? `osm:${type}${item.osm_id}` : undefined,
  }
}

/** The bounding box of a GeoJSON (Multi)Polygon feature collection */
export function boundsOf(fc: { features: { geometry: { type: string; coordinates: unknown } }[] }): Bounds {
  let north = -90, south = 90, east = -180, west = 180
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [lng, lat] = c as number[]
      north = Math.max(north, lat)
      south = Math.min(south, lat)
      east = Math.max(east, lng)
      west = Math.min(west, lng)
    } else if (Array.isArray(c)) c.forEach(visit)
  }
  fc.features.forEach((f) => visit(f.geometry.coordinates))
  return { north, south, east, west }
}
