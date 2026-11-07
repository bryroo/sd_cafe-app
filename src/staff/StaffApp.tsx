// Staff console (SRS 3.2.11 – 3.2.14): mounted at #/staff, with its own shell outside the phone frame.
// A rail of five destinations on a tablet, a bottom bar on a phone. It reads and writes the shared
// store, so the customer app in another tab follows every action within a second or two.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '../components/Icon'
import { Lamp } from '../components/Lamp'
import { LogoMark } from '../components/ui'
import { useOnline } from '../state/online'
import { failNextWrite, openState, setStore, useShared, clock, lastSynced } from '../state/shared'
import { Modal, NewOrders, StaffButton, StaffCtx, type StaffApi } from './kit'
import { Dashboard, OrderDetail, OrderQueue } from './orders'
import { AutomationDetail, Automations } from './automations'
import { ResponseEditor, Responses } from './responses'
import { Availability, StaffLogin, StaffProfile, StoreSettings } from './settings'
import './staff.css'

type Dest = { to: string; label: string; icon: IconName; match: string }

const DESTS: Dest[] = [
  { to: '/staff', label: 'Dashboard', icon: 'grid', match: '/staff' },
  { to: '/staff/orders', label: 'Orders', icon: 'receipt', match: '/staff/orders' },
  { to: '/staff/automations', label: 'Automations', icon: 'repeat', match: '/staff/automations' },
  { to: '/staff/responses', label: 'Responses', icon: 'message', match: '/staff/responses' },
  { to: '/staff/settings', label: 'Settings', icon: 'sliders', match: '/staff/settings' },
]

/** Two short tones for a new order (no sound file needed) */
function chime() {
  try {
    const ctx = new AudioContext()
    ;[880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.18)
      o.stop(ctx.currentTime + i * 0.18 + 0.32)
    })
    setTimeout(() => ctx.close(), 1000)
  } catch {
    /* the browser blocks sound until the page has been tapped once */
  }
}

