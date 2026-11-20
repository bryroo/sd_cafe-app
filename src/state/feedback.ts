// Small UI feedback signals shared across the shell (no app state, nothing persisted).
import { useEffect, useState } from 'react'
import { useApp } from './AppState'
import { useShared } from './shared'

const CART_ADDED = 'megs:cart-added'

/** Something was just added to the cart: the cart badges light up like a lamp. */
export function signalCartAdded() {
  window.dispatchEvent(new Event(CART_ADDED))
}

/** Counts "added" signals. Use it as a React `key` on the badge so its glow animation replays. */
export function useCartGlow() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const on = () => setN((x) => x + 1)
    window.addEventListener(CART_ADDED, on)
    return () => window.removeEventListener(CART_ADDED, on)
  }, [])
  return n
}

/** Unread notifications for the signed-in customer (0 for guests). */
export function useUnreadCount() {
  const { notifications } = useShared()
  const { session } = useApp()
  return session === 'member' ? notifications.filter((n) => !n.read).length : 0
}
