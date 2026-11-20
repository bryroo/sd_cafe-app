// Settings → Appearance: follow the device (default), or force light or dark.
// index.html applies the saved choice before the first paint, so there is no flash.
import { useState } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'megs.theme'
/** The browser bar colours (index.html's theme-color metas) for each theme */
const BAR = { light: '#ebebe8', dark: '#121212' }

export function readTheme(): ThemePref {
  try {
    const t = window.localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(t: ThemePref) {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
  // The phone's status bar follows: forced themes override both media-specific metas
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const media = m.getAttribute('media') ?? ''
    const own = media.includes('dark') ? BAR.dark : BAR.light
    m.content = t === 'system' ? own : BAR[t]
  })
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [theme, setTheme] = useState(readTheme)
  return [
    theme,
    (t) => {
      try {
        if (t === 'system') window.localStorage.removeItem(KEY)
        else window.localStorage.setItem(KEY, t)
      } catch {
        /* storage blocked: applies for this visit only */
      }
      applyTheme(t)
      setTheme(t)
    },
  ]
}
