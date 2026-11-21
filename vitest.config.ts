// Unit tests (npm test). Browser tests in tests/e2e run with Playwright (npm run test:e2e), not here.
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'tests/e2e/**', 'dist-e2e/**'] },
})
