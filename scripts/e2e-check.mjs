// End-to-end check of the app against its database: a customer tab and a staff console tab side by side
// in real Chrome (DevTools protocol, no packages). Exercises sign-in, ordering, live status updates in
// both directions, points, rewards, cancelling with voucher restore, and the offline view.
//
//   node scripts/e2e-check.mjs [app URL]        default http://localhost:5174/
//
// Run against demo data (scripts/seed-demo.mjs first): it signs in as Maria and as staff and places
// real orders. Each check prints PASS or FAIL; the exit code is non-zero if anything failed.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.argv[2] ?? 'http://localhost:5174/').replace(/\/?$/, '/')
const PORT = 9336
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p))

const results = []
const check = (name, ok, detail = '') => {
  results.push(!!ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

/** One browser tab driven over its own DevTools socket */
async function tab(url) {
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then((r) => r.json())
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
  let n = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id)
      pending.delete(d.id)
      d.error ? p.rej(new Error(d.error.message)) : p.res(d.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++n
      pending.set(id, { res, rej })
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const api = {
    send,
    evaluate,
    go: async (hash) => {
      await send('Page.navigate', { url: BASE + hash })
      await sleep(1200)
    },
    text: () => evaluate('document.body.innerText'),
    /** Waits until the page text matches, up to `ms` */
    waitText: async (re, ms = 8000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        const t = await evaluate('document.body.innerText').catch(() => '')
        if (re.test(t)) return true
        await sleep(200)
      }
      return false
    },
    /** Clicks the first visible button or link whose text matches */
    click: (re) =>
      evaluate(`(() => {
        const re = ${re}
        const el = [...document.querySelectorAll('button, a, [role=button]')].find((b) => re.test(b.innerText.trim()) && !b.disabled && b.offsetParent !== null)
        if (!el) return false
        el.click()
        return true
      })()`),
    /** Types into an input found by its label text or placeholder */
    type: (label, value) =>
      evaluate(`(() => {
        const inputs = [...document.querySelectorAll('input, textarea')]
        const el = inputs.find((i) => (i.labels && [...i.labels].some((l) => l.innerText.includes(${JSON.stringify(label)}))) || i.placeholder === ${JSON.stringify(label)} || i.getAttribute('aria-label') === ${JSON.stringify(label)})
        if (!el) return false
        const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
        set.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`),
    /** Clicks once the button shows up (it may appear after a live update), up to `ms` */
    clickWhen: async (re, ms = 6000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (await api.click(re)) return true
        await sleep(250)
      }
      return false
    },
    /** The points balance as Home shows it ("1,240 pts · Regular") */
    points: async () => {
      await api.go('#/home')
      await sleep(800)
      return Number(((await api.text()).match(/([\d,]+) pts\s*Regular/) ?? [])[1]?.replace(/,/g, ''))
    },
    close: () => ws.close(),
  }
  await api.go(url)
  return api
}

const profile = mkdtempSync(join(tmpdir(), 'megs-e2e-'))
const chrome = spawn(browser, ['--headless=new', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })

