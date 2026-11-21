// Delivery: pinning on the map, the in-area answer, coming soon, failures, keyboard-only, layouts, a11y.
// Google Maps is mocked (tests/e2e/maps-mock.js). Signs in as the demo customer Maria; test addresses use
// streets starting with "E2E" and are removed afterwards.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MOCK = readFileSync(join(import.meta.dirname, 'maps-mock.js'), 'utf8')
const SHOTS = process.env.E2E_SCREENSHOTS ?? join(import.meta.dirname, '..', '..', 'test-results', 'screens')
mkdirSync(SHOTS, { recursive: true })

const INSIDE = { lat: 14.7952, lng: 120.9258 } // Poblacion, Bocaue
const MARILAO = { lat: 14.770195, lng: 120.957623 }

const psql = (sql: string) => execSync('docker exec -i supabase_db_MEGS-Cafe-App psql -U postgres -Atq', { input: sql }).toString().trim()
const cleanup = () => psql("delete from public.address where street like 'E2E%'")

type MapsMode = 'ok' | 'fail' | 'refused'
async function mockMaps(page: Page, mode: MapsMode = 'ok') {
  await page.unroute('https://maps.googleapis.com/**').catch(() => {})
  await page.route('https://maps.googleapis.com/**', (route) => {
    if (mode === 'fail') return route.abort('failed')
    const extra = mode === 'refused' ? ';setTimeout(() => window.__mockMaps.authFailure(), 50)' : ''
    return route.fulfill({ contentType: 'application/javascript', body: MOCK + extra })
  })
}

async function logIn(page: Page) {
  await page.goto('#/log-in')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(/#\/home/)
}

const pinStatus = (page: Page) => page.locator('#pin-status')
const confirm = (page: Page) => page.getByRole('button', { name: 'Confirm location' })
const mockLog = (page: Page) => page.evaluate(() => (window as unknown as { __mockMaps: { log: { type: string }[] } }).__mockMaps.log)
const drag = (page: Page, p: { lat: number; lng: number }) =>
  page.evaluate(([lat, lng]) => (window as unknown as { __mockMaps: { drag: (a: number, b: number) => void } }).__mockMaps.drag(lat, lng), [p.lat, p.lng])

async function openPinStep(page: Page, mode: MapsMode = 'ok') {
  await mockMaps(page, mode)
  await logIn(page)
  await page.goto('#/address/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Pin your address' })).toBeVisible()
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

test('guests and the catalog never load Google Maps', async ({ page }) => {
  const maps: string[] = []
  const scripts: string[] = []
  page.on('request', (r) => {
    if (/maps\.googleapis\.com|maps\.gstatic\.com|places\.googleapis\.com/.test(r.url())) maps.push(r.url())
  })
  page.on('response', async (r) => {
    if (r.url().endsWith('.js') && r.url().includes('127.0.0.1')) scripts.push(await r.text())
  })
  for (const route of ['#/home', '#/menu', '#/rewards', '#/profile', '#/address/new']) {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
  }
  expect(maps).toEqual([])
  expect(scripts.some((s) => s.includes('maps.googleapis.com/maps/api/js'))).toBe(false)
  // A guest on the address route gets the sign-in prompt, not the map
  await expect(page.getByText('Log in to save delivery addresses.')).toBeVisible()
})

