// Delivery: pinning on the map (Leaflet + OpenStreetMap), the in-area answer, coming soon, failures,
// keyboard-only, layouts, accessibility. OSM tiles and the geocode function are mocked (osm-mock.ts).
// Signs in as the demo customer Maria; test addresses use streets starting with "E2E" and are removed after.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { INSIDE, mockOsm, type OsmMode } from './osm-mock'

const SHOTS = process.env.E2E_SCREENSHOTS ?? join(import.meta.dirname, '..', '..', 'test-results', 'screens')
mkdirSync(SHOTS, { recursive: true })

const psql = (sql: string) => execSync('docker exec -i supabase_db_MEGS-Cafe-App psql -U postgres -Atq', { input: sql }).toString().trim()
const cleanup = () => psql("delete from public.address where street like 'E2E%'")

async function logIn(page: Page) {
  await page.goto('#/log-in')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(/#\/home/)
}

const pinStatus = (page: Page) => page.locator('#pin-status')
const confirm = (page: Page) => page.getByRole('button', { name: 'Confirm location' })
const mapBox = (page: Page) => page.locator('.map-picker__map')
const marker = (page: Page) => page.locator('.leaflet-marker-icon.map-pin')
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search for your street or a landmark' })

async function openPinStep(page: Page, mode: OsmMode = {}) {
  const osm = await mockOsm(page, mode)
  await logIn(page)
  await page.goto('#/address/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Pin your address' })).toBeVisible()
  // The outline arrives from the database; wait for it so the pan limits are in place
  await expect(page.locator('.map-picker .leaflet-overlay-pane path')).toHaveCount(1)
  return osm
}

/** Drags the pin by (dx, dy) pixels with the mouse */
async function dragPin(page: Page, dx: number, dy: number) {
  const b = (await marker(page).boundingBox())!
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
}

