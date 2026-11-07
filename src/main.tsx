import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadCatalog } from './data/catalog'
import { startShared } from './state/shared'
import { startPwa } from './state/pwa'

// Offline use, updates and the install prompt (src/state/pwa.ts)
startPwa()

// The menu comes from the database: the saved copy at once, or a first load before the app renders
// (the splash screen in index.html stays up meanwhile). Then this tab's account data, kept live.
loadCatalog()
  .catch((err) => console.warn('MEGS: menu not loaded', err))
  .finally(() => {
    startShared()
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
