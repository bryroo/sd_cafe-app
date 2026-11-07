import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const INK = '#141414'

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
        orientation: 'portrait',
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
        // Only the app's own files and the font are cached. API calls (Supabase) always go to the network,
        // so orders, points and availability are never stale.
        runtimeCaching: [
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
