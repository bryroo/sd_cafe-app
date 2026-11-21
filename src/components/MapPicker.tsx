/// <reference types="google.maps" />
// Map / Pin picker: the customer puts the pin on their exact door.
//   * tap or click the map to drop the pin; drag it to adjust (a draggable Advanced Marker, which is
//     also keyboard-operable: focus it, Space to pick up, arrow keys to move, Enter to drop)
//   * search box (Places Autocomplete, New) limited to the Philippines and the delivery area, one session
//     token per search so the suggestions are billed as one session ending in a Place Details call
//   * Use my current location (browser Geolocation)
//   * map/satellite and zoom controls; the delivery area is outlined
// Pin moves are reported straight away; the address text from reverse geocoding follows ~600 ms later,
// once the pin settles. The pin is the source of truth; the text only pre-fills the form.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { loadMaps, mapId, MapsError, onMapsRefused, type MapsLibs, type MapsProblem } from '../lib/maps'
import type { ServiceArea } from '../state/serviceArea'
import { useOnline } from '../state/online'
import { BOCAUE_CENTER, matchBarangay } from '../data/bocaue'
import { Alert } from './order'
import { Icon } from './Icon'
import { Loader } from './ui'
import './map.css'

export type Pin = { lat: number; lng: number }
export type PinSource = 'tap' | 'drag' | 'search' | 'locate'
/** What Google's reverse geocoder says is at the pin (a suggestion; the person can change it) */
export type Geocoded = { line?: string; barangay?: string; town?: string; formatted?: string; placeId?: string }

type Suggestion = { id: string; text: string; secondary: string; prediction: google.maps.places.PlacePrediction }

const PROBLEM_TEXT: Record<MapsProblem, { title: string; body: string }> = {
  'not-configured': { title: "The map isn't set up", body: 'Maps is not configured for this version of the app.' },
  offline: { title: 'The map needs a connection', body: "You're offline. Connect, then try again." },
  refused: {
    title: "The map couldn't load",
    body: 'Google Maps refused this request (the key, the daily limit or billing). Try again later.',
  },
  failed: { title: "The map couldn't load", body: 'Check your connection, then try again.' },
}

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

