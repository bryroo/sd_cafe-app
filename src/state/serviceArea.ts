// The delivery service area (Bocaue for now), read once per session from service_area_geojson() so the
// map can outline it and say "Delivers here" or "Coming soon" while the pin moves. That instant answer
// is for the person only: the database decides (is_within_service_area, the address trigger,
// place-order and the orders guard). RPCs are never cached by the service worker.
import { useEffect, useState } from 'react'
import { db } from '../lib/supabase'

type Ring = [number, number][]
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
export type ServiceArea = {
  geojson: { type: 'FeatureCollection'; features: { type: 'Feature'; properties: { name: string; attribution: string }; geometry: Geometry }[] }
  /** Every polygon as rings of [lng, lat]; the first ring is the outline, the rest are holes */
  polygons: Ring[][]
  bounds: { north: number; south: number; east: number; west: number }
  names: string[]
}

let cached: Promise<ServiceArea> | null = null

export function loadServiceArea(): Promise<ServiceArea> {
  if (!cached) {
    cached = Promise.resolve(db().rpc('service_area_geojson')).then(({ data, error }) => {
      if (error || !data) throw new Error("Couldn't load the delivery area.")
      return toArea(data as ServiceArea['geojson'])
    })
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

export function toArea(geojson: ServiceArea['geojson']): ServiceArea {
  const polygons: Ring[][] = []
  for (const f of geojson.features) {
    if (f.geometry.type === 'Polygon') polygons.push(f.geometry.coordinates)
    else polygons.push(...f.geometry.coordinates)
  }
  let north = -90, south = 90, east = -180, west = 180
  for (const p of polygons)
    for (const [lng, lat] of p[0] ?? []) {
      north = Math.max(north, lat)
      south = Math.min(south, lat)
      east = Math.max(east, lng)
      west = Math.min(west, lng)
    }
  return { geojson, polygons, bounds: { north, south, east, west }, names: geojson.features.map((f) => f.properties.name) }
}

/** Ray casting: is the point inside the ring? */
function inRing(lat: number, lng: number, ring: Ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The app's instant answer (UX only). Points within centimetres of the line may differ from the server. */
export function coversPoint(area: ServiceArea, lat: number, lng: number) {
  return area.polygons.some(([outer, ...holes]) => inRing(lat, lng, outer) && !holes.some((h) => inRing(lat, lng, h)))
}

export function useServiceArea() {
  const [area, setArea] = useState<ServiceArea | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadServiceArea()
      .then((a) => live && (setArea(a), setFailed(false)))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [attempt])
  return { area, failed, retry: () => setAttempt((n) => n + 1) }
}
