// The customer app's persistent navigation on wider screens: an icon rail on tablets (768–1023px) and
// a labelled sidebar on desktops (≥1024px). Phones keep each screen's BottomNav. Same five tabs.
import { useLocation, useNavigate } from 'react-router-dom'
import { tabs } from './tabs'
import { Icon } from './Icon'
import { LogoMark } from './ui'
import { peso } from '../data/menu'
import { useApp } from '../state/AppState'
import { useCartGlow, useUnreadCount } from '../state/feedback'
import { CountBadge } from './blocks'
import './app-nav.css'

/** Which tab a path belongs to: /orders/1042 is Orders, /product/x and /search are Menu */
function tabFor(path: string) {
  if (path.startsWith('/product') || path.startsWith('/search') || path.startsWith('/menu')) return 'menu'
  if (path.startsWith('/orders')) return 'orders'
  if (path.startsWith('/rewards') || path.startsWith('/promotions')) return 'rewards'
  if (path.startsWith('/profile') || path.startsWith('/settings') || path.startsWith('/notifications')) return 'profile'
  if (path.startsWith('/home')) return 'home'
  return null
}

export function AppNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { cartCount, cartTotal, isMember } = useApp()
  const active = tabFor(pathname)
  const unread = useUnreadCount()
  const glow = useCartGlow()
  return (
    <nav className="app-nav" aria-label="Main">
      <button className="app-nav__brand" onClick={() => navigate('/home')} aria-label="MEGS' Cafe home">
        <LogoMark size={40} />
        <span className="app-nav__name t-h3">MEGS' Cafe</span>
      </button>
      <ul className="app-nav__list">
        {tabs.map((t, i) => {
          const on = t.id === active
          return (
            <li key={t.id}>
              <button
                className={`app-nav__item ${on ? 'is-active' : ''}`}
                aria-current={on ? 'page' : undefined}
                onClick={() => navigate(t.path)}
                title={`${t.label} (Alt+${i + 1})`}
              >
                <span className="app-nav__icon">
                  <Icon name={t.icon} size={22} />
                  {t.id === 'profile' && <CountBadge count={unread} label={`${unread} unread`} className="nav-badge" />}
                </span>
                <span className="app-nav__label">{t.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {isMember && cartCount > 0 && (
        <button className="app-nav__cart" onClick={() => navigate('/cart')} aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}, ${peso(cartTotal)}`}>
          <span key={glow} className={`app-nav__cart-count num ${glow ? 'is-glowing' : ''}`}>
            {cartCount}
          </span>
          <span className="app-nav__label">
            Cart <span className="num">{peso(cartTotal)}</span>
          </span>
        </button>
      )}
    </nav>
  )
}
