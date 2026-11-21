// Map / Pin picker (Leaflet + OpenStreetMap): the customer puts the pin on their exact door.
//   * tap or click the map to drop the pin; drag it to adjust. The pin is keyboard-operable: Tab to it,
//     then the arrow keys move it (Shift moves it further)
//   * address search (OpenStreetMap Nominatim through the `geocode` Edge Function). It runs when the person
//     presses Search, never while typing: Nominatim's usage policy forbids search-as-you-type
//   * Use my current location (browser Geolocation); zoom buttons; the delivery area is outlined
// Pin moves are reported straight away. The address text from the reverse lookup follows ~600 ms after
// a tap or drag settles (at once for a search or the current location). The pin is the source of truth;
// the text only pre-fills the form. Map tiles come from tile.openstreetmap.org and are never cached by the
// service worker.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { reversePlace, searchPlaces, type GeoPlace } from '../lib/geocode'
import type { ServiceArea } from '../state/serviceArea'
import { useOnline } from '../state/online'
import { BOCAUE_CENTER, matchBarangay } from '../data/bocaue'
import { Alert } from './order'
import { Icon } from './Icon'
import { Button } from './ui'
import './map.css'

export type Pin = { lat: number; lng: number }
export type PinSource = 'tap' | 'drag' | 'search' | 'locate'
/** What OpenStreetMap says is near the pin (a suggestion; the person can change it) */
export type Geocoded = { line?: string; barangay?: string; town?: string; formatted?: string; placeId?: string }

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const PIN_SVG =
  '<svg width="40" height="48" viewBox="0 0 40 48" aria-hidden="true"><path d="M20 46s15-14.5 15-26a15 15 0 1 0-30 0c0 11.5 15 26 15 26z"/><circle cx="20" cy="20" r="6"/></svg>'

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

const toGeocoded = (p: GeoPlace): Geocoded => ({
  line: p.line,
  barangay: matchBarangay(p.area) ?? p.area,
  town: p.town,
  formatted: p.label,
  placeId: p.osmId,
})

