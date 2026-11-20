import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { LogoMark } from './ui'
import { CountBadge } from './blocks'
import { useWide } from '../state/media'
import './screen.css'

type Theme = 'light' | 'dark'

/** System / StatusBar */
export function StatusBar({ theme = 'light' }: { theme?: Theme }) {
  return (
    <div className={`status-bar status-bar--${theme}`}>
      <span className="t-button">9:41</span>
      <div className="status-bar__indicators" aria-hidden>
        <span className="status-bar__signal" />
        <span className="status-bar__wifi" />
        <span className="status-bar__battery" />
      </div>
    </div>
  )
}

/** System / HomeIndicator */
export function HomeIndicator({ theme = 'light' }: { theme?: Theme }) {
  return (
    <div className={`home-indicator home-indicator--${theme}`} aria-hidden>
      <span />
    </div>
  )
}

type TopBarProps = {
  title?: string
  /**
   * back  — back button + left-aligned H3 title (default)
   * home  — the MEGS' mark, then the title (Home: the shell names the product)
   * title — a large left-aligned title in the wide face (tab roots like Menu)
   */
  type?: 'back' | 'home' | 'title'
  /** Back action; defaults to history back. */
  onBack?: () => void
  actions?: ReactNode
}

/** Navigation / TopBar */
export function TopBar({ title = '', type = 'back', onBack, actions }: TopBarProps) {
  const navigate = useNavigate()
  return (
    <div className={`top-bar top-bar--${type}`}>
      {type === 'back' && (
        <button className="top-bar__back" aria-label="Back" onClick={() => (onBack ? onBack() : navigate(-1))}>
          <Icon name="back" />
        </button>
      )}
      {type === 'home' && <LogoMark size={32} />}
      {/* No title → no heading: the screen's own <h1> (e.g. "Log in") is the one that counts */}
      {title ? (
        <h1 className={`top-bar__title ${type === 'back' ? 't-h3' : type === 'home' ? 't-h2' : 't-h1'}`}>{title}</h1>
      ) : (
        <span className="top-bar__title" />
      )}
      <div className="top-bar__actions">{actions}</div>
    </div>
  )
}

/** Icon button for top bar action slots. */
export function TopBarAction({
  label,
  icon,
  onClick,
  pressed,
  badge = 0,
}: {
  label: string
  icon: IconName
  onClick?: () => void
  pressed?: boolean
  /** A count on the icon (unread notifications) */
  badge?: number
}) {
  const full = badge > 0 ? `${label}, ${badge} unread` : label
  return (
    <button className="top-bar__action" aria-label={full} title={full} onClick={onClick} aria-pressed={pressed}>
      <span className="top-bar__action-icon">
        <Icon name={icon} />
        <CountBadge count={badge} label="" className="nav-badge" />
      </span>
    </button>
  )
}

type ScreenProps = {
  theme?: Theme
  /** Page background token; most screens use `background`, some use `surface`. */
  bg?: 'background' | 'surface' | 'secondary'
  topBar?: ReactNode
  footer?: ReactNode
  /** Bottom navigation (tab bar) rendered below the footer. */
  bottomNav?: ReactNode
  children?: ReactNode
  /** Elements positioned absolutely over the whole screen (Skip button, overlays). */
  overlay?: ReactNode
  bodyClassName?: string
  /** Status bar floats over the body (screens with a full-bleed hero photo). */
  statusOverlay?: boolean
  /** 1px top border on the sticky footer (commerce screens). */
  footerBorder?: boolean
  /** Status bar colours when it sits over a dark header but the rest of the screen is light. */
  statusTheme?: Theme
  /** Desktop width: `wide` screens (menu, product, home) use a wider column and multi-column lists. */
  layout?: 'column' | 'wide'
}

/** Screen frame: status bar, optional top bar, scrolling body, sticky footer, home indicator.
 *  The footer holds the screen's one primary action. Phones pin it to the bottom edge; tablets and
 *  desktops put it right after the content (sticking to the bottom only once the content is taller
 *  than the window), so the button is never stranded far from what it acts on. */
export function Screen({
  theme = 'light',
  bg = 'background',
  topBar,
  footer,
  bottomNav,
  children,
  overlay,
  bodyClassName = '',
  statusOverlay = false,
  footerBorder = false,
  statusTheme,
  layout = 'column',
}: ScreenProps) {
  const wide = useWide()
  const footerEl = footer && (
    <div className={`sticky-footer ${footerBorder ? 'sticky-footer--border' : ''} ${wide ? 'sticky-footer--inline' : ''}`}>
      {footer}
    </div>
  )
  return (
    <div className={`screen screen--bg-${bg} screen--${layout}`}>
      {statusOverlay ? (
        <div className="screen__status-overlay">
          <StatusBar theme={statusTheme ?? theme} />
        </div>
      ) : (
        <StatusBar theme={theme} />
      )}
      {topBar}
      <div className={`screen__body ${bodyClassName}`}>
        {children}
        {wide && footerEl}
      </div>
      {!wide && footerEl}
      {bottomNav}
      <HomeIndicator theme={theme} />
      {overlay}
    </div>
  )
}

/** Standard content column: 8px top, 24px bottom padding, 16px gap between rows. */
export function Content({ children, gap = 16 }: { children: ReactNode; gap?: number }) {
  return (
    <div className="content" style={{ gap }}>
      {children}
    </div>
  )
}

/** Margin wrapper — 16px side gutter around a row. */
export function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`row ${className}`}>{children}</div>
}
