// A small, non-interactive picture of where the pin sits inside the delivery area: the area's outline
// (OpenStreetMap) and the pin, drawn as SVG. No map tiles and no Google request, so it costs nothing and
// works offline once the outline has loaded. "Open in Google Maps" is a plain link (no API key).
import { mapsLink } from '../lib/maps'
import { useServiceArea, type ServiceArea } from '../state/serviceArea'
import './map.css'

const W = 320

function project(area: ServiceArea) {
  const { north, south, east, west } = area.bounds
  const k = Math.cos((((north + south) / 2) * Math.PI) / 180)
  const h = Math.round((W * (north - south)) / ((east - west) * k))
  const pad = 12
  const x = (lng: number) => pad + ((lng - west) / (east - west)) * (W - 2 * pad)
  const y = (lat: number) => pad + ((north - lat) / (north - south)) * (h - 2 * pad)
  return { x, y, h }
}

export function PinPreview({ lat, lng, label = 'Delivery pin' }: { lat: number; lng: number; label?: string }) {
  const { area } = useServiceArea()
  return (
    <figure className="pin-preview">
      {area ? (
        (() => {
          const { x, y, h } = project(area)
          const d = area.polygons
            .flat()
            .map((ring) => ring.map(([lo, la], i) => `${i ? 'L' : 'M'}${x(lo).toFixed(1)} ${y(la).toFixed(1)}`).join('') + 'Z')
            .join('')
          const px = x(lng)
          const py = y(lat)
          return (
            <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`${label}, shown inside the outline of ${area.names.join(', ')}`}>
              <path className="pin-preview__area" d={d} fillRule="evenodd" />
              <circle className="pin-preview__halo" cx={px} cy={py} r={12} />
              <path className="pin-preview__pin" d={`M${px} ${py}c0 0 -8 -8 -8 -14a8 8 0 1 1 16 0c0 6 -8 14 -8 14z`} />
            </svg>
          )
        })()
      ) : (
        <div className="pin-preview__blank" aria-hidden />
      )}
      <figcaption className="t-caption">
        <a className="link-text" href={mapsLink(lat, lng)} target="_blank" rel="noreferrer">
          Open the pin in Google Maps
        </a>
      </figcaption>
    </figure>
  )
}