const isDark = () => {
  const t = document.documentElement.dataset.theme
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Pulls a street line, barangay and town out of a Geocoding result */
function readGeocode(results: google.maps.GeocoderResult[]): Geocoded | null {
  const best = results.find((r) => r.types.includes('street_address') || r.types.includes('premise')) ?? results[0]
  if (!best) return null
  const all = results.flatMap((r) => r.address_components)
  const get = (type: string, from = best.address_components) => from.find((c) => c.types.includes(type))?.long_name
  const number = get('street_number')
  const route = get('route')
  const brgyName =
    get('sublocality_level_1') ?? get('neighborhood') ?? get('sublocality_level_1', all) ?? get('neighborhood', all)
  return {
    line: [number, route].filter(Boolean).join(' ') || undefined,
    barangay: matchBarangay(brgyName) ?? brgyName,
    town: get('locality') ?? get('locality', all),
    formatted: best.formatted_address,
    placeId: best.place_id,
  }
}

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
  const libs = useRef<MapsLibs | null>(null)
  const map = useRef<google.maps.Map | null>(null)
  const marker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null)
  const geocodeTimer = useRef<number | undefined>(undefined)
  const geocodeSeq = useRef(0)
  const [problem, setProblem] = useState<MapsProblem | null>(null)
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')
  const [lookupNote, setLookupNote] = useState('')
  // Latest callbacks without re-running the map setup
  const cb = useRef({ onPin, onGeocoded })
  cb.current = { onPin, onGeocoded }

  // Reverse geocode once the pin has settled (taps and drags come in bursts; a search result or the
  // current location is one answer, so it goes at once). A pending lookup still finishes after this
  // step closes, so a quick Confirm doesn't lose the pre-filled street and barangay.
  const geocodeSoon = useCallback((p: Pin, wait = 600) => {
    window.clearTimeout(geocodeTimer.current)
    const seq = ++geocodeSeq.current
    geocodeTimer.current = window.setTimeout(async () => {
      const g = libs.current?.geocoding
      if (!g) return
      try {
        const { results } = await new g.Geocoder().geocode({ location: p })
        if (seq !== geocodeSeq.current) return
        const found = readGeocode(results)
        cb.current.onGeocoded(found)
        setLookupNote(found ? '' : "We couldn't find a street name for this spot. Type it in the next step.")
      } catch (e) {
        if (seq !== geocodeSeq.current) return
        cb.current.onGeocoded(null)
        // ZERO_RESULTS is an empty answer; anything else (REQUEST_DENIED: key, billing or quota) is Google refusing
        const code = (e as { code?: string })?.code
        setLookupNote(
          code === 'ZERO_RESULTS'
            ? "We couldn't find a street name for this spot. Type it in the next step."
            : "Google couldn't look up this spot's street right now. Your pin is saved as placed; type the street in the next step.",
        )
      }
    }, wait)
  }, [])

  const place = useCallback(
    (p: Pin, source: PinSource, placeId?: string) => {
      const m = marker.current
      if (m) {
        m.position = p
        m.map = map.current
      }
      cb.current.onPin(p, source, placeId)
      geocodeSoon(p, source === 'search' || source === 'locate' ? 0 : 600)
    },
    [geocodeSoon],
  )

  // Load the API and build the map
  useEffect(() => {
    let live = true
    setProblem(null)
    setReady(false)
    const off = onMapsRefused(() => live && setProblem('refused'))
    loadMaps()
      .then((l) => {
        if (!live || !mapEl.current) return
        libs.current = l
        const start = pin ?? BOCAUE_CENTER
        const m = new l.maps.Map(mapEl.current, {
          mapId,
          center: start,
          zoom: pin ? 18 : 14,
          minZoom: 12,
          maxZoom: 21,
          // One finger pans the map: it fills its own screen, so there's no page scroll to fight
          gestureHandling: 'greedy',
          clickableIcons: false,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: true,
          mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] },
          fullscreenControl: false,
          streetViewControl: false,
          colorScheme: isDark() ? 'DARK' : 'LIGHT',
        })
        map.current = m
        const head = document.createElement('div')
        head.className = 'map-pin'
        head.innerHTML =
          '<svg width="40" height="48" viewBox="0 0 40 48" aria-hidden="true"><path d="M20 46s15-14.5 15-26a15 15 0 1 0-30 0c0 11.5 15 26 15 26z"/><circle cx="20" cy="20" r="6"/></svg>'
        const mk = new l.marker.AdvancedMarkerElement({
          map: pin ? m : null,
          position: start,
          content: head,
          gmpDraggable: true,
          title: 'Delivery pin. Drag to move it, or focus it and use the arrow keys.',
        })
        marker.current = mk
        mk.addListener('dragend', () => {
          const p = mk.position
          if (!p) return
          const lat = typeof p.lat === 'function' ? p.lat() : p.lat
          const lng = typeof p.lng === 'function' ? p.lng() : p.lng
          place({ lat, lng }, 'drag')
        })
        m.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) place({ lat: e.latLng.lat(), lng: e.latLng.lng() }, 'tap')
        })
        setReady(true)
      })
      .catch((e) => live && setProblem(e instanceof MapsError ? e.problem : 'failed'))
    return () => {
      live = false
      off()
      if (marker.current) marker.current.map = null
      marker.current = null
      map.current = null
    }
    // Built once per attempt (the pin at that moment is the starting point). The area is added below
    // when it arrives, so a late outline never rebuilds the map or drops a pending geocode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  // The delivery area: outline it and keep panning near it (about 3 km of slack, so people near the edge
  // can still find their street)
  useEffect(() => {
    const m = map.current
    if (!ready || !m || !area) return
    const b = area.bounds
    const pad = 0.03
    m.setOptions({
      restriction: { latLngBounds: { north: b.north + pad, south: b.south - pad, east: b.east + pad, west: b.west - pad }, strictBounds: false },
    })
    const added = m.data.addGeoJson(area.geojson)
    m.data.setStyle({
      clickable: false,
      fillColor: cssVar('--gold', '#c9a227'),
      fillOpacity: 0.06,
      strokeColor: cssVar('--gold-ink', '#6e5512'),
      strokeOpacity: 0.9,
      strokeWeight: 2,
    })
    return () => added.forEach((f) => m.data.remove(f))
  }, [ready, area])

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
        map.current?.panTo(p)
        map.current?.setZoom(18)
        place(p, 'locate')
      },
      (err) => {
        setLocating(false)
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location is turned off for this app. Allow it in your browser settings, or search or tap the map instead.'
            : err.code === err.TIMEOUT
              ? "Finding your location took too long. Try again, or search or tap the map instead."
              : "Your location isn't available right now. Search for your street or tap the map instead.",
        )
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  const showProblem = problem ?? (!online && !ready ? 'offline' : null)

  return (
    <div className="map-picker">
      <PlaceSearch
        libs={ready ? libs.current : null}
        area={area}
        onPick={(p, placeId) => {
          map.current?.panTo(p)
          map.current?.setZoom(18)
          place(p, 'search', placeId)
        }}
      />
      <div className="map-picker__canvas">
        <div ref={mapEl} className="map-picker__map" role="region" aria-label={label} />
        {!ready && !showProblem && (
          <div className="map-picker__cover" aria-live="polite">
            <Loader />
            <span className="t-body-sm">Loading the map…</span>
          </div>
        )}
        {showProblem && (
          <div className="map-picker__cover map-picker__cover--problem">
            <Alert
              tone="warning"
              icon={showProblem === 'offline' ? 'offline' : 'alert'}
              title={PROBLEM_TEXT[showProblem].title}
              action={
                showProblem !== 'not-configured' && (
                  <button type="button" className="t-body-sm link-text" onClick={() => setAttempt((n) => n + 1)}>
                    Try again
                  </button>
                )
              }
            >
              {PROBLEM_TEXT[showProblem].body}
            </Alert>
          </div>
        )}
        {ready && (
          <button type="button" className="map-picker__locate" onClick={locate} disabled={locating} aria-busy={locating}>
            <Icon name="pin" size={20} />
            <span className="t-body-sm">{locating ? 'Finding you…' : 'Use my current location'}</span>
          </button>
        )}
      </div>
      {locateError && (
        <Alert tone="warning" icon="pin">
          {locateError}
        </Alert>
      )}
      {lookupNote && <p className="t-caption muted" role="status">{lookupNote}</p>}
      <p className="t-caption muted map-picker__credit">
        Delivery area outline ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
      </p>
    </div>
  )
}