export function MapPicker({
  pin,
  area,
  onPin,
  onGeocoded,
  label = 'Delivery location map',
}: {
  pin: Pin | null
  area: ServiceArea | null
  onPin: (pin: Pin, source: PinSource, placeId?: string) => void
  onGeocoded: (g: Geocoded | null) => void
  label?: string
}) {
  const online = useOnline()
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const geocodeTimer = useRef<number | undefined>(undefined)
  const geocodeSeq = useRef(0)
  const [tilesFailed, setTilesFailed] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')
  const [lookupNote, setLookupNote] = useState('')
  // Latest callbacks without rebuilding the map
  const cb = useRef({ onPin, onGeocoded })
  cb.current = { onPin, onGeocoded }

  // Reverse lookup once the pin has settled (taps and drags come in bursts; a search result or the
  // current location is one answer, so it goes at once). A pending lookup still finishes after this step
  // closes, so a quick Confirm doesn't lose the pre-filled street and barangay.
  const geocodeSoon = useCallback((p: Pin, wait = 600) => {
    window.clearTimeout(geocodeTimer.current)
    const seq = ++geocodeSeq.current
    geocodeTimer.current = window.setTimeout(async () => {
      const r = await reversePlace(p.lat, p.lng)
      if (seq !== geocodeSeq.current) return
      if ('error' in r) {
        cb.current.onGeocoded(null)
        setLookupNote(
          r.error.code === 'OFFLINE'
            ? "You're offline, so we couldn't look up the street. Type it in the next step."
            : `${r.error.message.replace(/ Tap the map,? or type the address\.?$/, '')} Your pin is kept; type the street in the next step.`,
        )
        return
      }
      cb.current.onGeocoded(r.place ? toGeocoded(r.place) : null)
      // No answer is fine: outside the area the Coming soon panel explains it; inside, the form asks
      setLookupNote('')
    }, wait)
  }, [])

  const place = useCallback(
    (p: Pin, source: PinSource, placeId?: string) => {
      const m = map.current
      if (m) {
        if (!marker.current) {
          marker.current = makeMarker(p).addTo(m)
        } else marker.current.setLatLng(p)
      }
      cb.current.onPin(p, source, placeId)
      geocodeSoon(p, source === 'search' || source === 'locate' ? 0 : 600)
    },
    // makeMarker is stable (declared below with useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geocodeSoon],
  )

  // The pin: draggable, and movable with the arrow keys once focused
  const makeMarker = useCallback(
    (p: Pin) => {
      const mk = L.marker(p, {
        draggable: true,
        keyboard: true,
        autoPan: true,
        title: 'Delivery pin',
        alt: 'Delivery pin. Drag it, or use the arrow keys to move it.',
        icon: L.divIcon({ className: 'map-pin', html: PIN_SVG, iconSize: [40, 48], iconAnchor: [20, 46] }),
      })
      mk.on('dragend', () => {
        const ll = mk.getLatLng()
        place({ lat: ll.lat, lng: ll.lng }, 'drag')
      })
      mk.on('add', () => {
        const el = mk.getElement()
        if (!el) return
        el.addEventListener('keydown', (e) => {
          const step = e.shiftKey ? 20 : 4
          const d = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key]
          const m = map.current
          if (!d || !m) return
          e.preventDefault()
          e.stopPropagation() // the map would pan instead
          const pt = m.latLngToContainerPoint(mk.getLatLng()).add(L.point(d[0], d[1]))
          const ll = m.containerPointToLatLng(pt)
          place({ lat: ll.lat, lng: ll.lng }, 'drag')
        })
      })
      return mk
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Build the map once
  useEffect(() => {
    const el = mapEl.current
    if (!el) return
    const start = pin ?? BOCAUE_CENTER
    const m = L.map(el, {
      center: start,
      zoom: pin ? 18 : 14,
      minZoom: 13,
      maxZoom: 19,
      zoomControl: true,
      keyboard: true,
      maxBoundsViscosity: 0.8,
    })
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>')
    let loadedAny = false
    let errors = 0
    const t = L.tileLayer(TILES, { maxZoom: 19, attribution: OSM_CREDIT })
      .on('tileload', () => {
        loadedAny = true
        errors = 0
        setTilesFailed(false)
      })
      .on('tileerror', () => {
        errors++
        if (!loadedAny && errors >= 3) setTilesFailed(true)
      })
      .addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => place({ lat: e.latlng.lat, lng: e.latlng.lng }, 'tap'))
    map.current = m
    tiles.current = t
    if (pin) marker.current = makeMarker(pin).addTo(m)
    // The sheet and the screen can change size (keyboard, rotation): keep the tiles filling the box
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      marker.current = null
      tiles.current = null
    }
    // Built once; the pin at that moment is the starting point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The delivery area: outline it and keep panning near it (about 3 km of slack around it)
  useEffect(() => {
    const m = map.current
    if (!m || !area) return
    const b = area.bounds
    const pad = 0.03
    m.setMaxBounds([
      [b.south - pad, b.west - pad],
      [b.north + pad, b.east + pad],
    ])
    const outline = L.geoJSON(area.geojson as GeoJSON.FeatureCollection, {
      interactive: false,
      style: {
        color: cssVar('--gold-ink', '#6e5512'),
        weight: 2,
        opacity: 0.9,
        fillColor: cssVar('--gold', '#c9a227'),
        fillOpacity: 0.06,
      },
    }).addTo(m)
    return () => {
      outline.remove()
    }
  }, [area])

  const retryTiles = () => {
    setTilesFailed(false)
    tiles.current?.redraw()
  }

  const locate = () => {
    setLocateError('')
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setLocateError("This browser can't share your location. Search for your street or tap the map instead.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        map.current?.setView(p, 18)
        place(p, 'locate')
      },
      (err) => {
        setLocating(false)
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location is turned off for this app. Allow it in your browser settings, or search or tap the map instead.'
            : err.code === err.TIMEOUT
              ? 'Finding your location took too long. Try again, or search or tap the map instead.'
              : "Your location isn't available right now. Search for your street or tap the map instead.",
        )
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  const problem = !online ? 'offline' : tilesFailed ? 'tiles' : null

  return (
    <div className="map-picker">
      <PlaceSearch
        onPick={(p) => {
          map.current?.setView(p, 18)
          place({ lat: p.lat, lng: p.lng }, 'search', p.osmId)
        }}
      />
      <div className="map-picker__canvas">
        <div ref={mapEl} className="map-picker__map" role="region" aria-label={label} />
        {problem && (
          <div className="map-picker__cover map-picker__cover--problem">
            <Alert
              tone="warning"
              icon={problem === 'offline' ? 'offline' : 'alert'}
              title={problem === 'offline' ? 'The map needs a connection' : "The map couldn't load"}
              action={
                problem === 'tiles' && (
                  <button type="button" className="t-body-sm link-text" onClick={retryTiles}>
                    Try again
                  </button>
                )
              }
            >
              {problem === 'offline'
                ? "You're offline. Connect, then try again."
                : 'The map pictures didn’t arrive. Check your connection, then try again.'}
            </Alert>
          </div>
        )}
        <button type="button" className="map-picker__locate" onClick={locate} disabled={locating} aria-busy={locating}>
          <Icon name="pin" size={20} />
          <span className="t-body-sm">{locating ? 'Finding you…' : 'Use my current location'}</span>
        </button>
      </div>
      {locateError && (
        <Alert tone="warning" icon="pin">
          {locateError}
        </Alert>
      )}
      {lookupNote && (
        <p className="t-caption muted" role="status">
          {lookupNote}
        </p>
      )}
      <p className="t-caption muted map-picker__credit">
        Map and addresses ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
      </p>
    </div>
  )
}

/** Address search: runs on Search or Enter (Nominatim's policy rules out search-as-you-type). Results are
 *  a plain list of buttons, so keyboards and screen readers need nothing special. */
function PlaceSearch({ onPick }: { onPick: (p: GeoPlace) => void }) {
  const id = useId()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<GeoPlace[] | null>(null)
  const [note, setNote] = useState('')
  const firstResult = useRef<HTMLButtonElement>(null)

  const run = async () => {
    const text = q.trim()
    if (text.length < 3) {
      setNote('Type at least 3 letters, like a street or a landmark.')
      return
    }
    setBusy(true)
    setNote('')
    const r = await searchPlaces(text)
    setBusy(false)
    if ('error' in r) {
      setResults(null)
      setNote(r.error.code === 'OFFLINE' ? "You're offline. Connect, or tap the map instead." : r.error.message)
      return
    }
    setResults(r.places)
    setNote(
      r.places.length
        ? `${r.places.length} place${r.places.length === 1 ? '' : 's'} found. Choose one to move the pin there.`
        : 'No places found near Bocaue. Try a street or landmark name, or tap the map.',
    )
    if (r.places.length) requestAnimationFrame(() => firstResult.current?.focus())
  }

  return (
    <form
      className="place-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        void run()
      }}
    >
      <label htmlFor={`${id}-input`} className="t-body-sm">
        Search for your street or a landmark
      </label>
      <div className="place-search__row">
        <div className="field__input place-search__input">
          <Icon name="search" size={20} />
          <input
            id={`${id}-input`}
            className="t-body"
            type="search"
            autoComplete="street-address"
            enterKeyHint="search"
            placeholder="e.g. Mabini St, Bocaue"
            maxLength={120}
            value={q}
            aria-describedby={`${id}-note`}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" height={52} full={false} disabled={busy} aria-busy={busy}>
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </div>
      <p id={`${id}-note`} className="t-caption muted" aria-live="polite">
        {note}
      </p>
      {results && results.length > 0 && (
        <ul className="place-search__list card" aria-label="Places found">
          {results.map((p, i) => (
            <li key={`${p.osmId ?? i}-${p.lat}`}>
              <button
                ref={i === 0 ? firstResult : undefined}
                type="button"
                onClick={() => {
                  onPick(p)
                  setResults(null)
                  setNote('Pin moved to that place. Drag it onto your door if it needs a nudge.')
                }}
              >
                <span className="t-body">{p.line || p.label.split(',')[0]}</span>
                <span className="t-caption muted">{p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
