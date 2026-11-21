// Manual smoke check against the REAL OpenStreetMap services: tiles from tile.openstreetmap.org and one
// search plus a pin lookup through the local `geocode` Edge Function (which calls Nominatim). A handful of
// requests, within the OSM usage policies; don't loop it. Not part of npm test.
//
//   npm run dev   (in another terminal; local stack, `npx supabase functions serve` and the demo seed)
//   node tests/e2e/osm-live-check.mjs [app URL, default http://localhost:5173/] [screenshot folder] [light|dark]
import { chromium } from '@playwright/test'
import { join } from 'node:path'

const BASE = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')
const OUT = process.argv[3] ?? '.'
const SCHEME = process.argv[4] === 'dark' ? 'dark' : 'light'
const results = []
const check = (name, ok, detail = '') => {
  results.push(!!ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: SCHEME, serviceWorkers: 'block' })
const page = await context.newPage()
let tiles = 0
let tileErrors = 0
page.on('response', (r) => {
  if (r.url().startsWith('https://tile.openstreetmap.org/')) r.ok() ? tiles++ : tileErrors++
})

try {
  await page.goto(BASE + '#/log-in')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(/#\/home/, { timeout: 20_000 })
  await page.goto(BASE + '#/address/new')
  await page.getByRole('heading', { level: 1, name: 'Pin your address' }).waitFor()
  await page.locator('.leaflet-tile-loaded').first().waitFor({ timeout: 20_000 }).catch(() => {})
  await page.locator('.map-picker .leaflet-overlay-pane path').waitFor({ timeout: 10_000 }).catch(() => {})
  check('OpenStreetMap tiles load', tiles > 0 && (await page.locator('.leaflet-tile-loaded').count()) > 0, `${tiles} tiles, ${tileErrors} errors`)
  check('the Bocaue outline is drawn', (await page.locator('.map-picker .leaflet-overlay-pane path').count()) === 1)

  const box = await page.locator('.map-picker__map').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.locator('#pin-status').getByText('Delivers here').waitFor({ timeout: 10_000 }).catch(() => {})
  check('tapping the map centre drops a pin that delivers', await page.locator('#pin-status').getByText('Delivers here').isVisible())
  const near = page.locator('#pin-status .pin-status__address')
  await near.waitFor({ timeout: 10_000 }).catch(() => {})
  check('the pin lookup fills the address (Nominatim)', await near.isVisible(), ((await near.textContent().catch(() => '')) ?? '').slice(0, 100))
  await page.screenshot({ path: join(OUT, `live-pin-${SCHEME}.png`) })

  await page.getByRole('searchbox', { name: 'Search for your street or a landmark' }).fill('Bocaue Municipal Hall')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const first = page.locator('.place-search__list button').first()
  await first.waitFor({ timeout: 15_000 }).catch(() => {})
  const found = await page.locator('.place-search__list button').allTextContents()
  check('search returns places (Nominatim)', found.length > 0, found[0]?.slice(0, 100) ?? '')
  if (found.length) {
    await first.click()
    await page.getByText('Pin moved to that place').waitFor({ timeout: 5000 }).catch(() => {})
    check('choosing a place moves the pin', await page.getByText('Pin moved to that place').isVisible())
    await page.screenshot({ path: join(OUT, `live-search-${SCHEME}.png`) })
  }
} finally {
  await browser.close()
}
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