/** Search with Places Autocomplete (New), drawn as our own combobox so it's keyboard- and screen-reader
 *  friendly and themed. One session token per search; fetching the chosen place ends the session. */
function PlaceSearch({
  libs,
  area,
  onPick,
}: {
  libs: MapsLibs | null
  area: ServiceArea | null
  onPick: (p: Pin, placeId: string) => void
}) {
  const id = useId()
  const listId = `${id}-list`
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Suggestion[]>([])
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!libs || q.trim().length < 3) {
      setItems([])
      return
    }
    const mine = ++seq.current
    const t = window.setTimeout(async () => {
      try {
        token.current ??= new libs.places.AutocompleteSessionToken()
        const b = area?.bounds
        const { suggestions } = await libs.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q.trim(),
          sessionToken: token.current,
          includedRegionCodes: ['ph'],
          language: 'en',
          region: 'ph',
          ...(b ? { locationRestriction: { north: b.north + 0.01, south: b.south - 0.01, east: b.east + 0.01, west: b.west - 0.01 } } : {}),
        })
        if (mine !== seq.current) return
        const list = suggestions
          .map((s) => s.placePrediction)
          .filter((p): p is google.maps.places.PlacePrediction => !!p)
          .slice(0, 5)
          .map((p) => ({ id: p.placeId, text: p.mainText?.toString() ?? p.text.toString(), secondary: p.secondaryText?.toString() ?? '', prediction: p }))
        setItems(list)
        setActive(-1)
        setOpen(true)
        setNote(list.length ? '' : 'No places found near Bocaue. Try a street or landmark name, or tap the map.')
      } catch {
        if (mine === seq.current) setNote("Search isn't working right now. Tap the map to drop your pin.")
      }
    }, 300)
    return () => window.clearTimeout(t)
  }, [q, libs, area])

  const choose = async (s: Suggestion) => {
    setOpen(false)
    setQ(s.text)
    try {
      const placeObj = s.prediction.toPlace()
      await placeObj.fetchFields({ fields: ['location', 'formattedAddress'] })
      token.current = null // the session ends with this Place Details call
      if (placeObj.location) {
        onPick({ lat: placeObj.location.lat(), lng: placeObj.location.lng() }, s.id)
        setNote('Pin moved to that place. Drag it onto your door if it needs a nudge.')
      }
    } catch {
      setNote("Couldn't open that place. Try another, or tap the map.")
    }
  }

  return (
    <div className="place-search">
      <label htmlFor={`${id}-input`} className="t-body-sm">
        Search for your street or a landmark
      </label>
      <div className="field__input place-search__input">
        <Icon name="search" size={20} />
        <input
          id={`${id}-input`}
          className="t-body"
          type="search"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={`${id}-note`}
          autoComplete="street-address"
          enterKeyHint="search"
          placeholder={libs ? 'e.g. Mabini St, Bocaue' : 'Search opens with the map'}
          disabled={!libs}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(items.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && open && items[active >= 0 ? active : 0]) {
              e.preventDefault()
              void choose(items[active >= 0 ? active : 0])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
      </div>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="place-search__list card" aria-label="Places">
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void choose(s)}
            >
              <span className="t-body">{s.text}</span>
              {s.secondary && <span className="t-caption muted">{s.secondary}</span>}
            </li>
          ))}
        </ul>
      )}
      <p id={`${id}-note`} className="t-caption muted" aria-live="polite">
        {note}
      </p>
    </div>
  )
}
