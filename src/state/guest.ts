// Guests (browse as guest, or signed out) can browse and view products only: no cart, no orders,
// nothing account-related. The server enforces the same (anon can only read the catalog); this is
// the app side: ask them to log in, and bring them back to where they were.
import { useLocation } from 'react-router-dom'
import { useOverlay } from '../overlays/OverlayHost'
import { useApp } from './AppState'

/** "/log-in?next=%2Fproduct%2Flatte" — the screen to come back to after logging in or signing up */
export const withNext = (path: '/log-in' | '/sign-up', next?: string) =>
  next ? `${path}?next=${encodeURIComponent(next)}` : path

/** A `?next=` value, only if it is a path inside this app (never another site) */
export const safeNext = (raw: string | null) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null)

/** Runs a member-only action, or asks a guest to log in (and come back here afterwards). */
export function useGuestGate() {
  const { isMember } = useApp()
  const overlay = useOverlay()
  const { pathname, search } = useLocation()
  return {
    isMember,
    requireMember: (action: () => void, opts: { title?: string; body?: string; next?: string } = {}) => {
      if (isMember) return action()
      overlay.open('login-to-order', { next: opts.next ?? pathname + search, title: opts.title, body: opts.body })
    },
  }
}
