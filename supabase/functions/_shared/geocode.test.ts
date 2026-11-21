import { describe, expect, it } from 'vitest'
import { boundsOf, cleanQuery, reverseKey, reverseUrl, searchKey, searchUrl, toPlace, validPoint } from './geocode'

const BOCAUE = { north: 14.8445, south: 14.7632, east: 120.9612, west: 120.9059 }

describe('cleanQuery', () => {
  it('trims, collapses spaces and strips control characters', () => {
    expect(cleanQuery('  Mabini\n\t St  ')).toBe('Mabini St')
  })
  it('refuses too short, too long and non-strings', () => {
    expect(cleanQuery('ab')).toBeNull()
    expect(cleanQuery('x'.repeat(121))).toBeNull()
    expect(cleanQuery(42)).toBeNull()
    expect(cleanQuery(undefined)).toBeNull()
  })
})

describe('validPoint', () => {
  it('accepts real coordinates only', () => {
    expect(validPoint(14.79, 120.92)).toBe(true)
    expect(validPoint(91, 120)).toBe(false)
    expect(validPoint(14, 181)).toBe(false)
    expect(validPoint(Number.NaN, 120)).toBe(false)
    expect(validPoint('14.7', 120)).toBe(false)
  })
})

describe('Nominatim requests', () => {
  it('searches the Philippines inside a box around the area, submitted queries only', () => {
    const u = new URL(searchUrl('Mabini St', BOCAUE))
    expect(u.origin + u.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect(u.searchParams.get('countrycodes')).toBe('ph')
    expect(u.searchParams.get('bounded')).toBe('1')
    expect(u.searchParams.get('viewbox')).toBe('120.88590,14.86450,120.98120,14.74320')
    expect(u.searchParams.get('q')).toBe('Mabini St')
  })
  it('reverse geocodes at street level', () => {
    const u = new URL(reverseUrl(14.7949017, 120.9254911))
    expect(u.searchParams.get('lat')).toBe('14.794902')
    expect(u.searchParams.get('lon')).toBe('120.925491')
    expect(u.searchParams.get('zoom')).toBe('18')
  })
  it('shares cache entries for the same query and for pins about a metre apart', () => {
    expect(searchKey('Mabini St')).toBe(searchKey('mabini st'))
    expect(reverseKey(14.794901, 120.925491)).toBe(reverseKey(14.794903, 120.925493))
  })
})

describe('toPlace', () => {
  it('reads street, barangay and town from an OSM address', () => {
    expect(
      toPlace({
        lat: '14.7949', lon: '120.9255', display_name: '12, Mabini Street, Poblacion, Bocaue, Bulacan',
        osm_type: 'way', osm_id: 123,
        address: { house_number: '12', road: 'Mabini Street', quarter: 'Poblacion', town: 'Bocaue' },
      }),
    ).toEqual({ lat: 14.7949, lng: 120.9255, label: '12, Mabini Street, Poblacion, Bocaue, Bulacan', line: '12 Mabini Street', area: 'Poblacion', town: 'Bocaue', osmId: 'osm:W123' })
  })
  it('returns null for an empty or error answer', () => {
    expect(toPlace({ error: 'Unable to geocode' })).toBeNull()
    expect(toPlace(null)).toBeNull()
    expect(toPlace({ lat: 'x', lon: '1' })).toBeNull()
  })
})

describe('boundsOf', () => {
  it('finds the box of a multipolygon', () => {
    const b = boundsOf({ features: [{ geometry: { type: 'MultiPolygon', coordinates: [[[[120.9, 14.7], [121, 14.7], [121, 14.9], [120.9, 14.7]]]] } }] })
    expect(b).toEqual({ north: 14.9, south: 14.7, east: 121, west: 120.9 })
  })
})
