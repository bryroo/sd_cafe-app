/** Plain link that opens a pin on openstreetmap.org (no API call, no key, nothing loaded) */
export const mapsLink = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=18/${lat.toFixed(6)}/${lng.toFixed(6)}`
