// Small UI feedback signals shared across the shell (no app state, nothing persisted).
import { useEffect, useRef, useState } from 'react'
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

/** A number that counts up to its new value when it grows (points after an order completes).
 *  Jumps straight there with reduced motion, on the first render, and when it goes down. */
export function useCountUp(value: number, ms = 600) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    from.current = value
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (value <= start || still) {
      setShown(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}