async function search(page: Page, text: string, choose: RegExp) {
  await searchBox(page).fill(text)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('button', { name: choose }).click()
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

test('guests and the catalog never load the map or call address lookup', async ({ page }) => {
  const osmCalls: string[] = []
  const scripts: string[] = []
  page.on('request', (r) => {
    if (/tile\.openstreetmap\.org|nominatim|functions\/v1\/geocode/.test(r.url())) osmCalls.push(r.url())
  })
  page.on('response', async (r) => {
    if (r.url().endsWith('.js') && r.url().includes('127.0.0.1:4180')) scripts.push(await r.text())
  })
  for (const route of ['#/home', '#/menu', '#/rewards', '#/profile', '#/address/new']) {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
  }
  expect(osmCalls).toEqual([])
  expect(scripts.some((s) => s.includes('tile.openstreetmap.org'))).toBe(false)
  await expect(page.getByText('Log in to save delivery addresses.')).toBeVisible()
})

test('pin by tapping the map, then save the address', async ({ page }) => {
  const osm = await openPinStep(page)
  await expect(confirm(page)).toBeDisabled()
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
  expect(osm.tileRequests.length).toBeGreaterThan(0)
  await mapBox(page).click() // the centre of the map is the centre of Bocaue
  await expect(pinStatus(page)).toContainText('Delivers here')
  await expect(pinStatus(page)).toContainText('P. Burgos Street, Poblacion, Bocaue') // reverse lookup
  await expect(confirm(page)).toBeEnabled()
  await confirm(page).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Delivery address' })).toBeFocused()
  await expect(page.locator('#ad-barangay')).toHaveValue('Poblacion')
  await expect(page.locator('#ad-line')).toHaveValue('P. Burgos Street')
  await page.locator('#ad-line').fill('E2E 1 Tap St')
  await page.getByRole('button', { name: 'Save address' }).click()
  await page.waitForURL((u) => !u.hash.startsWith('#/address'))
  // The pin is where the map was tapped (its centre, the centre of Bocaue), give or take a pixel
  const row = psql("select barangay, city, abs(lat - 14.798) < 0.0005 and abs(lng - 120.926) < 0.0005, location_set_at is not null from public.address where street = 'E2E 1 Tap St'")
  expect(row).toBe('Poblacion|Bocaue|t|t')
})

test('drag the pin with the mouse; the lookup waits for it to settle', async ({ page }) => {
  const osm = await openPinStep(page)
  await mapBox(page).click()
  await expect(pinStatus(page)).toContainText('Delivers here')
  await expect.poll(() => osm.lookups.filter((l) => l.action === 'reverse').length).toBe(1)
  const before = await marker(page).boundingBox()
  await dragPin(page, 30, 0)
  await dragPin(page, 30, 0)
  await dragPin(page, -20, 20)
  const after = await marker(page).boundingBox()
  expect(Math.round(after!.x - before!.x)).toBeGreaterThan(30)
  await page.waitForTimeout(1000)
  expect(osm.lookups.filter((l) => l.action === 'reverse').length).toBe(2)
  await expect(pinStatus(page)).toContainText('Delivers here')
})

test('the pin moves with the arrow keys', async ({ page }) => {
  const osm = await openPinStep(page)
  await mapBox(page).click()
  await expect(pinStatus(page)).toContainText('Delivers here')
  await expect.poll(() => osm.lookups.filter((l) => l.action === 'reverse').length).toBe(1)
  const before = await marker(page).boundingBox()
  await marker(page).focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('ArrowDown')
  const after = await marker(page).boundingBox()
  expect(Math.round(after!.x - before!.x)).toBe(20)
  expect(Math.round(after!.y - before!.y)).toBe(4)
  await expect.poll(() => osm.lookups.filter((l) => l.action === 'reverse').length).toBe(2)
})

test('search on submit (no search-as-you-type); outside Bocaue shows coming soon', async ({ page }) => {
  const osm = await openPinStep(page)
  await searchBox(page).pressSequentially('Mabini')
  await page.waitForTimeout(800)
  expect(osm.lookups.filter((l) => l.action === 'search')).toHaveLength(0) // typing alone never searches
  await page.keyboard.press('Enter')
  await expect(page.getByText('1 place found')).toBeVisible()
  await expect(page.getByRole('button', { name: /Mabini Street/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(pinStatus(page)).toContainText('Delivers here')
  expect(osm.lookups.filter((l) => l.action === 'search')).toEqual([{ action: 'search', q: 'Mabini' }])

  await search(page, 'Marilao', /Town Plaza/)
  await expect(pinStatus(page)).toContainText('Delivery is coming soon here')
  await expect(pinStatus(page)).toContainText('within Bocaue, Bulacan only')
  await expect(confirm(page)).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Order for pickup instead' })).toBeVisible()
})

test('use my current location: allowed and denied', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: INSIDE.lat, longitude: INSIDE.lng })
  await openPinStep(page)
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(pinStatus(page)).toContainText('Delivers here')

  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) =>
      fail?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' } as GeolocationPositionError)
  })
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(page.getByText('Location is turned off for this app.')).toBeVisible()
})

test('map tiles fail, then retry; offline', async ({ page, context }) => {
  await openPinStep(page, { tiles: 'fail' })
  await expect(page.getByText("The map couldn't load")).toBeVisible()
  await expect(confirm(page)).toBeDisabled()
  await mockOsm(page, { tiles: 'ok' })
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText("The map couldn't load")).toBeHidden()
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText('The map needs a connection')).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('The map needs a connection')).toBeHidden()
})

test('address lookup down or rate-limited: the pin still works and the person is told', async ({ page }) => {
  await openPinStep(page, { lookup: 'fail' })
  await mapBox(page).click()
  await expect(pinStatus(page)).toContainText('Delivers here')
  await expect(page.getByText("Address lookup isn't working right now. Your pin is kept")).toBeVisible()
  await searchBox(page).fill('Mabini')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByText("Address lookup isn't working right now. Tap the map")).toBeVisible()
  await expect(confirm(page)).toBeEnabled()

  await mockOsm(page, { lookup: 'rate-limit' })
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByText('Too many lookups. Wait a minute')).toBeVisible()
})

