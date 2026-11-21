// C-33 Delivery address: add (`/address/new`) or edit (`/address/:id`). Lazy-loaded, so the map code
// only reaches people who open this screen.
//   Step 1, Pin: drop the pin on the door (map tap, drag, search or current location). The outline shows
//   where we deliver; outside it the "Coming soon" panel blocks the address and offers pickup.
//   Step 2, Details: label, recipient, mobile, barangay, house and street, landmark, notes; Save.
// The pin is the source of truth: the database refuses a pin outside the service area, and place-order
// checks it again for every delivery. The app's own "Delivers here" is only the instant answer.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Content, Row, Screen, TopBar } from '../components/Screen'
import { Chip, Illustration, TextArea } from '../components/blocks'
import { Alert } from '../components/order'
import { Button, TextField } from '../components/ui'
import { Icon } from '../components/Icon'
import { MapPicker, type Geocoded, type Pin } from '../components/MapPicker'
import { PinPreview } from '../components/PinPreview'
import { useApp, type Address } from '../state/AppState'
import { coversPoint, useServiceArea } from '../state/serviceArea'
import { isPinned, toE164 } from '../state/shared'
import { useValidation } from '../state/forms'
import { BOCAUE_BARANGAYS, DELIVERY_AREA_LABEL, DELIVERY_TOWN, matchBarangay } from '../data/bocaue'
import '../components/map.css'

const LABELS: Address['label'][] = ['Home', 'Work', 'Other']

/** Moves focus to the screen's heading after a step change (as the app does after a route change) */
function focusHeading() {
  requestAnimationFrame(() => {
    const h1 = document.querySelector<HTMLElement>('.app__screen h1, .screen h1')
    if (!h1) return
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
    h1.focus({ preventScroll: true })
  })
}

