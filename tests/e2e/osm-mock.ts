// Stand-ins for OpenStreetMap in the browser tests: map tiles come from tests/e2e/tile.png and the
// `geocode` Edge Function answers from the canned places below, so the tests never use OSM's servers
// (their usage policies forbid automated load). Every lookup is recorded for the assertions.
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TILE = readFileSync(join(import.meta.dirname, 'tile.png'))

export const INSIDE = { lat: 14.7952, lng: 120.9258 } // Poblacion, Bocaue
export const MARILAO = { lat: 14.770195, lng: 120.957623 }

const PLACES = [
  { ...INSIDE, label: 'Mabini Street, Poblacion, Bocaue, Bulacan, Central Luzon, 3018, Philippines', line: 'Mabini Street', area: 'Poblacion', town: 'Bocaue', osmId: 'osm:W1' },
  { ...MARILAO, label: 'Marilao Town Plaza, Poblacion I, Marilao, Bulacan, Philippines', line: 'Town Plaza', area: 'Poblacion I', town: 'Marilao', osmId: 'osm:N2' },
]

export type OsmMode = { tiles?: 'ok' | 'fail'; lookup?: 'ok' | 'fail' | 'rate-limit' }
export type Lookup = { action: string; q?: string; lat?: number; lng?: number }

/** Inside the delivery area, roughly (the real check is the server's) */
const roughlyInBocaue = (lat: number, lng: number) => lat > 14.765 && lat < 14.84 && lng > 120.91 && lng < 120.95

export async function mockOsm(page: Page, mode: OsmMode = {}) {
  const lookups: Lookup[] = []
  const tileRequests: string[] = []
  await page.unroute('https://tile.openstreetmap.org/**').catch(() => {})
  await page.unroute('**/functions/v1/geocode').catch(() => {})
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    tileRequests.push(route.request().url())
    return mode.tiles === 'fail' ? route.abort('failed') : route.fulfill({ contentType: 'image/png', body: TILE })
  })
  await page.route('**/functions/v1/geocode', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    const body = route.request().postDataJSON() as Lookup
    lookups.push(body)
    const headers = { 'Access-Control-Allow-Origin': '*' }
    if (mode.lookup === 'fail')
      return route.fulfill({ status: 502, headers, json: { error: { code: 'LOOKUP_FAILED', message: "Address lookup isn't working right now. Tap the map, or type the address." } } })
    if (mode.lookup === 'rate-limit')
      return route.fulfill({ status: 429, headers, json: { error: { code: 'RATE_LIMIT', message: 'Too many lookups. Wait a minute, or type the address yourself.' } } })
    if (body.action === 'search') {
      const q = (body.q ?? '').toLowerCase()
      return route.fulfill({ headers, json: { places: PLACES.filter((p) => p.label.toLowerCase().includes(q.split(' ')[0])) } })
    }
    const inside = roughlyInBocaue(body.lat ?? 0, body.lng ?? 0)
    return route.fulfill({
      headers,
      json: inside
        ? { place: { lat: 14.7949, lng: 120.92549, label: 'P. Burgos Street, Poblacion, Bocaue, Bulacan, Central Luzon, 3018, Philippines', line: 'P. Burgos Street', area: 'Poblacion', town: 'Bocaue', osmId: 'osm:W3' } }
        : { place: null, outside: true },
    })
  })
  return { lookups, tileRequests }
}