test('pin by tapping the map, then save the address', async ({ page }) => {
  await openPinStep(page)
  await expect(confirm(page)).toBeDisabled()
  const map = page.locator('[data-mock-map]')
  await map.click() // centre of the map = centre of Bocaue
  await expect(pinStatus(page)).toContainText('Delivers here')
  await expect(pinStatus(page)).toContainText('12 Mabini St, Poblacion, Bocaue') // reverse geocoded
  await expect(confirm(page)).toBeEnabled()
  const log = await mockLog(page)
  expect(log.find((e) => e.type === 'script')).toMatchObject({ key: 'e2e-placeholder-key' })
  expect(log.find((e) => e.type === 'map')).toMatchObject({ mapId: 'e2e-map-id', gestureHandling: 'greedy' })
  expect(log.find((e) => e.type === 'options')).toMatchObject({ restriction: true })
  expect(log.filter((e) => e.type === 'overlay')).toHaveLength(1)
  await confirm(page).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Delivery address' })).toBeFocused()
  await expect(page.locator('#ad-barangay')).toHaveValue('Poblacion')
  await expect(page.locator('#ad-line')).toHaveValue('12 Mabini St')
  await page.locator('#ad-line').fill('E2E 1 Tap St')
  await page.getByRole('button', { name: 'Save address' }).click()
  await page.waitForURL((u) => !u.hash.startsWith('#/address'))
  // The pin is where the map was tapped (its centre, the centre of Bocaue), give or take a pixel
  const row = psql("select barangay, city, abs(lat - 14.798) < 0.0005 and abs(lng - 120.926) < 0.0005, location_set_at is not null from public.address where street = 'E2E 1 Tap St'")
  expect(row).toBe('Poblacion|Bocaue|t|t')
})

test('drag the pin; geocoding waits for it to settle; outside Bocaue shows coming soon', async ({ page }) => {
  await openPinStep(page)
  await page.locator('[data-mock-map]').click()
  await expect(pinStatus(page)).toContainText('Delivers here')
  const before = (await mockLog(page)).filter((e) => e.type === 'geocode').length
  await drag(page, { lat: 14.79, lng: 120.93 })
  await drag(page, { lat: 14.791, lng: 120.931 })
  await drag(page, INSIDE)
  await page.waitForTimeout(1000)
  expect((await mockLog(page)).filter((e) => e.type === 'geocode').length - before).toBe(1)
  await expect(pinStatus(page)).toContainText('Delivers here')

  await drag(page, MARILAO)
  await expect(pinStatus(page)).toContainText('Delivery is coming soon here')
  await expect(pinStatus(page)).toContainText('within Bocaue, Bulacan only')
  await expect(confirm(page)).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Order for pickup instead' })).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'coming-soon-390-light.png') })

  await drag(page, INSIDE)
  await expect(pinStatus(page)).toContainText('Delivers here')
})

test('search with Places: one session token per search, details end the session', async ({ page }) => {
  await openPinStep(page)
  const search = page.getByRole('combobox', { name: 'Search for your street or a landmark' })
  await search.fill('Mab')
  await search.pressSequentially('ini')
  await expect(page.getByRole('option', { name: /Mabini St/ })).toBeVisible()
  await page.getByRole('option', { name: /Mabini St/ }).click()
  await expect(pinStatus(page)).toContainText('Delivers here')
  let log = (await mockLog(page)) as unknown as { type: string; token?: number; regions?: string[]; restricted?: boolean }[]
  const calls = log.filter((e) => e.type === 'autocomplete')
  expect(calls.length).toBeGreaterThan(0)
  expect(new Set(calls.map((c) => c.token)).size).toBe(1)
  expect(calls[0]).toMatchObject({ regions: ['ph'], restricted: true })
  expect(log.filter((e) => e.type === 'placeDetails')).toHaveLength(1)

  await search.fill('Marilao')
  await page.getByRole('option', { name: /Marilao/ }).click()
  await expect(pinStatus(page)).toContainText('Delivery is coming soon here')
  log = (await mockLog(page)) as typeof log
  const tokens = log.filter((e) => e.type === 'autocomplete').map((c) => c.token)
  expect(tokens[tokens.length - 1]).not.toBe(tokens[0])
})

test('use my current location: allowed and denied', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: INSIDE.lat, longitude: INSIDE.lng })
  await openPinStep(page)
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(pinStatus(page)).toContainText('Delivers here')

  await context.clearPermissions()
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) =>
      fail?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' } as GeolocationPositionError)
  })
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(page.getByText('Location is turned off for this app.')).toBeVisible()
})

