/** Plain link that opens a pin in Google Maps (no API call, no key, nothing loaded) */
export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(7)},${lng.toFixed(7)}`