try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false)) break
    await sleep(200)
  }

  /* ---------- Guest: the menu comes from the database ---------- */
  const shop = await tab('#/menu')
  check('Guests see the menu from the database', await shop.waitText(/Hazelnut[\s\S]*120\.00/), 'Hazelnut ₱120.00')

  /* ---------- Wrong staff password counts down to the lock (before anyone signs in: tabs share storage) ---------- */
  const staff = await tab('#/staff/login')
  const password = (pw) =>
    staff.evaluate(`(() => { const i = [...document.querySelectorAll('input')].find((x) => x.type === 'password'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(pw)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await staff.type('Username or email', 'barista')
  await password('wrong-password')
  await staff.click('/^Sign in$/')
  check('A wrong password says how many tries are left (FR-STF-01)', await staff.waitText(/4 attempts left/), '4 attempts left')

  /* ---------- Staff sign-in ---------- */
  await staff.type('Username or email', 'staff')
  await password('megs2026')
  await staff.click('/^Sign in$/')
  check('Staff sign in with username and password', await staff.waitText(/Rina Bautista[\s\S]*Dashboard/), 'Rina Bautista')
  check('Staff see the seeded queue', await staff.waitText(/#1040[\s\S]*Jen/), '#1040 from Jen')

  /* ---------- Customer sign-in (demo account) ---------- */
  const app = await tab('#/log-in')
  await app.click('/^Log in$/')
  check('Maria signs in with her mobile number', await app.waitText(/Hi, Maria/, 10000))
  check('Her live order comes from the database', await app.waitText(/Order #1042/), '#1042 Preparing')
  const pointsBefore = await app.points()
  check('Points balance from the ledger', pointsBefore === 1240, `${pointsBefore} pts`)

  /* ---------- Place an order (server prices it) while staff watch the queue ---------- */
  await staff.go('#/staff/orders')
  await app.evaluate(`localStorage.setItem('megs.cart', JSON.stringify([
    { key: 'e2e-1', productId: 'carbonara', options: [], note: '', unitPrice: 180, qty: 1 },
    { key: 'e2e-2', productId: 'spanish-latte', options: ['Cold · 16 oz'], note: '', unitPrice: 110, qty: 1 }
  ])); localStorage.setItem('megs.fulfillment', '"pickup"'); localStorage.setItem('megs.payment', '"Pay at counter"'); true`)
  await app.go('#/checkout')
  await app.evaluate('location.reload(); true')
  await sleep(2500)
  await app.click('/Place order/')
  const placed = await app.waitText(/Order #(\d+) placed/, 10000)
  const placedAt = Date.now()
  const orderNo = Number(((await app.text()).match(/Order #(\d+) placed/) ?? [])[1])
  check('Place order goes through the server', placed && orderNo >= 1043, `#${orderNo}`)

  /* ---------- It reaches the open staff queue within 5 s, live (FR-STF-04) ---------- */
  const arrived = await staff.waitText(new RegExp(`#${orderNo}`), 5000)
  check('The new order reaches the open staff queue within 5 s', arrived, `${((Date.now() - placedAt) / 1000).toFixed(1)} s`)

  /* ---------- Each staff step reaches the open tracking screen within 5 s (FR-TRK-02) ---------- */
  await app.go(`#/orders/tracking?n=${orderNo}`)
  await app.waitText(/We got your order/, 5000)
  await staff.go(`#/staff/orders/${orderNo}`)
  for (const [button, headline] of [
    ['Accept', /Order accepted/],
    ['Start preparing', /Preparing your order/],
    ['Mark ready', /Your order is ready/],
    ['Mark picked up', /Order completed/],
  ]) {
    const clicked = await staff.clickWhen(`/^${button}$/`)
    const at = Date.now()
    const followed = clicked && (await app.waitText(headline, 5000))
    check(`Staff "${button}" reaches the customer within 5 s`, followed, clicked ? `${((Date.now() - at) / 1000).toFixed(1)} s` : 'button not found')
    if (button === 'Accept') await sleep(1000)
  }

  /* ---------- Points credited on Completed (FR-LOY-01) ---------- */
  await sleep(1000)
  const pointsAfter = await app.points()
  check('Points credited when the order completed', pointsAfter > pointsBefore, `${pointsBefore} → ${pointsAfter}`)

  /* ---------- Redeem a reward (FR-LOY-05) ---------- */
  await app.go('#/rewards/free-pastry')
  await app.clickWhen('/^Redeem/')
  await sleep(700)
  // The confirmation dialog's own Redeem button
  await app.evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => /^Redeem$/.test(x.innerText.trim())).pop(); b && b.click(); return !!b })()`)
  const redeemed = await app.waitText(/Use it on your next order|View in My rewards/, 6000)
  const pointsRedeemed = await app.points()
  check('Redeeming spends the points and issues the voucher', redeemed && pointsRedeemed === pointsAfter - 120, `${pointsAfter} → ${pointsRedeemed}`)

  /* ---------- Cancel a new order while Received (FR-TRK-04) ---------- */
  await app.evaluate(`localStorage.setItem('megs.cart', JSON.stringify([{ key: 'e2e-3', productId: 'nachos', options: [], note: '', unitPrice: 180, qty: 1 }])); true`)
  await app.go('#/checkout')
  await app.evaluate('location.reload(); true')
  await sleep(2500)
  await app.click('/Place order/')
  await app.waitText(/Order #(\d+) placed/, 10000)
  const second = Number(((await app.text()).match(/Order #(\d+) placed/) ?? [])[1])
  await app.go(`#/orders/tracking?n=${second}`)
  await app.click('/^Cancel order$/')
  await sleep(600)
  await app.evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => /^Cancel order$/.test(x.innerText.trim())).pop(); b && b.click(); return !!b })()`)
  check('The customer cancels while the order is Received', await app.waitText(/Order cancelled/, 6000), `#${second}`)
  check('Staff see the cancellation', await (async () => {
    await staff.go('#/staff/orders?tab=Cancelled')
    return staff.waitText(new RegExp(`#${second}`), 6000)
  })())

  /* ---------- Database unreachable: the saved menu still shows (NFR-REL-04, 3.2.2.5) ---------- */
  await app.send('Network.setBlockedURLs', { urls: ['*:54321/*', '*.supabase.co/*'] })
  await app.go('#/menu')
  await app.evaluate('location.reload(); true')
  await sleep(3000)
  const cached = await app.text().catch(() => '')
  check('With the database unreachable, the menu shows from the saved copy', /Hazelnut/.test(cached))
  await app.send('Network.setBlockedURLs', { urls: [] })

  shop.close()
  staff.close()
  app.close()
} catch (e) {
  check('Run finished without errors', false, e.message)
} finally {
  chrome.kill()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