export function StaffApp() {
  const shared = useShared()
  const location = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  const [now, setNow] = useState(Date.now())
  const [toast, setToast] = useState<{ text: string; action?: { label: string; onClick: () => void }; id: number } | null>(null)
  const [error, setError] = useState<{ retry: () => void; message?: string } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  const dirty = useRef(false)
  const [, setFreshTick] = useState(0)
  const known = useRef<Set<number> | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  // Demo: `?fail=1` makes the next write fail, to show the error state
  useEffect(() => {
    if (new URLSearchParams(location.search).get('fail') === '1') failNextWrite()
  }, [location.search])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.action ? 5000 : 3500)
    return () => clearTimeout(t)
  }, [toast])

  // FR-STF-04: a new order slides in, highlighted for 2 s, with an optional chime
  useEffect(() => {
    // Only once the queue has loaded: the orders already there aren't "new"
    if (!shared.ready || !shared.staff.signedIn) return
    const numbers = shared.orders.map((o) => o.number)
    if (!known.current) {
      known.current = new Set(numbers)
      return
    }
    const arrived = numbers.filter((n) => !known.current!.has(n))
    if (!arrived.length) return
    arrived.forEach((n) => {
      known.current!.add(n)
      NewOrders.fresh.add(n)
    })
    setFreshTick((t) => t + 1)
    if (shared.store.chime && shared.staff.signedIn) chime()
    const t = setTimeout(() => {
      arrived.forEach((n) => NewOrders.fresh.delete(n))
      setFreshTick((x) => x + 1)
    }, 2000)
    return () => clearTimeout(t)
  }, [shared.orders, shared.store.chime, shared.staff.signedIn, shared.ready])

  const go = useCallback(
    (to: string) => {
      if (dirty.current) setPending(to)
      else navigate(to)
    },
    [navigate],
  )

  const api = useMemo<StaffApi>(
    () => ({
      toast: (text, action) => setToast({ text, action, id: Date.now() }),
      act: (write, success) => {
        const failed = (err: unknown) => {
          console.warn('MEGS staff: update failed', err)
          setError({ retry: () => api.act(write, success), message: err instanceof Error ? err.message : undefined })
        }
        try {
          const result = write()
          // Database writes are async: the toast waits for the answer; a refusal shows the error with Retry
          if (result instanceof Promise) {
            result.then(
              () => {
                setError(null)
                if (success) setToast({ text: success, id: Date.now() })
              },
              failed,
            )
            return true
          }
          setError(null)
          if (success) setToast({ text: success, id: Date.now() })
          return true
        } catch (err) {
          failed(err)
          return false
        }
      },
      go,
      setDirty: (d) => {
        dirty.current = d
      },
      online,
      now,
    }),
    [go, online, now],
  )

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const path = location.pathname
  // Wait for a saved session to load before sending anyone to the sign-in screen
  if (!shared.ready && !shared.staff.signedIn) return <div className="staff staff--login" aria-busy="true" />
  if (!shared.staff.signedIn && path !== '/staff/login') return <Navigate to="/staff/login" replace />
  if (path === '/staff/login')
    return (
      <StaffCtx.Provider value={api}>
        <div className="staff staff--login">
          <StaffLogin />
        </div>
      </StaffCtx.Provider>
    )

  const newCount = shared.orders.filter((o) => o.status === 'Received').length
  const failCount = shared.automations.filter((a) => a.state === 'failed' && !a.handled).length
  const badges: Record<string, number> = { '/staff/orders': newCount, '/staff/automations': failCount }
  const current = [...DESTS].sort((a, b) => b.match.length - a.match.length).find((d) => path.startsWith(d.match))
  const open = openState(shared.store, now)

  const nav = (cls: string) => (
    <nav className={cls} aria-label="Staff console">
      {DESTS.map((d) => {
        const on = current?.to === d.to
        const badge = badges[d.to] ?? 0
        return (
          <a
            key={d.to}
            href={`#${d.to}`}
            className={`st-nav__item ${on ? 'is-active' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault()
              go(d.to)
            }}
          >
            <span className="st-nav__icon">
              <Icon name={d.icon} />
              {badge > 0 && (
                <span className="st-nav__badge num" aria-label={`${badge} need attention`}>
                  {badge}
                </span>
              )}
            </span>
            <span className="st-nav__label">{d.label}</span>
          </a>
        )
      })}
    </nav>
  )

  return (
    <StaffCtx.Provider value={api}>
      <div className="staff">
        <aside className="st-rail">
          <span className="st-rail__mark">
            <LogoMark size={44} />
          </span>
          {nav('st-nav st-nav--rail')}
        </aside>
        <div className="st-main">
          <header className="st-top">
            <span className="st-top__title t-h3">MEGS' Cafe · Staff</span>
            <span className={`st-top__state t-body-sm ${open.open ? 'is-open' : ''}`}>
              <Lamp state={open.open ? 'lit' : 'off'} size={22} />
              {open.open ? 'Accepting orders' : shared.store.acceptingOrders ? 'Closed (outside hours)' : 'Not accepting orders'}
            </span>
            <button className="st-top__who t-body-sm" onClick={() => go('/staff/profile')}>
              <Icon name="user" size={20} />
              {shared.staff.name}
            </button>
          </header>

          {/* FR-OPS-01: while orders are off, every staff screen says so */}
          {!shared.store.acceptingOrders && (
            <div className="st-banner st-banner--off" role="status">
              <Icon name="alert" size={20} />
              <span className="t-body-sm">
                <strong>Not accepting orders.</strong> Customers can browse and fill a cart, but can't place an order.
              </span>
              <StaffButton small variant="secondary" onClick={() => api.act(() => setStore({ acceptingOrders: true }), 'Accepting orders again')}>
                Turn on
              </StaffButton>
            </div>
          )}
          {!online && (
            <div className="st-banner" role="status">
              <Icon name="offline" size={20} />
              <span className="t-body-sm">Offline. Showing the queue as of {clock(lastSynced())}. Actions are paused.</span>
            </div>
          )}
          {error && (
            <div className="st-banner st-banner--error" role="alert">
              <Icon name="alert" size={20} />
              <span className="t-body-sm">
                {error.message && !/Couldn't update|Simulated/.test(error.message)
                  ? `${error.message} Nothing was changed.`
                  : "Couldn't update. Try again. Nothing was changed."}
              </span>
              <StaffButton small variant="secondary" onClick={error.retry}>
                Retry
              </StaffButton>
              <button className="st-icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
                <Icon name="close" size={20} />
              </button>
            </div>
          )}

          <main className="st-content">
            <Routes>
              <Route index element={<Dashboard onTurnOff={() => setConfirmOff(true)} />} />
              <Route path="orders" element={<OrderQueue />} />
              <Route path="orders/:number" element={<OrderDetail />} />
              <Route path="automations" element={<Automations />} />
              <Route path="automations/:id" element={<AutomationDetail />} />
              <Route path="responses" element={<Responses />} />
              <Route path="responses/:event" element={<ResponseEditor />} />
              <Route path="settings" element={<StoreSettings onTurnOff={() => setConfirmOff(true)} />} />
              <Route path="availability" element={<Availability />} />
              <Route path="profile" element={<StaffProfile />} />
              <Route path="*" element={<Navigate to="/staff" replace />} />
            </Routes>
          </main>
        </div>
        {nav('st-nav st-nav--bottom')}

        {toast && (
          <div className="st-toast" role="status" key={toast.id}>
            <span className="t-body">{toast.text}</span>
            {toast.action && (
              <button
                className="st-toast__action t-button"
                onClick={() => {
                  toast.action!.onClick()
                  setToast(null)
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}

        {/* OA-04 Discard changes? */}
        {pending && (
          <Modal
            title="Discard your changes?"
            onClose={() => setPending(null)}
            actions={
              <>
                <StaffButton onClick={() => setPending(null)}>Keep editing</StaffButton>
                <StaffButton
                  variant="danger"
                  onClick={() => {
                    dirty.current = false
                    const to = pending
                    setPending(null)
                    navigate(to)
                  }}
                >
                  Discard
                </StaffButton>
              </>
            }
          >
            <p className="t-body">The template has edits that aren't saved. Leaving now throws them away.</p>
          </Modal>
        )}

        {/* FR-OPS-01: turning orders off needs a confirmation */}
        {confirmOff && (
          <Modal
            title="Stop accepting orders?"
            tone="danger"
            onClose={() => setConfirmOff(false)}
            actions={
              <>
                <StaffButton
                  variant="danger"
                  onClick={() => {
                    setConfirmOff(false)
                    api.act(() => setStore({ acceptingOrders: false }), 'Orders are off')
                  }}
                >
                  Stop accepting orders
                </StaffButton>
                <StaffButton variant="secondary" onClick={() => setConfirmOff(false)}>
                  Keep accepting
                </StaffButton>
              </>
            }
          >
            <p className="t-body">
              Customers will see that the cafe isn't taking orders. They can still browse and keep their cart. Orders already
              in the queue are not affected.
            </p>
          </Modal>
        )}
      </div>
    </StaffCtx.Provider>
  )
}
