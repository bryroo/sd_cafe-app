// Layout breakpoints as React state (the same ones the CSS uses).
import { useEffect, useState } from 'react'

/** Follows a CSS media query. */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** True on tablets and desktops (the rail/sidebar layouts). */
export const useWide = () => useMedia('(min-width: 768px)')