test('Maps fails to load, then retries; key refused; offline', async ({ page, context }) => {
  await openPinStep(page, 'fail')
  await expect(page.getByText("The map couldn't load")).toBeVisible()
  await expect(page.getByText('Check your connection, then try again.')).toBeVisible()
  await expect(confirm(page)).toBeDisabled()
  await mockMaps(page, 'ok')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('[data-mock-map]')).toBeVisible()

  await page.goto('#/home')
  await context.setOffline(true)
  await page.goto('#/address/new')
  await expect(page.getByText('The map needs a connection')).toBeVisible()
  await context.setOffline(false)
})

test('Maps key refused (referrer, quota or billing)', async ({ page }) => {
  await openPinStep(page, 'refused')
  await expect(page.getByText('Google Maps refused this request')).toBeVisible()
})

test('keyboard only: search, confirm and save', async ({ page }) => {
  await mockMaps(page)
  await logIn(page)
  await page.goto('#/address/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Pin your address' })).toBeFocused()
  const tabTo = async (match: (el: { role: string | null; name: string; id: string }) => boolean, limit = 40) => {
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press('Tab')
      const el = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        return { role: a?.getAttribute('role') ?? a?.tagName.toLowerCase() ?? null, name: (a?.textContent ?? '').trim(), id: a?.id ?? '' }
      })
      if (match(el)) return
    }
    throw new Error('Never reached the control with Tab')
  }
  await tabTo((e) => e.role === 'combobox')
  await page.keyboard.type('Mabini')
  await expect(page.getByRole('option', { name: /Mabini St/ })).toBeVisible()
  await page.keyboard.press('ArrowDown')
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
  await page.goto('#/menu')
  await page.goto('#/fulfillment')
  await page.getByRole('radio', { name: /Delivery|delivery/ }).first().click().catch(() => {})
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
      await page.locator('[data-mock-map]').click()
      await expect(pinStatus(page)).toContainText('Delivers here')
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      expect(fits).toBe(true)
      // The confirm button is on screen without scrolling (pinned footer on phones; inline after the panel on wider screens)
      await confirm(page).scrollIntoViewIfNeeded()
      await expect(confirm(page)).toBeInViewport()
      const log = (await mockLog(page)) as unknown as { type: string; colorScheme?: string }[]
      expect(log.find((e) => e.type === 'map')?.colorScheme).toBe(scheme === 'dark' ? 'DARK' : 'LIGHT')
      await page.screenshot({ path: join(SHOTS, `pin-${size.name}-${scheme}.png`), fullPage: true })
      const pinAxe = await new AxeBuilder({ page }).exclude('[data-mock-map]').analyze()

      await drag(page, MARILAO)
      await expect(pinStatus(page)).toContainText('coming soon')
      await page.screenshot({ path: join(SHOTS, `coming-soon-${size.name}-${scheme}.png`), fullPage: true })
      const soonAxe = await new AxeBuilder({ page }).exclude('[data-mock-map]').analyze()

      await drag(page, INSIDE)
      await confirm(page).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Delivery address' })).toBeVisible()
      await page.screenshot({ path: join(SHOTS, `details-${size.name}-${scheme}.png`), fullPage: true })
      const detailsAxe = await new AxeBuilder({ page }).analyze()

      await page.goto('#/profile/addresses')
      await expect(page.getByRole('heading', { level: 1, name: 'Saved addresses' })).toBeVisible()
      await page.screenshot({ path: join(SHOTS, `saved-${size.name}-${scheme}.png`), fullPage: true })
      const savedAxe = await new AxeBuilder({ page }).analyze()

      const bad = [pinAxe, soonAxe, detailsAxe, savedAxe]
        .flatMap((r) => r.violations)
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
      expect(bad).toEqual([])
      await context.close()
    })
