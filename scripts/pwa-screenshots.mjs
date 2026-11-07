// Captures the two phone screenshots Android shows in the app's install sheet (manifest "screenshots",
// set in vite.config.ts) into public/screenshots/. Drives Chrome or Edge through the DevTools protocol
// for a true 390 x 844 phone at 2x (Node 22+ has the WebSocket this needs; no packages).
//
//   npm run build && npx vite preview --port 4173      (in one terminal)
//   node scripts/pwa-screenshots.mjs [http://localhost:4173/]
//
// The capture shows the cafe open whatever the time: the demo store's hours are set to all day in the
// throwaway browser profile only. Run again whenever Home or the Menu change noticeably.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = (process.argv[2] ?? 'http://localhost:4173/').replace(/\/?$/, '/')
const out = join(root, 'public', 'screenshots')
const PORT = 9333

const browser = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p))
if (!browser) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to one.')
  process.exit(1)
}

// `?demo=member` opens signed in, with the sample order
const shots = [
  { file: 'home.png', url: `${base}?demo=member#/home` },
  { file: 'menu.png', url: `${base}?demo=member#/menu` },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = mkdtempSync(join(tmpdir(), 'megs-shot-'))
const chrome = spawn(browser, [
  '--headless=new',
  '--hide-scrollbars',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' })

try {
  let target
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((ts) => ts.find((t) => t.type === 'page')).catch(() => undefined)
  }
  if (!target) throw new Error('The browser did not start')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let next = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true })
  // Open all day, before the app reads its saved store settings
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('megs.store', JSON.stringify({ acceptingOrders: true, hours: Array.from({ length: 7 }, () => ({ open: '00:00', close: '23:59', closed: false })) })) } catch {}`,
  })

  mkdirSync(out, { recursive: true })
  for (const s of shots) {
    await send('Page.navigate', { url: s.url })
    await sleep(3500) // fonts and photos
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(out, s.file), Buffer.from(data, 'base64'))
    console.log(`Saved public/screenshots/${s.file}`)
  }
  ws.close()
} finally {
  chrome.kill()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
