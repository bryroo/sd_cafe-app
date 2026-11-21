// Delivery is Bocaue, Bulacan only for now. The barangay list helps the rider find the house; the pin
// decides whether we deliver. 19 barangays (PSA PSGC). Check the spelling against the PSGC list before launch.
export const DELIVERY_TOWN = 'Bocaue'
export const DELIVERY_AREA_LABEL = 'Bocaue, Bulacan'

export const BOCAUE_BARANGAYS = [
  'Antipona',
  'Bagumbayan',
  'Bambang',
  'Batia',
  'Biñang 1st',
  'Biñang 2nd',
  'Bolacan',
  'Bundukan',
  'Bunlo',
  'Caingin',
  'Duhat',
  'Igulot',
  'Lolomboy',
  'Poblacion',
  'Sulucan',
  'Taal',
  'Tambobong',
  'Turo',
  'Wakas',
] as const

/** Matches a Google or OSM place name to the list ("Tambubong" → "Tambobong", "Binang 1st" → "Biñang 1st") */
export function matchBarangay(name?: string): string | undefined {
  if (!name) return undefined
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
  const n = norm(name).replace(/^(barangay|brgy)/, '')
  return BOCAUE_BARANGAYS.find((b) => norm(b) === n) ?? (n === 'tambubong' ? 'Tambobong' : undefined)
}

/** Where the map opens before there's a pin (Bocaue poblacion) */
export const BOCAUE_CENTER = { lat: 14.7980, lng: 120.9260 }
