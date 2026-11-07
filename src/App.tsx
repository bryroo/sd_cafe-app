import { useEffect, useRef, useState } from 'react'
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppStateProvider, useApp } from './state/AppState'
import { index, overlayIndex, routes, staffIndex } from './routes'
import { ComingSoon } from './screens/shop'
import { OverlayHost, useOverlay } from './overlays/OverlayHost'
import { StaffApp } from './staff/StaffApp'
import { useAutoAdvance, useShared } from './state/shared'
import { applyUpdate, usePwa } from './state/pwa'
import './app-shell.css'

/** Shrinks the 852px-tall phone frame to fit short desktop windows. */
function usePhoneScale() {
  const fit = () => Math.min(1, (window.innerHeight - 48) / 852)
  const [scale, setScale] = useState(fit)
  useEffect(() => {
    const onResize = () => setScale(fit())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return scale
}

/** Left-hand list of every Figma frame; clicking one jumps the phone to that screen/state. */
function ScreenIndex() {
  const app = useApp()
  const overlay = useOverlay()
  const navigate = useNavigate()
  const location = useLocation()
  const here = location.pathname + location.search
  const [picked, setPicked] = useState<string | null>(null)

  return (
    <nav className="shell__index" aria-label="Screens">
      <p className="shell__brand">MEGS' Cafe · prototype</p>
      {[...index, overlayIndex, staffIndex].map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          {g === staffIndex && <p className="shell__note">Opens in a new tab, so the phone and the console sit side by side.</p>}
          <ul>
            {g.entries.map((e) => {
              const id = `${e.code}${e.label}`
              const active = !e.external && e.to === here && (picked === null || picked === id)
              return (
                <li key={id}>
                  <a
                    href={`#${e.to}`}
                    className={active ? 'active' : ''}
                    target={e.external ? '_blank' : undefined}
                    rel={e.external ? 'noopener' : undefined}
                    onClick={(ev) => {
                      ev.preventDefault()
                      e.prep?.(app)
                      if (e.external) {
                        window.open(`${window.location.pathname}#${e.to}`, '_blank', 'noopener')
                        return
                      }
                      overlay.close()
                      setPicked(id)
                      navigate(e.to)
                      if (e.overlay) setTimeout(() => overlay.open(e.overlay!, e.overlayData), 50)
                    }}
                  >
                    <span className="shell__code">{e.code}</span>
                    {e.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}

/** FR-TRK-03: a new notification shows as a toast in the open app, and as a phone notification for the
 *  push events (Accepted, Ready, Delayed, Cancelled) when the customer allowed them. */
function CustomerNotifier() {
  const { notifications, ready } = useShared()
  const { notificationsOn, session } = useApp()
  const overlay = useOverlay()
  const navigate = useNavigate()
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    // Messages already there when the account loads aren't new
    if (!ready || session !== 'member') return
    if (!seen.current) {
      seen.current = new Set(notifications.map((n) => n.id))
      return
    }
    const fresh = notifications.filter((n) => !seen.current!.has(n.id))
    fresh.forEach((n) => seen.current!.add(n.id))
    // The customer's own actions already show on screen
    const n = fresh.find((x) => x.event !== 'received' && x.event !== 'cancelled-customer')
    if (!n || session !== 'member') return
    overlay.toast(`${n.title}. ${n.body}`, { label: 'View', onClick: () => navigate(n.to) })
    if (n.push && notificationsOn && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(n.title, { body: n.body, tag: n.id })
      } catch {
        /* some phones only allow notifications from an installed app */
      }
    }
  }, [notifications, notificationsOn, session, overlay, navigate, ready])

  return null
}

/** A new version of the app was downloaded: offer the reload instead of switching mid-order. If the
 *  toast is missed, the new version starts the next time the app is opened from scratch. */
function AppUpdates() {
  const { needRefresh } = usePwa()
  const overlay = useOverlay()
  useEffect(() => {
    if (needRefresh) overlay.toast('A new version of the app is ready.', { label: 'Reload', onClick: applyUpdate })
  }, [needRefresh, overlay])
  return null
}

/** The customer app: a 393×852 phone frame plus a screen index for jumping between Figma frames. */
function CustomerApp() {
  const scale = usePhoneScale()
  return (
    <AppStateProvider>
      <OverlayHost>
        <CustomerNotifier />
        <AppUpdates />
        <div className="shell">
          <ScreenIndex />
          <main className="shell__stage">
            <div id="phone" className="phone" style={{ ['--phone-scale' as string]: scale }}>
              <Routes>
                {routes.map((r) => (
                  <Route key={r.path} path={r.path} element={r.element} />
                ))}
                <Route path="*" element={<ComingSoon title="Coming soon" />} />
              </Routes>
            </div>
          </main>
        </div>
      </OverlayHost>
    </AppStateProvider>
  )
}

export default function App() {
  // Demo only: when staff turn on auto-advance, open orders move on by themselves (in either app)
  useAutoAdvance()
  return (
    <HashRouter>
      <Routes>
        {/* The staff console has its own shell, outside the phone frame */}
        <Route path="/staff/*" element={<StaffApp />} />
        <Route path="*" element={<CustomerApp />} />
      </Routes>
    </HashRouter>
  )
}
