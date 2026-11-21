/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build date (yyyy-mm-dd), set in vite.config.ts */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}
