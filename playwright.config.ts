// Browser tests for delivery (tests/e2e). Runs a production build against the LOCAL Supabase stack.
// OpenStreetMap tiles and the geocode function are replaced by tests/e2e/osm-mock.ts, so no request reaches
// OSM servers. Needs the local stack, `npx supabase functions serve` and the demo seed.
//
//   E2E_SUPABASE_PUBLISHABLE_KEY=<local publishable key> npx playwright test
import { defineConfig } from '@playwright/test'

const port = 4180

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    // Route mocks don't see requests a service worker handles; the worker's rules are checked separately
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? '',
    },
  },
})
