// Manual smoke check against the REAL Google Maps (a few billable calls: 1 map load, ~2 geocodes,
// 1 Autocomplete session). Uses the key in .env.local through the dev server. Not part of npm test.
//
//   npm run dev   (in another terminal; local stack, functions serve and demo seed running)
//   node tests/e2e/maps-live-check.mjs [app URL, default http://localhost:5173/] [screenshot folder]
import { chromium } from '@playwright/test'
import { join } from 'node:path'

const BASE = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')
const OUT = process.argv[3] ?? '.'
const results = []
const check = (name, ok, detail = '') => {
  results.push(!!ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
const page = await context.newPage()
const googleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error' && /google|maps/i.test(m.text())) googleErrors.push(m.text().slice(0, 200))
})
const googleCalls = []
page.on('request', (r) => {
  const u = new URL(r.url())
  if (/googleapis\.com$/.test(u.hostname) && !u.hostname.startsWith('fonts')) googleCalls.push(`${u.hostname}${u.pathname}`)
})

try {
  await page.goto(BASE + '#/log-in')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(/#\/home/, { timeout: 20_000 })
  await page.goto(BASE + '#/address/new')
  await page.getByRole('heading', { level: 1, name: 'Pin your address' }).waitFor()

  const loaded = await Promise.race([
    page.locator('.map-picker__locate').waitFor({ timeout: 20_000 }).then(() => 'ready'),
    page.getByText("The map couldn't load").waitFor({ timeout: 20_000 }).then(() => 'problem'),
    page.getByText("The map isn't set up").waitFor({ timeout: 20_000 }).then(() => 'not-configured'),
  ]).catch(() => 'timeout')
  await page.waitForTimeout(2500) // gm_authFailure arrives shortly after load if the key is refused
  const refused = await page.getByText('Google Maps refused this request').isVisible()
  check('the real map loads with the key', loaded === 'ready' && !refused, refused ? 'key refused' : loaded)

  if (loaded === 'ready' && !refused) {
    const box = await page.locator('.map-picker__map').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.locator('#pin-status').getByText('Delivers here').waitFor({ timeout: 10_000 }).catch(() => {})
    check('tapping the map centre drops a pin that delivers', await page.locator('#pin-status').getByText('Delivers here').isVisible())
    const near = page.locator('#pin-status .pin-status__address')
    await near.waitFor({ timeout: 8000 }).catch(() => {})
    check('reverse geocoding fills the address', await near.isVisible(), (await near.textContent().catch(() => '')) ?? '')
    await page.screenshot({ path: join(OUT, 'live-pin.png') })

    const search = page.getByRole('combobox', { name: 'Search for your street or a landmark' })
    await search.fill('Bocaue Municipal Hall')
    const option = page.getByRole('option').first()
    await option.waitFor({ timeout: 10_000 }).catch(() => {})
    const options = await page.getByRole('option').allTextContents()
    check('Places search returns suggestions', options.length > 0, options.slice(0, 3).join(' | ').slice(0, 160))
    if (options.length) {
      await option.click()
      await page.waitForTimeout(1500)
      check('choosing a suggestion moves the pin', await page.getByText('Pin moved to that place').isVisible())
      await page.screenshot({ path: join(OUT, 'live-search.png') })
    }
  }
} finally {
  console.log('Google calls:', [...new Set(googleCalls)].join(', ') || 'none')
  if (googleErrors.length) console.log('Google console errors:\n  ' + [...new Set(googleErrors)].join('\n  '))
  await browser.close()
}
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
