/// <reference types="google.maps" />
// Google Maps JavaScript API, loaded on demand by the address pin screen only (never by the catalog,
// guest pages or checkout), through Google's official loader. The browser key is restricted by HTTP
// referrer and API in Google Cloud; it is the only Google key the app has. Requests to Google are never
// cached by the service worker (no runtime route matches them).
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
/** Advanced Markers need a map id; Google's DEMO_MAP_ID works for development */
export const mapId = (import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined) || 'DEMO_MAP_ID'
export const mapsConfigured = !!key

export type MapsLibs = {
  maps: google.maps.MapsLibrary
  marker: google.maps.MarkerLibrary
  places: google.maps.PlacesLibrary
  geocoding: google.maps.GeocodingLibrary
}

/** Why the map can't show: each has its own message and a way to try again */
export type MapsProblem = 'not-configured' | 'offline' | 'refused' | 'failed'

export class MapsError extends Error {
  problem: MapsProblem
  constructor(problem: MapsProblem) {
    super(problem)
    this.problem = problem
  }
}

let loading: Promise<MapsLibs> | null = null
let optionsSet = false
const authListeners = new Set<() => void>()

// Google calls this when the key is refused (wrong referrer, API not enabled, billing or quota)
declare global {
  interface Window {
    gm_authFailure?: () => void
  }
}

export function onMapsRefused(listener: () => void) {
  authListeners.add(listener)
  return () => {
    authListeners.delete(listener)
  }
}

export function loadMaps(): Promise<MapsLibs> {
  if (!key) return Promise.reject(new MapsError('not-configured'))
  if (!navigator.onLine) return Promise.reject(new MapsError('offline'))
  if (!loading) {
    if (!optionsSet) {
      setOptions({ key, v: 'weekly', language: 'en', region: 'PH' })
      window.gm_authFailure = () => authListeners.forEach((l) => l())
      optionsSet = true
    }
    loading = Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('places'), importLibrary('geocoding')])
      .then(([maps, marker, places, geocoding]) => ({ maps, marker, places, geocoding }))
      .catch(() => {
        // Let "Try again" start over (a blocked script or a dropped connection)
        loading = null
        throw new MapsError(navigator.onLine ? 'failed' : 'offline')
      })
  }
  return loading
}

