// Stand-ins for OpenStreetMap in the browser tests: map tiles come from tests/e2e/tile.png and Nominatim
// answers from the canned places below, so the tests never use OSM's servers
// (their usage policies forbid automated load). Every lookup is recorded for the assertions.
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TILE = readFileSync(join(import.meta.dirname, 'tile.png'))

export const INSIDE = { lat: 14.7952, lng: 120.9258 } // Poblacion, Bocaue
export const MARILAO = { lat: 14.770195, lng: 120.957623 }

// Nominatim's own answer format (jsonv2 with addressdetails)
const PLACES = [
  { lat: String(INSIDE.lat), lon: String(INSIDE.lng), display_name: 'Mabini Street, Poblacion, Bocaue, Bulacan, Central Luzon, 3018, Philippines', osm_type: 'way', osm_id: 1, address: { road: 'Mabini Street', quarter: 'Poblacion', town: 'Bocaue' } },
  { lat: String(MARILAO.lat), lon: String(MARILAO.lng), display_name: 'Marilao Town Plaza, Poblacion I, Marilao, Bulacan, Philippines', osm_type: 'node', osm_id: 2, address: { road: 'Town Plaza', quarter: 'Poblacion I', town: 'Marilao' } },
]
const STREET = { lat: '14.7949', lon: '120.92549', display_name: 'P. Burgos Street, Poblacion, Bocaue, Bulacan, Central Luzon, 3018, Philippines', osm_type: 'way', osm_id: 3, address: { road: 'P. Burgos Street', quarter: 'Poblacion', town: 'Bocaue' } }

/** busy-N: the first N tile requests or lookups fail as heavy traffic would (tiles dropped; lookups get 503
 *  and 429 with Retry-After: 1), then everything works. fail: Nominatim blocks us (403), which waiting won't fix. */
export type OsmMode = { tiles?: 'ok' | 'fail' | `busy-${number}`; lookup?: 'ok' | 'fail' | `busy-${number}` }
export type Lookup = { action: string; q?: string; lat?: number; lng?: number }

export async function mockOsm(page: Page, mode: OsmMode = {}) {
  const lookups: Lookup[] = []
  const tileRequests: string[] = []
  await page.unroute('https://tile.openstreetmap.org/**').catch(() => {})
  await page.unroute('https://nominatim.openstreetmap.org/**').catch(() => {})
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    tileRequests.push(route.request().url())
    const busyTiles = mode.tiles?.startsWith('busy-') ? Number(mode.tiles.slice(5)) : 0
    if (mode.tiles === 'fail' || tileRequests.length <= busyTiles) return route.abort('failed')
    return route.fulfill({ contentType: 'image/png', body: TILE })
  })
  await page.route('https://nominatim.openstreetmap.org/**', async (route) => {
    const u = new URL(route.request().url())
    const action = u.pathname.startsWith('/search') ? 'search' : 'reverse'
    lookups.push(
      action === 'search'
        ? { action, q: u.searchParams.get('q') ?? '' }
        : { action, lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lon')) },
    )
    const headers = { 'Access-Control-Allow-Origin': '*' }
    // Nominatim blocking us (as it does Supabase's servers): not something waiting fixes
    if (mode.lookup === 'fail') return route.fulfill({ status: 403, headers, body: 'Access blocked' })
    const busyLookups = mode.lookup?.startsWith('busy-') ? Number(mode.lookup.slice(5)) : 0
    if (lookups.length <= busyLookups)
      return route.fulfill({ status: lookups.length % 2 ? 503 : 429, headers: { ...headers, 'Retry-After': '1' }, body: 'Busy' })
    if (action === 'search') {
      const q = (u.searchParams.get('q') ?? '').toLowerCase()
      return route.fulfill({ headers, json: PLACES.filter((p) => p.display_name.toLowerCase().includes(q.split(' ')[0])) })
    }
    return route.fulfill({ headers, json: STREET })
  })
  return { lookups, tileRequests }
}
