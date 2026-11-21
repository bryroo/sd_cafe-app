// Address search and "what's at this pin", through the `geocode` Edge Function (OpenStreetMap Nominatim,
// cached and rate-limited on the server for every phone at once). Never called for guests.
import { callFunction } from './supabase'
import type { GeoPlace } from '../../supabase/functions/_shared/geocode'

export type { GeoPlace }

export type LookupError = { code: string; message: string }

export async function searchPlaces(q: string): Promise<{ places: GeoPlace[] } | { error: LookupError }> {
  const r = await callFunction<{ places: GeoPlace[] }>('geocode', { action: 'search', q })
  return r.error ? { error: r.error } : { places: r.data.places ?? [] }
}

export async function reversePlace(lat: number, lng: number): Promise<{ place: GeoPlace | null } | { error: LookupError }> {
  const r = await callFunction<{ place: GeoPlace | null }>('geocode', { action: 'reverse', lat, lng })
  return r.error ? { error: r.error } : { place: r.data.place ?? null }
}
