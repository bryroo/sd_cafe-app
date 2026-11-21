// Lighthouse accessibility scores for the delivery screens, signed in as the demo customer. OpenStreetMap
// tiles come from tests/e2e/tile.png, so no request reaches OSM. Needs the e2e build served (see playwright.config.ts):
//
//   npx vite preview --outDir dist-e2e --port 4180 --host 127.0.0.1    (built with the e2e env)
//   node tests/e2e/lighthouse-a11y.mjs [minimum score, default 95]
import { chromium } from '@playwright/test'
import lighthouse from 'lighthouse'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:4180/'
const MIN = Number(process.argv[2] ?? 95)
const PORT = 9341
const TILE = readFileSync(join(import.meta.dirname, 'tile.png'))
const PAGES = ['#/address/new', '#/fulfillment', '#/cart', '#/profile/addresses']

const profile = mkdtempSync(join(tmpdir(), 'megs-lh-'))
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: [`--remote-debugging-port=${PORT}`],
  serviceWorkers: 'block',
  viewport: { width: 412, height: 823 },
})
await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: TILE }))
const page = context.pages()[0] ?? (await context.newPage())
await page.goto(BASE + '#/log-in')
await page.getByRole('button', { name: 'Log in' }).click()
await page.waitForURL(/#\/home/)
// A cart, and delivery chosen, so the review and fulfillment screens show the delivery state
await page.goto(BASE + '#/menu')
await page.locator('button[aria-label^="Add"]').first().click().catch(() => {})

let failed = 0
for (const p of PAGES) {
  const r = await lighthouse(BASE + p, {
    port: PORT,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['accessibility'],
    disableStorageReset: true,
    formFactor: 'mobile',
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
  })
  const score = Math.round((r.lhr.categories.accessibility.score ?? 0) * 100)
  const fails = Object.values(r.lhr.audits)
    .filter((a) => a.score === 0 && a.scoreDisplayMode === 'binary')
    .map((a) => a.id)
  const ok = score >= MIN
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${p}  accessibility ${score}${fails.length ? `  (failing: ${fails.join(', ')})` : ''}`)
}
await context.close()
rmSync(profile, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