export function ComingSoon({ onPickup }: { onPickup?: () => void }) {
  return (
    <div className="coming-soon" role="status">
      <Illustration name="lost" size={72} />
      <div className="coming-soon__body">
        <h2 className="t-h3">Delivery is coming soon here</h2>
        <p className="t-body-sm">
          Right now we deliver within {DELIVERY_AREA_LABEL} only, inside the outlined area. Move the pin inside it, or
          pick up your order at the counter.
        </p>
        {onPickup && (
          <div>
            <Button variant="secondary" height={48} full={false} icon={<Icon name="store" size={20} />} onClick={onPickup}>
              Order for pickup instead
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function DeliveryAddress() {
  const { id = 'new' } = useParams()
  const navigate = useNavigate()
  const { addresses, saveAddress, setAddressId, setFulfillment, name, phone, cart } = useApp()
  const existing = addresses.find((a) => a.id === id)
  const { area, failed: areaFailed, retry: retryArea } = useServiceArea()

  const [step, setStep] = useState<'pin' | 'details'>(isPinned(existing) ? 'details' : 'pin')
  const [pin, setPin] = useState<Pin | null>(isPinned(existing) ? { lat: existing!.lat!, lng: existing!.lng! } : null)
  const [placeId, setPlaceId] = useState<string | undefined>(existing?.placeId)
  const [geo, setGeo] = useState<Geocoded | null>(null)

  const [label, setLabel] = useState<Address['label']>(existing?.label ?? 'Home')
  const [recipient, setRecipient] = useState(existing?.name ?? name ?? '')
  const [mobile, setMobile] = useState(existing?.phone ?? phone ?? '')
  const [barangay, setBarangay] = useState(matchBarangay(existing?.barangay) ?? '')
  const [line, setLine] = useState(existing?.line ?? (existing && !existing.barangay ? existing.street : ''))
  const [landmark, setLandmark] = useState(existing?.landmark ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  // Fields the person typed in themselves: reverse geocoding never overwrites those
  const edited = useRef<Set<string>>(new Set(existing ? ['barangay', 'line'] : []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const inside = pin && area ? coversPoint(area, pin.lat, pin.lng) : null

  // This screen loads lazily, after the app's own move to the new heading: do it once it's here
  useEffect(focusHeading, [])

  // Fill in what OpenStreetMap says is at the pin, unless the person already typed it
  useEffect(() => {
    if (!geo) return
    const b = matchBarangay(geo.barangay)
    if (b && !edited.current.has('barangay')) setBarangay(b)
    if (geo.line && !edited.current.has('line')) setLine(geo.line)
  }, [geo])

  const goPickup = () => {
    setFulfillment('pickup')
    navigate(cart.length ? '/checkout' : '/menu', { replace: true })
  }

  const mobileE164 = toE164(mobile)
  const v = useValidation(
    {
      recipient: recipient.trim() ? undefined : 'Enter the name of the person receiving the order.',
      mobile: /^\+639\d{9}$/.test(mobileE164) ? undefined : 'Enter a mobile number the rider can call, like 0917 123 4567.',
      barangay: barangay ? undefined : 'Choose the barangay.',
      line: line.trim() ? undefined : 'Enter the house number and street.',
    },
    (k) => `ad-${k}`,
  )

  const save = async () => {
    if (!v.check()) return
    if (pin && inside === false) {
      setError(`We can't save this pin: it's outside ${DELIVERY_AREA_LABEL}. Move the pin, or order for pickup.`)
      return
    }
    const a: Address = {
      id: existing?.id ?? `addr-${Date.now()}`,
      label,
      name: recipient.trim(),
      phone: mobileE164,
      street: [line.trim(), barangay, DELIVERY_TOWN].join(', '),
      line: line.trim(),
      barangay,
      city: DELIVERY_TOWN,
      landmark: landmark.trim() || undefined,
      notes: notes.trim() || undefined,
      isDefault: existing?.isDefault,
      ...(pin ? { lat: pin.lat, lng: pin.lng, placeId } : {}),
    }
    setBusy(true)
    setError('')
    try {
      const savedId = await saveAddress(a)
      setAddressId(savedId)
      navigate(-1)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the address. Try again.")
    } finally {
      setBusy(false)
    }
  }

  if (step === 'pin') {
    const statusId = 'pin-status'
    return (
      <Screen
        footerBorder
        topBar={<TopBar title="Pin your address" onBack={existing && isPinned(existing) ? () => (setStep('details'), focusHeading()) : undefined} />}
        footer={
          <Button
            disabled={inside !== true}
            aria-describedby={statusId}
            onClick={() => {
              setStep('details')
              focusHeading()
            }}
          >
            Confirm location
          </Button>
        }
      >
        <Content gap={12}>
          <Row>
            <p className="t-body-sm muted">
              Put the pin on your door. Tap the map, drag the pin, search, or use your location. We deliver within{' '}
              {DELIVERY_AREA_LABEL}.
            </p>
          </Row>
          <Row className="pin-step">
            <MapPicker
              pin={pin}
              area={area}
              onPin={(p, _source, pid) => {
                setPin(p)
                setPlaceId(pid)
                setGeo(null)
              }}
              onGeocoded={setGeo}
            />
          </Row>
          <Row>
            <div id={statusId} className={`pin-status ${inside ? 'pin-status--ok' : ''}`} aria-live="polite">
              {areaFailed ? (
                <Alert
                  tone="warning"
                  action={
                    <button type="button" className="t-body-sm link-text" onClick={retryArea}>
                      Try again
                    </button>
                  }
                >
                  Couldn't load the delivery area. Check your connection.
                </Alert>
              ) : !pin ? (
                <p className="t-body-sm muted">No pin yet.</p>
              ) : !area ? (
                <p className="t-body-sm muted">Checking the delivery area…</p>
              ) : inside ? (
                <>
                  <p className="pin-status__line t-button">
                    <Icon name="check" size={20} />
                    Delivers here
                  </p>
                  {geo?.formatted && <p className="t-body-sm pin-status__address">Near {geo.formatted}</p>}
                  {geo?.town && !new RegExp(DELIVERY_TOWN, 'i').test(geo.town) && (
                    <p className="t-caption muted">
                      OpenStreetMap lists this spot under {geo.town}. We go by your pin, which is inside {DELIVERY_TOWN}.
                    </p>
                  )}
                </>
              ) : (
                <ComingSoon onPickup={goPickup} />
              )}
            </div>
          </Row>
          <Row>
            <Button
              variant="text-small"
              height={48}
              full={false}
              onClick={() => {
                setStep('details')
                focusHeading()
              }}
            >
              Can't use the map? Type the address instead
            </Button>
          </Row>
        </Content>
      </Screen>
    )
  }

  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Delivery address" />}
      footer={
        <Button disabled={busy} onClick={save} aria-busy={busy}>
          {busy ? 'Saving…' : 'Save address'}
        </Button>
      }
    >
      <Content>
        <Row>
          <section className="card address-pin-summary" style={{ padding: 'var(--space-16)' }} aria-labelledby="pin-head">
            <h2 id="pin-head" className="t-h3">
              Delivery pin
            </h2>
            {pin ? (
              <>
                <PinPreview lat={pin.lat} lng={pin.lng} />
                <p className="t-body-sm">
                  {inside === false ? (
                    <>Outside {DELIVERY_AREA_LABEL}: delivery is coming soon here.</>
                  ) : (
                    <>Inside {DELIVERY_AREA_LABEL}. The rider goes to the pin.</>
                  )}
                </p>
              </>
            ) : (
              <Alert tone="warning" icon="pin">
                No pin yet. You can save the address, but delivery needs a pin on your door.
              </Alert>
            )}
            <div>
              <Button
                variant="secondary"
                height={48}
                full={false}
                icon={<Icon name="pin" size={20} />}
                onClick={() => {
                  setStep('pin')
                  focusHeading()
                }}
              >
                {pin ? 'Move the pin' : 'Pin it on the map'}
              </Button>
            </div>
          </section>
        </Row>
        <Row>
          <div className="address-form">
            <fieldset className="label-choice">
              <legend className="t-body-sm">Label</legend>
              {LABELS.map((l) => (
                <Chip key={l} label={l} selected={label === l} onClick={() => setLabel(l)} />
              ))}
            </fieldset>
            <TextField
              id="ad-recipient"
              label="Recipient name"
              value={recipient}
              error={v.err('recipient')}
              onBlur={() => v.touch('recipient')}
              onChange={(e) => setRecipient(e.target.value)}
              autoComplete="name"
              maxLength={100}
            />
            <TextField
              id="ad-mobile"
              label="Mobile number"
              helper="The rider calls this number. Philippine mobile, like 0917 123 4567."
              inputMode="tel"
              type="tel"
              value={mobile}
              error={v.err('mobile')}
              onBlur={() => v.touch('mobile')}
              onChange={(e) => setMobile(e.target.value)}
              autoComplete="tel"
            />
            <div className={`field ${v.err('barangay') ? 'field--error' : ''}`}>
              <label htmlFor="ad-barangay" className="t-body-sm">
                Barangay ({DELIVERY_TOWN})
              </label>
              <div className="field__input">
                <select
                  id="ad-barangay"
                  className="t-body"
                  value={barangay}
                  aria-invalid={!!v.err('barangay')}
                  aria-describedby={v.err('barangay') ? 'ad-barangay-note' : undefined}
                  autoComplete="address-level3"
                  onBlur={() => v.touch('barangay')}
                  onChange={(e) => {
                    edited.current.add('barangay')
                    setBarangay(e.target.value)
                  }}
                >
                  <option value="">Choose…</option>
                  {BOCAUE_BARANGAYS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              {v.err('barangay') && (
                <p id="ad-barangay-note" className="field__error t-caption" role="alert">
                  <Icon name="alert" size={16} />
                  {v.err('barangay')}
                </p>
              )}
            </div>
            <TextField
              id="ad-line"
              label="House no. and street"
              placeholder="e.g. 12 Mabini St"
              value={line}
              error={v.err('line')}
              onBlur={() => v.touch('line')}
              onChange={(e) => {
                edited.current.add('line')
                setLine(e.target.value)
              }}
              autoComplete="address-line1"
              maxLength={200}
            />
            <TextField
              id="ad-landmark"
              label="Landmark (optional)"
              placeholder="e.g. Blue gate, near the chapel"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              autoComplete="address-line2"
              maxLength={120}
            />
            <TextArea label="Delivery notes (optional)" placeholder="e.g. Call when you're outside" value={notes} onChange={setNotes} max={200} />
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        </Row>
      </Content>
    </Screen>
  )
}
