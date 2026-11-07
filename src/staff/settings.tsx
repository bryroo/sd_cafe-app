// Store operations and staff account (SRS 3.2.14, FR-STF-01): A-01 Staff login, A-09 Settings,
// A-10 Item availability, A-11 Staff profile.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { LogoMark, Toggle } from '../components/ui'
import { products } from '../data/menu'
import {
  DAYS,
  LOCK_AFTER,
  LOCK_MINUTES,
  STAFF_LOGIN,
  getShared,
  hourLabel,
  resetDemoData,
  setStore,
  staffLogin,
  staffLogout,
  useShared,
  type Hours,
} from '../state/shared'
import { Fact, Modal, Panel, StaffButton, useStaff } from './kit'

/* ---------- A-01 Staff login ---------- */

const mmss = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export function StaffLogin() {
  const navigate = useNavigate()
  const { online } = useStaff()
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [error, setError] = useState('')
  const [lockedUntil, setLockedUntil] = useState(() => getShared().staff.lockedUntil)
  const [now, setNow] = useState(Date.now())
  const locked = lockedUntil > now

  useEffect(() => {
    if (!locked) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [locked])

  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const r = await staffLogin(user, password)
    setBusy(false)
    setNow(Date.now())
    if (r.ok) return navigate('/staff', { replace: true })
    if (r.notStaff) return setError("This account isn't a staff account.")
    if (r.offline) return setError("Couldn't reach the cafe. Check the connection and try again.")
    if (r.lockedUntil) {
      setLockedUntil(r.lockedUntil)
      setError('')
    } else setError(`Username or password is wrong. ${r.left} attempt${r.left === 1 ? '' : 's'} left before sign-in is locked.`)
  }

  return (
    <form className="st-login" onSubmit={submit}>
      <LogoMark size={72} />
      <h1 className="t-h1">Staff sign-in</h1>
      <p className="t-body-sm muted">
        Demo: username <strong className="num">{STAFF_LOGIN.username}</strong>, password{' '}
        <strong className="num">{STAFF_LOGIN.password}</strong>. {LOCK_AFTER} wrong tries lock sign-in for {LOCK_MINUTES} minutes.
      </p>
      {!online && <p className="st-form-error t-body-sm">You're offline. Connect to sign in.</p>}
      {locked && (
        <p className="st-form-error t-body-sm" role="alert">
          <Icon name="lock" size={18} />
          <span>
            Too many attempts. Try again in <span className="num">{mmss(lockedUntil - now)}</span>.
          </span>
        </p>
      )}
      {error && !locked && (
        <p className="st-form-error t-body-sm" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </p>
      )}
      <label className="st-field">
        <span className="t-body-sm">Username or email</span>
        <input className="st-input t-body" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
      </label>
      <label className="st-field">
        <span className="t-body-sm">Password</span>
        <span className="st-input-wrap">
          <input
            className="st-input t-body"
            type={shown ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button type="button" className="st-reveal t-body-sm" onClick={() => setShown((v) => !v)} aria-pressed={shown}>
            {shown ? 'Hide' : 'Show'}
          </button>
        </span>
      </label>
      <button className="st-btn st-btn--primary st-btn--wide" type="submit" disabled={!user || !password || locked || !online || busy} aria-busy={busy}>
        <span className="t-button">{busy ? 'Signing in…' : 'Sign in'}</span>
      </button>
    </form>
  )
}

/* ---------- A-09 Store settings ---------- */

export function StoreSettings({ onTurnOff }: { onTurnOff: () => void }) {
  const { store } = useShared()
  const { act, go } = useStaff()
  const [confirmReset, setConfirmReset] = useState(false)
  const [fee, setFee] = useState(String(store.deliveryFee))
  const [prep, setPrep] = useState(String(store.prepMinutes))
  const save = (change: Parameters<typeof setStore>[0], msg = 'Saved') => act(() => setStore(change), msg)

  const setDay = (i: number, h: Partial<Hours>) =>
    save((s) => ({ hours: s.hours.map((d, j) => (j === i ? { ...d, ...h } : d)) }), `${DAYS[i]} hours saved`)

  return (
    <div className="st-page">
      <h1 className="t-h1">Store settings</h1>

      <Panel title="Orders">
        <div className="st-toggles">
          <Toggle
            label="Accepting orders"
            description={store.acceptingOrders ? 'Customers can place orders' : 'Customers can browse but not order'}
            on={store.acceptingOrders}
            onChange={(v) => (v ? save({ acceptingOrders: true }, 'Accepting orders again') : onTurnOff())}
          />
        </div>
        <label className="st-field st-field--inline">
          <span className="t-body">
            Default preparation time
            <span className="t-body-sm muted"> · the pickup estimate customers see</span>
          </span>
          <span className="st-input-wrap st-input-wrap--unit">
            <input
              className="st-input t-body num"
              type="number"
              min={1}
              max={90}
              value={prep}
              onChange={(e) => setPrep(e.target.value)}
              onBlur={() => Number(prep) > 0 && Number(prep) !== store.prepMinutes && save({ prepMinutes: Number(prep) }, 'Preparation time saved')}
            />
            <span className="t-body-sm muted">min</span>
          </span>
        </label>
      </Panel>

      <Panel title="Opening hours" action={<span className="t-body-sm muted">Asia/Manila time</span>}>
        <div className="st-hours">
          {store.hours.map((h, i) => (
            <div key={DAYS[i]} className={`st-hours__row ${h.closed ? 'is-closed' : ''}`}>
              <span className="t-body st-hours__day">{DAYS[i]}</span>
              <label className="st-check t-body-sm">
                <input type="checkbox" checked={!h.closed} onChange={(e) => setDay(i, { closed: !e.target.checked })} />
                Open
              </label>
              <input
                className="st-input st-input--time t-body num"
                type="time"
                value={h.open}
                disabled={h.closed}
                aria-label={`${DAYS[i]} opens`}
                onChange={(e) => e.target.value && setDay(i, { open: e.target.value })}
              />
              <span className="t-body-sm muted">to</span>
              <input
                className="st-input st-input--time t-body num"
                type="time"
                value={h.close}
                disabled={h.closed}
                aria-label={`${DAYS[i]} closes`}
                onChange={(e) => e.target.value && setDay(i, { close: e.target.value })}
              />
              <span className="t-body-sm muted st-hours__label">
                {h.closed ? 'Closed' : `${hourLabel(h.open)} – ${hourLabel(h.close)}`}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Delivery">
        <div className="st-toggles">
          <Toggle
            label="Delivery"
            description={store.deliveryEnabled ? 'Customers can choose delivery' : 'Pickup only'}
            on={store.deliveryEnabled}
            onChange={(v) => save({ deliveryEnabled: v }, v ? 'Delivery on' : 'Delivery off')}
          />
        </div>
        <label className="st-field st-field--inline">
          <span className="t-body">Delivery fee</span>
          <span className="st-input-wrap st-input-wrap--unit">
            <span className="t-body-sm muted">₱</span>
            <input
              className="st-input t-body num"
              type="number"
              min={0}
              max={500}
              value={fee}
              disabled={!store.deliveryEnabled}
              onChange={(e) => setFee(e.target.value)}
              onBlur={() => Number(fee) >= 0 && Number(fee) !== store.deliveryFee && save({ deliveryFee: Number(fee) }, 'Delivery fee saved')}
            />
          </span>
        </label>
        <p className="t-caption muted">Service area: to be decided (SRS TBD).</p>
      </Panel>

      <Panel title="Console">
        <div className="st-toggles">
          <Toggle
            label="New-order chime"
            description="A short sound when an order arrives"
            on={store.chime}
            onChange={(v) => save({ chime: v }, v ? 'Chime on' : 'Chime muted')}
          />
        </div>
      </Panel>

      <Panel title="Demo">
        <div className="st-toggles">
          <Toggle
            label="Demo mode"
            description={
              store.demoMode
                ? 'The screen index, demo sign-ins, auto-advance and Reset demo data work. Turn off before a real launch.'
                : 'Demo tools are off: the app behaves as the real product.'
            }
            on={store.demoMode}
            onChange={(v) => save({ demoMode: v, ...(v ? {} : { autoAdvance: false }) }, v ? 'Demo mode on' : 'Demo mode off')}
          />
          {store.demoMode && (
            <Toggle
              label="Auto-advance orders (demo)"
              description="While this console is open, every open order moves on a step every 8 seconds, for demos with one person."
              on={store.autoAdvance}
              onChange={(v) => save({ autoAdvance: v }, v ? 'Auto-advance on' : 'Auto-advance off')}
            />
          )}
        </div>
        {store.demoMode && (
          <div>
            <StaffButton variant="secondary" icon="refresh" onClick={() => setConfirmReset(true)}>
              Reset demo data
            </StaffButton>
          </div>
        )}
      </Panel>
      {confirmReset && (
        <Modal
          title="Reset the demo?"
          tone="danger"
          onClose={() => setConfirmReset(false)}
          actions={
            <>
              <StaffButton
                variant="danger"
                onClick={() => {
                  setConfirmReset(false)
                  act(() => resetDemoData(), 'Demo data reset')
                }}
              >
                Reset demo data
              </StaffButton>
              <StaffButton variant="secondary" onClick={() => setConfirmReset(false)}>
                Keep it as it is
              </StaffButton>
            </>
          }
        >
          <p className="t-body">
            Every order and automated order is cleared and the demo customers (Maria, Ana, Jen, Leo, Paolo, Carlo) are
            recreated with their sample orders, points and vouchers. Store settings go back to their defaults.
          </p>
        </Modal>
      )}

      <Panel>
        <button className="st-link-row" onClick={() => go('/staff/availability')}>
          <Icon name="cup" size={22} />
          <span className="t-body">Item availability</span>
          <span className="t-body-sm muted">
            {Object.values(store.availability).filter((a) => !a.available).length} sold out
          </span>
          <Icon name="chevron" size={20} />
        </button>
        <button className="st-link-row" onClick={() => go('/staff/profile')}>
          <Icon name="user" size={22} />
          <span className="t-body">Your profile</span>
          <Icon name="chevron" size={20} />
        </button>
      </Panel>
    </div>
  )
}

/* ---------- A-10 Item availability ---------- */

export function Availability() {
  const { store } = useShared()
  const { act, go } = useStaff()
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const list = products.filter((p) => !query || p.name.toLowerCase().includes(query))

  const set = (id: string, available: boolean, reason?: string) =>
    act(
      () =>
        setStore((s) => {
          const next = { ...s.availability }
          // Back to the sheet's own value when an item is turned on again
          if (available) delete next[id]
          else next[id] = { available: false, reason: reason || undefined }
          return { availability: next }
        }),
      available ? 'Back on the menu' : 'Marked sold out',
    )

  return (
    <div className="st-page">
      <button className="st-back t-body-sm" onClick={() => go('/staff/settings')}>
        <Icon name="back" size={20} />
        Store settings
      </button>
      <h1 className="t-h1">Item availability</h1>
      <p className="t-body muted">Sold-out items are dimmed in the customer app straight away, and carts holding them can't check out.</p>
      <label className="st-search">
        <Icon name="search" size={20} />
        <input className="t-body" placeholder="Search the menu" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the menu" />
      </label>
      <div className="st-rows">
        {list.map((p) => {
          const o = store.availability[p.id]
          return (
            <div key={p.id} className={`st-row st-avail ${p.available ? '' : 'is-out'}`}>
              <span className="st-avail__name">
                <span className="t-body">{p.name}</span>
                {!p.available && (
                  <input
                    className="st-input st-input--small t-body-sm"
                    placeholder="Reason (optional), e.g. out of ube"
                    defaultValue={o?.reason ?? ''}
                    aria-label={`Why ${p.name} is sold out`}
                    onBlur={(e) => e.target.value !== (o?.reason ?? '') && set(p.id, false, e.target.value.trim())}
                  />
                )}
              </span>
              <span className="st-avail__toggle">
                <Toggle label={p.available ? 'Available' : 'Sold out'} on={p.available} onChange={(v) => set(p.id, v)} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- A-11 Staff profile ---------- */

export function StaffProfile() {
  const { staff } = useShared()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="st-page">
      <h1 className="t-h1">Your profile</h1>
      <Panel>
        <Fact label="Name">{staff.name}</Fact>
        <Fact label="Role">{staff.role}</Fact>
        <Fact label="Username">{staff.username ?? '—'}</Fact>
      </Panel>
      <div>
        <StaffButton variant="danger" icon="logout" onClick={() => setConfirm(true)}>
          Log out
        </StaffButton>
      </div>
      {confirm && (
        <Modal
          title="Log out of the console?"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <StaffButton
                variant="danger"
                onClick={() => {
                  void staffLogout().finally(() => navigate('/staff/login', { replace: true }))
                }}
              >
                Log out
              </StaffButton>
              <StaffButton variant="secondary" onClick={() => setConfirm(false)}>
                Stay signed in
              </StaffButton>
            </>
          }
        >
          <p className="t-body">New orders still arrive; you'll see them when you sign back in.</p>
        </Modal>
      )}
    </div>
  )
}
