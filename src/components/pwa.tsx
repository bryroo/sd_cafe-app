// App-level PWA chrome shared by the customer app and the staff console: the "new version" banner,
// the offline indicator and the install card. State comes from src/state/pwa.ts and src/state/online.ts.
import { useState } from 'react'
import { Icon } from './Icon'
import { applyUpdate, isIos, promptInstall, usePwa } from '../state/pwa'
import { useOnline } from '../state/online'
import './pwa.css'

/** A new version is downloaded. It waits until the person chooses to reload: never mid-checkout or
 *  mid-edit. If they ignore it, the new version starts the next time the app is opened. */
export function UpdateBanner() {
  const { needRefresh } = usePwa()
  if (!needRefresh) return null
  return (
    <div className="pwa-update" role="status" aria-live="polite">
      <span className="t-body-sm pwa-update__text">New version available</span>
      <button className="t-button pwa-update__action" onClick={applyUpdate}>
        Reload
      </button>
    </div>
  )
}

/** Always visible while there's no connection: what's on screen is the last saved copy */
export function OfflineIndicator() {
  const online = useOnline()
  return (
    <div className="pwa-offline" role="status" aria-live="polite">
      {!online && (
        <span className="pwa-offline__pill t-caption">
          <Icon name="offline" size={16} />
          Offline · showing saved data
        </span>
      )}
    </div>
  )
}

const DISMISSED = 'megs.install-card.dismissed'
const wasDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED) === '1'
  } catch {
    return false
  }
}

/** Home: offer to install once. Android and desktop open the browser's dialog; iPhone and iPad get
 *  Safari's steps (it has no install event). Hidden once installed or dismissed. */
export function InstallCard() {
  const pwa = usePwa()
  const [hidden, setHidden] = useState(wasDismissed)
  const ios = isIos()
  if (hidden || pwa.installed || !(pwa.canInstall || ios)) return null
  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      /* storage blocked: shown again next visit */
    }
  }
  return (
    <section className="pwa-install" aria-label="Install the app">
      <img className="pwa-install__icon" src="./icons/icon-192.png" alt="" width={44} height={44} />
      <div className="pwa-install__text">
        <p className="t-h3">Get the MEGS' app</p>
        {ios ? (
          <p className="t-body-sm muted">
            Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. It opens full screen and works offline.
          </p>
        ) : (
          <p className="t-body-sm muted">Opens full screen, works offline, one tap from your home screen.</p>
        )}
      </div>
      <div className="pwa-install__actions">
        {!ios && (
          <button
            className="t-button pwa-install__go"
            onClick={async () => {
              if ((await promptInstall()) === 'accepted') dismiss()
            }}
          >
            Install
          </button>
        )}
        <button className="pwa-install__close" aria-label={ios ? 'Got it' : 'Not now'} onClick={dismiss}>
          <Icon name="close" size={20} />
        </button>
      </div>
    </section>
  )
}
