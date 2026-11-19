import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const INK = '#141414'

/* ---------- Service worker: Supabase reads (network-first, per user) ----------
   Only GET /rest/v1/<table> reads are handled. Everything else (Auth and token refresh, Edge Functions,
   RPCs, Storage, Realtime websockets, and every POST/PATCH/DELETE/HEAD) matches no route and goes
   straight to the network. Workbox serialises these functions into the worker, so each one must be
   self-contained (no outside variables). */

// These run inside the service worker (DOM types come from tsconfig.node.json)
type SwMatch = { url: URL; request: Request }

/** A table read (GET /rest/v1/<table>, not an RPC) made by a signed-in user */
const userRead = ({ url, request }: SwMatch) => {
  if (request.method !== 'GET' || !url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/rest/v1/rpc/')) return false
  try {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const part = token.split('.')[1]
    const claims = part ? JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) : {}
    return typeof claims.sub === 'string' && claims.role === 'authenticated'
  } catch {
    return false
  }
}

/** The same reads made by a guest (catalog: menu, store hours, offers) */
const guestRead = ({ url, request }: SwMatch) => {
  if (request.method !== 'GET' || !url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/rest/v1/rpc/')) return false
  try {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const part = token.split('.')[1]
    const claims = part ? JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) : {}
    return !(typeof claims.sub === 'string' && claims.role === 'authenticated')
  } catch {
    return true
  }
}

/** Cache key: the URL plus who asked and the response shape, with no headers (so no token) stored */
const apiCacheKey = {
  cacheKeyWillBeUsed: async ({ request }: { request: Request }) => {
    let sub = ''
    try {
      const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const part = token.split('.')[1]
      const claims = part ? JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) : {}
      if (typeof claims.sub === 'string' && claims.role === 'authenticated') sub = claims.sub
    } catch {
      /* guest */
    }
    const url = new URL(request.url)
    url.searchParams.set('__megs_user', sub || 'guest')
    url.searchParams.set('__megs_accept', request.headers.get('Accept') ?? '')
    return url.href
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Progressive web app: the manifest and a service worker that precaches every built file, so the
    // installed app opens and browses offline from its first launch (NFR-REL-04). Registered from
    // src/state/pwa.ts; off in `npm run dev`.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: './',
        name: "MEGS' Cafe",
        short_name: "MEGS'",
        description: 'Order ahead for pickup at the counter, or have it delivered.',
        lang: 'en-PH',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['standalone'],
        // No orientation lock: tablets and desktops use the wide layout
        background_color: INK,
        theme_color: INK,
        categories: ['food', 'shopping'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the home-screen icon
        shortcuts: [
          { name: 'Menu', url: './#/menu', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'My orders', url: './#/orders', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Rewards', url: './#/rewards', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        // Shown in Android's install sheet (made by scripts/pwa-screenshots.mjs)
        screenshots: [
          { src: 'screenshots/home.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Home: your order, offers and favourites' },
          { src: 'screenshots/menu.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'The full MEGS menu' },
        ],
      },
      workbox: {
        // The whole app, including every menu photo (about 3 MB)
        globPatterns: ['**/*.{js,css,html,webp,png,svg,webmanifest}'],
        // Install-sheet screenshots are only for the store-style dialog
        globIgnores: ['screenshots/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // The app's files are precached. Supabase table reads are network-first (fresh whenever online;
        // the last copy after 3 s or offline), cached per user and cleared on sign-out
        // (src/state/caches.ts). Nothing else from Supabase is ever cached: see apiCacheKey above.
        runtimeCaching: [
          {
            urlPattern: userRead,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'megs-api-user',
              networkTimeoutSeconds: 3,
              plugins: [apiCacheKey],
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: guestRead,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'megs-api-public',
              networkTimeoutSeconds: 3,
              plugins: [apiCacheKey],
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // Relative paths, so the built app runs from any address (a domain root or a subfolder)
  base: './',
  // `npm run dev` also listens on the local network, so a phone on the same Wi-Fi can open it
  server: { host: true },
})
