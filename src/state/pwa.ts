// Progressive web app: the service worker (offline use and updates) and installing to the home screen.
// The service worker is built by vite-plugin-pwa (see vite.config.ts); it precaches the whole app, so
// the installed app opens and browses offline from its first launch. It runs in built versions only,
// so `npm run dev` always shows the latest code.
import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

/** Chrome and Edge's install event (not yet in the DOM types) */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type PwaState = {
  /** A new version was downloaded and waits for a reload */
  needRefresh: boolean
  /** The browser offered to install the app (Android, desktop Chrome and Edge) */
  canInstall: boolean
  /** Running from the home screen, or installed during this visit */
  installed: boolean
}

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

let state: PwaState = { needRefresh: false, canInstall: false, installed: standalone() }
const listeners = new Set<() => void>()
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

let deferred: BeforeInstallPromptEvent | null = null
let updateSW: ((reload?: boolean) => Promise<void>) | undefined

/** Called once at start-up, before React renders, so the install event is never missed */
export function startPwa() {
  if (import.meta.env.PROD) {
    updateSW = registerSW({
      // A new build is waiting: ask before switching, so nobody is reloaded in the middle of checkout
      onNeedRefresh: () => set({ needRefresh: true }),
      onRegisterError: () => {
        /* not served over https (or blocked): the app still runs, just not offline */
      },
    })
    // The hand-written worker before this one kept everything in "megs-v1"; free that space
    window.caches?.delete('megs-v1').catch(() => {})
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // shown from Settings instead of the browser's mini-bar
    deferred = e as BeforeInstallPromptEvent
    set({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    set({ canInstall: false, installed: true })
  })
}

/** Reloads into the new version */
export function applyUpdate() {
  void updateSW?.(true)
}

/** Opens the browser's install dialog */
export async function promptInstall() {
  if (!deferred) return 'unavailable' as const
  const e = deferred
  deferred = null
  set({ canInstall: false })
  await e.prompt()
  const { outcome } = await e.userChoice
  return outcome
}

/** iPhone and iPad install through Share → Add to Home Screen; Safari has no install event */
export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function usePwa() {
  return useSyncExternalStore(subscribe, () => state)
}
