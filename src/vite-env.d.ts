/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build date (yyyy-mm-dd), set in vite.config.ts */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Google Maps browser key (restricted by referrer and API). Only the address screen uses it. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  /** Map ID for Advanced Markers; Google's DEMO_MAP_ID is used when unset */
  readonly VITE_GOOGLE_MAP_ID?: string
}
