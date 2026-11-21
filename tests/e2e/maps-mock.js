// A stand-in for https://maps.googleapis.com/maps/api/js used by the Playwright tests. It implements only
// what src/components/MapPicker.tsx uses, records every call in window.__mockMaps.log (so tests can check
// session tokens and debounced geocoding), and calls the loader's callback like the real script.
// Map clicks: the map's centre is its centre option; 1 px = 0.0001 degrees.
;(() => {
  const params = new URL(document.currentScript.src).searchParams
  const log = []
  const mock = (window.__mockMaps = { log, markers: [], maps: [] })
  const ll = (lat, lng) => ({ lat: () => lat, lng: () => lng, toJSON: () => ({ lat, lng }) })

  class Listeners {
    constructor() {
      this.l = {}
    }
    addListener(ev, fn) {
      ;(this.l[ev] ??= []).push(fn)
      return { remove: () => (this.l[ev] = this.l[ev].filter((f) => f !== fn)) }
    }
    fire(ev, arg) {
      ;(this.l[ev] ?? []).forEach((f) => f(arg))
    }
  }

  class Map extends Listeners {
    constructor(el, opts) {
      super()
      this.el = el
      this.center = opts.center
      this.zoom = opts.zoom
      this.opts = opts
      el.dataset.mockMap = 'true'
      el.style.background = 'repeating-linear-gradient(45deg, #ccc 0 10px, #ddd 10px 20px)'
      el.setAttribute('tabindex', '0')
      const attribution = document.createElement('span')
      attribution.textContent = 'Google'
      attribution.style.cssText = 'position:absolute;left:4px;bottom:4px;font:12px sans-serif;color:#000;background:#fff'
      el.appendChild(attribution)
      el.addEventListener('click', (e) => {
        if (e.target.closest('.map-pin')) return
        const r = el.getBoundingClientRect()
        const lat = this.center.lat - (e.clientY - r.top - r.height / 2) * 0.0001
        const lng = this.center.lng + (e.clientX - r.left - r.width / 2) * 0.0001
        this.fire('click', { latLng: ll(lat, lng) })
      })
      this.data = {
        addGeoJson: (g) => (log.push({ type: 'overlay', features: g.features.length }), g.features.map((x) => ({ id: x.id }))),
        remove: () => log.push({ type: 'overlayRemoved' }),
        setStyle: (s) => log.push({ type: 'overlayStyle', strokeColor: s.strokeColor }),
      }
      mock.maps.push(this)
      log.push({ type: 'map', mapId: opts.mapId, colorScheme: opts.colorScheme, gestureHandling: opts.gestureHandling })
    }
    setOptions(o) {
      log.push({ type: 'options', restriction: !!o.restriction })
    }
    panTo(p) {
      this.center = p
    }
    setZoom(z) {
      this.zoom = z
    }
    getZoom() {
      return this.zoom
    }
  }

  class AdvancedMarkerElement extends Listeners {
    constructor(o) {
      super()
      this.content = o.content
      this.position = o.position
      this.gmpDraggable = o.gmpDraggable
      this.title = o.title
      this._map = null
      this.map = o.map
      mock.markers.push(this)
    }
    set map(m) {
      this._map = m
      if (m) {
        this.content.dataset.mockMarker = 'true'
        this.content.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-100%)'
        m.el.appendChild(this.content)
      } else this.content.remove()
    }
    get map() {
      return this._map
    }
  }

  // Tests call this to "drag" the pin: moves it and fires dragend, as the real marker does on drop
  mock.drag = (lat, lng) => {
    const m = mock.markers[mock.markers.length - 1]
    m.position = { lat, lng }
    m.fire('dragend')
  }
  mock.authFailure = () => window.gm_authFailure && window.gm_authFailure()

  let tokenSeq = 0
  class AutocompleteSessionToken {
    constructor() {
      this.id = ++tokenSeq
    }
  }
  const PLACES = [
    { id: 'place-mabini', main: 'Mabini St', secondary: 'Poblacion, Bocaue, Bulacan', lat: 14.7952, lng: 120.9258 },
    { id: 'place-marilao', main: 'Marilao Town Plaza', secondary: 'Marilao, Bulacan', lat: 14.770195, lng: 120.957623 },
  ]
  const AutocompleteSuggestion = {
    fetchAutocompleteSuggestions: async (req) => {
      log.push({ type: 'autocomplete', input: req.input, token: req.sessionToken?.id, regions: req.includedRegionCodes, restricted: !!req.locationRestriction })
      const q = req.input.toLowerCase()
      return {
        suggestions: PLACES.filter((p) => p.main.toLowerCase().includes(q.split(' ')[0])).map((p) => ({
          placePrediction: {
            placeId: p.id,
            text: { toString: () => `${p.main}, ${p.secondary}` },
            mainText: { toString: () => p.main },
            secondaryText: { toString: () => p.secondary },
            toPlace: () => ({
              location: null,
              async fetchFields(f) {
                log.push({ type: 'placeDetails', id: p.id, fields: f.fields })
                this.location = ll(p.lat, p.lng)
              },
            }),
          },
        })),
      }
    },
  }

  class Geocoder {
    async geocode(req) {
      const { lat, lng } = req.location
      log.push({ type: 'geocode', lat, lng })
      if (window.__mockMaps.emptyGeocode) return { results: [] }
      const inBocaue = lat > 14.76 && lat < 14.845 && lng > 120.905 && lng < 120.955
      return {
        results: [
          {
            types: ['street_address'],
            formatted_address: inBocaue ? '12 Mabini St, Poblacion, Bocaue, Bulacan' : 'Town Plaza, Marilao, Bulacan',
            place_id: 'geo-1',
            address_components: inBocaue
              ? [
                  { long_name: '12', types: ['street_number'] },
                  { long_name: 'Mabini St', types: ['route'] },
                  { long_name: 'Poblacion', types: ['sublocality_level_1', 'sublocality'] },
                  { long_name: 'Bocaue', types: ['locality'] },
                ]
              : [{ long_name: 'Marilao', types: ['locality'] }],
          },
        ],
      }
    }
  }

  const libs = {
    maps: { Map },
    marker: { AdvancedMarkerElement },
    places: { AutocompleteSessionToken, AutocompleteSuggestion },
    geocoding: { Geocoder },
  }
  log.push({ type: 'script', key: params.get('key'), libraries: params.get('libraries') })
  window.google.maps.importLibrary = async (name) => libs[name]
  window.google.maps[params.get('callback').split('.').pop()]()
})()