test('keyboard only: search, choose, confirm and save', async ({ page }) => {
  await mockOsm(page)
  await logIn(page)
  await page.goto('#/address/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Pin your address' })).toBeFocused()
  const tabTo = async (match: (el: { tag: string; name: string; id: string; type: string }) => boolean, limit = 40) => {
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press('Tab')
      const el = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        return { tag: a?.tagName.toLowerCase() ?? '', name: (a?.textContent ?? '').trim(), id: a?.id ?? '', type: a?.getAttribute('type') ?? '' }
      })
      if (match(el)) return
    }
    throw new Error('Never reached the control with Tab')
  }
  await tabTo((e) => e.tag === 'input' && e.type === 'search')
  await page.keyboard.type('Mabini')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /Mabini Street/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(pinStatus(page)).toContainText('Delivers here')
  await tabTo((e) => e.name === 'Confirm location')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Delivery address' })).toBeFocused()
  await expect(page.locator('#ad-barangay')).toHaveValue('Poblacion')
  await tabTo((e) => e.id === 'ad-line')
  await page.keyboard.press('Control+A')
  await page.keyboard.type('E2E 2 Keyboard St')
  await tabTo((e) => e.name === 'Save address')
  await page.keyboard.press('Enter')
  await page.waitForURL((u) => !u.hash.startsWith('#/address'))
  expect(psql("select count(*) from public.address where street = 'E2E 2 Keyboard St' and lat is not null")).toBe('1')
})

test('delivery is blocked for an address without a pin; the cart is kept', async ({ page }) => {
  psql(`insert into public.address (customer_id, label, recipient_name, street, barangay, city, mobile_no)
        select customer_id, 'Other', 'Maria Santos', 'E2E 3 Old St', 'San Roque', 'Quezon City', '+639171234567'
        from public.customer where mobile_no = '+639171234567'`)
  await logIn(page)
  await page.goto('#/fulfillment')
  await page.getByRole('radio', { name: /Delivery/ }).first().click()
  await page.getByRole('radio', { name: /E2E 3 Old St/ }).click()
  await expect(page.getByText('has no pin yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled()
  await expect(page.getByText('Needs a pin').first()).toBeVisible()
})

const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
]
for (const size of SIZES)
  for (const scheme of ['light', 'dark'] as const)
    test(`layout ${size.name} ${scheme}: map, confirm in view, no sideways scroll, axe`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, serviceWorkers: 'block' })
      const page = await context.newPage()
      await openPinStep(page)
      await mapBox(page).click()
      await expect(pinStatus(page)).toContainText('Delivers here')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await confirm(page).scrollIntoViewIfNeeded()
      await expect(confirm(page)).toBeInViewport()
      // Dark mode inverts the light OSM tiles; light mode leaves them alone
      const filter = await page.locator('.leaflet-tile-pane').evaluate((el) => getComputedStyle(el).filter)
      expect(filter.includes('invert')).toBe(scheme === 'dark')
      await page.screenshot({ path: join(SHOTS, `pin-${size.name}-${scheme}.png`), fullPage: true })
      const pinAxe = await new AxeBuilder({ page }).analyze()

      await search(page, 'Marilao', /Town Plaza/)
      await expect(pinStatus(page)).toContainText('coming soon')
      await page.screenshot({ path: join(SHOTS, `coming-soon-${size.name}-${scheme}.png`), fullPage: true })
      const soonAxe = await new AxeBuilder({ page }).analyze()

      await search(page, 'Mabini', /Mabini Street/)
      await confirm(page).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Delivery address' })).toBeVisible()
      await page.screenshot({ path: join(SHOTS, `details-${size.name}-${scheme}.png`), fullPage: true })
      const detailsAxe = await new AxeBuilder({ page }).analyze()

      const bad = [pinAxe, soonAxe, detailsAxe]
        .flatMap((r) => r.violations)
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
      expect(bad).toEqual([])
      await context.close()
    })
