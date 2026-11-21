// The app's instant "Delivers here" must agree with the database on the same real points
// (supabase/tests/database/03_service_area.test.sql). The fixture is service_area_geojson() from the local
// stack; regenerate it if the boundary changes:
//   docker exec supabase_db_MEGS-Cafe-App psql -U postgres -Atc "select public.service_area_geojson()" > src/state/__fixtures__/service-area.json
import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/service-area.json'
import { coversPoint, toArea, type ServiceArea } from './serviceArea'
import { matchBarangay } from '../data/bocaue'

const area = toArea(fixture as unknown as ServiceArea['geojson'])

const inside: [string, number, number][] = [
  ['centre of Bocaue', 14.798, 120.926],
  ['Poblacion', 14.7949017, 120.9254911],
  ['Lolomboy', 14.7811638, 120.9353354],
  ['Turo', 14.8081205, 120.9424684],
  ['Batia', 14.830117, 120.9442824],
  ['Balagtas border, 50 m in', 14.801435, 120.913489],
  ['Bulakan border, 50 m in', 14.774732, 120.910191],
  ['Marilao border, 50 m in', 14.77423, 120.939901],
  ['Meycauayan border, 50 m in', 14.765415, 120.91865],
  ['Pandi border, 50 m in', 14.837179, 120.940415],
  ['Santa Maria border, 50 m in', 14.81446, 120.942228],
]
const outside: [string, number, number][] = [
  ['Balagtas, 50 m out', 14.801853, 120.912666],
  ['Bulakan, 50 m out', 14.773979, 120.909678],
  ['Marilao, 50 m out', 14.773513, 120.940659],
  ['Meycauayan, 50 m out', 14.764623, 120.918204],
  ['Pandi, 50 m out', 14.837848, 120.93979],
  ['Santa Maria, 50 m out', 14.814023, 120.943065],
  ['middle of Marilao', 14.770195, 120.957623],
  ['Manila City Hall', 14.5896, 120.9817],
  ['Cebu City', 10.3157, 123.8854],
]

describe('service area (client hint)', () => {
  it('has bounds around Bocaue', () => {
    expect(area.bounds.south).toBeGreaterThan(14.7)
    expect(area.bounds.north).toBeLessThan(14.9)
    expect(area.names).toEqual(['Bocaue, Bulacan'])
  })
  it.each(inside)('delivers to %s', (_n, lat, lng) => expect(coversPoint(area, lat, lng)).toBe(true))
  it.each(outside)('does not deliver to %s', (_n, lat, lng) => expect(coversPoint(area, lat, lng)).toBe(false))
})

describe('barangay names', () => {
  it('matches Google and OSM spellings', () => {
    expect(matchBarangay('Tambubong')).toBe('Tambobong')
    expect(matchBarangay('Binang 1st')).toBe('Biñang 1st')
    expect(matchBarangay('Brgy. Poblacion')).toBe('Poblacion')
    expect(matchBarangay('Quezon City')).toBeUndefined()
  })
})
