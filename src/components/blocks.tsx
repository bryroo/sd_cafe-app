// Composite blocks: navigation, menu-board rows, the live-order bar, selectors.
import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { peso, type Product } from '../data/menu'
import { Icon, type IconName } from './Icon'
import { Lamp } from './Lamp'
import './blocks.css'

/* ---------- Navigation ---------- */

export type Tab = 'home' | 'menu' | 'orders' | 'rewards' | 'profile'
const tabs: { id: Tab; label: string; path: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', path: '/home', icon: 'home' },
  { id: 'menu', label: 'Menu', path: '/menu', icon: 'cup' },
  { id: 'orders', label: 'Orders', path: '/orders', icon: 'receipt' },
  { id: 'rewards', label: 'Rewards', path: '/rewards', icon: 'star' },
  { id: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
]

/** Navigation / BottomNav — the active tab is marked in ink by a steel bar along its top edge. */
export function BottomNav({ active }: { active: Tab }) {
  const navigate = useNavigate()
  return (
    <nav className="bottom-nav" aria-label="Main">
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            className={`bottom-nav__item ${on ? 'is-active' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={() => navigate(t.path)}
          >
            <Icon name={t.icon} size={22} />
            <span className="t-caption">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/** Navigation / Tab (underline) row */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => {
        const on = it.id === value
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={on}
            className={`tabs__tab ${on ? 'is-active' : ''}`}
            onClick={() => onChange(it.id)}
          >
            <span className="t-button">{it.label}</span>
            <span className="tabs__indicator" />
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Search ---------- */

/** Field / Search (idle) — a button that opens the search screen. */
export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="search-field" onClick={onClick}>
      <Icon name="search" size={20} color="var(--muted)" />
      <span className="t-body muted">Search the menu</span>
    </button>
  )
}

/* ---------- Headers, chips, badges ---------- */

/** Block / SectionHeader — the section name with an optional plain link on the right. */
export function SectionHeader({
  title,
  linkText = 'See all',
  onLink,
  count,
}: {
  title: string
  linkText?: string
  onLink?: () => void
  /** Shown after the title in grey, e.g. the number of items */
  count?: number
}) {
  return (
    <div className="section-header">
      <h2 className="t-h2">
        {title}
        {count != null && <span className="section-header__count num"> {count}</span>}
      </h2>
      {onLink && (
        <button className="t-body-sm link-text" onClick={onLink}>
          {linkText}
        </button>
      )}
    </div>
  )
}

/** Chip (filter / recent search) */
export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <button className={`chip t-body-sm ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      {label}
    </button>
  )
}

/** Tag — small square-cornered label inside a row. */
export function Badge({
  children,
  tone = 'dark',
  size = 'sm',
}: {
  children: ReactNode
  tone?: 'dark' | 'info' | 'muted' | 'success' | 'warning' | 'danger' | 'gold'
  size?: 'sm' | 'md'
}) {
  return <span className={`badge badge--${tone} badge--${size} t-caption`}>{children}</span>
}

/* ---------- Home ---------- */

/** The live order — a black chalkboard panel with its lamp lit, like the sign in the cafe. */
export function ActiveOrderChip({ status, eta, onClick }: { status: string; eta: string; onClick: () => void }) {
  return (
    <button className="live-order" onClick={onClick}>
      <span className="live-order__lamp">
        <Lamp state="lit" size={30} />
      </span>
      <span className="live-order__text">
        <span className="t-h3">{status}</span>
        <span className="t-body-sm live-order__eta">{eta}</span>
      </span>
      <span className="live-order__go t-body-sm">
        Track
        <Icon name="chevron" size={18} />
      </span>
    </button>
  )
}

/** Points strip — balance, the next milestone and a gold bar for what has been earned. */
export function RewardsStrip({
  state = 'default',
  points,
  hint,
  progress = 0,
  tier = 'Regular',
  onClick,
}: {
  state?: 'default' | 'loading' | 'guest'
  points?: string
  hint?: string
  /** 0..1 toward the next free drink */
  progress?: number
  tier?: string
  onClick?: () => void
}) {
  if (state === 'loading') {
    return (
      <div className="points-strip" aria-busy>
        <span className="points-strip__text">
          <span className="skeleton" style={{ width: 96, height: 22 }} />
          <span className="skeleton" style={{ width: 168, height: 14 }} />
        </span>
      </div>
    )
  }
  if (state === 'guest') {
    return (
      <button className="points-strip" onClick={onClick}>
        <span className="points-strip__text">
          <span className="t-h3">Log in to earn points</span>
          <span className="t-body-sm muted">Every order counts toward a free drink.</span>
        </span>
        <Icon name="chevron" size={20} color="var(--muted)" />
      </button>
    )
  }
  return (
    <button className="points-strip" onClick={onClick}>
      <span className="points-strip__text">
        <span className="points-strip__head">
          <span className="t-h2 num">{points}</span>
          <span className="tier-badge t-caption">{tier}</span>
        </span>
        <span className="t-body-sm muted">{hint}</span>
        <span
          className="points-strip__track"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${Math.min(1, progress) * 100}%` }} />
        </span>
      </span>
      <Icon name="chevron" size={20} color="var(--muted)" />
    </button>
  )
}

/** Promo — set like the gold-on-black posters on the cafe wall. */
export function PromoBanner({
  title,
  subtitle,
  onClick,
  onDismiss,
}: {
  title: string
  subtitle: string
  onClick: () => void
  onDismiss?: () => void
}) {
  return (
    <div className="poster">
      <button className="poster__hit" onClick={onClick}>
        <span className="poster__title t-h2">{title}</span>
        <span className="poster__meta t-body-sm">{subtitle}</span>
        <span className="poster__cta t-button">
          See the offer <Icon name="chevron" size={18} />
        </span>
      </button>
      {onDismiss && (
        <button className="poster__dismiss" aria-label="Dismiss offer" onClick={onDismiss}>
          <Icon name="close" size={20} />
        </button>
      )}
    </div>
  )
}

/** Category cell in the menu-section strip: the name and how many items it holds. */
export function CategoryTile({
  label,
  count,
  onClick,
  photo,
  position = '50% 50%',
}: {
  label: string
  count?: number
  onClick: () => void
  /** A photo of what the group holds, cropped square above the label */
  photo?: string
  position?: string
}) {
  return (
    <button className={`category-cell ${photo ? 'category-cell--photo' : ''}`} onClick={onClick}>
      {photo && <img className="category-cell__photo" src={photo} alt="" style={{ objectPosition: position }} />}
      <span className="t-h3">{label}</span>
      {count != null && <span className="t-body-sm muted num">{count} items</span>}
    </button>
  )
}

/** Card / Reorder */
export function ReorderCard({
  summary,
  total,
  onReorder,
}: {
  summary: string
  total: number
  onReorder: () => void
}) {
  return (
    <div className="reorder-card">
      <span className="reorder-card__text">
        <span className="t-h3">{summary}</span>
        <span className="t-price">{peso(total)}</span>
      </span>
      <button className="btn btn--secondary" style={{ height: 48 }} onClick={onReorder}>
        <span className="t-button">Reorder</span>
      </button>
    </div>
  )
}

/* ---------- Products: the menu board ---------- */

type ProductCardProps = {
  product: Product
  onOpen: () => void
  /** Leave out a badge the list already says (no "Best Seller" tag inside Best Sellers) */
  hideBadge?: string
}

/** Product / Row — one item on the menu: photo, name, what is in it, price and its tag. The row opens
 *  the product; the + beside it (a sibling, never nested) opens it too, to choose options. Every row is
 *  the same height. */
/** Menu thumbnail. Shows the product photo, or a placeholder tile until one exists. */
export function ProductThumb({ product, size = 'M' }: { product: Product; size?: 'S' | 'M' | 'L' }) {
  const cls = `product-thumb product-thumb--${size}`
  if (product.image) {
    return <img className={cls} src={product.image} alt={size === 'L' ? product.name : ''} loading="lazy" />
  }
  return (
    <span className={`${cls} product-thumb--empty`} aria-hidden>
      <Icon name={product.kind === 'drink' ? 'cup' : 'bread'} size={size === 'L' ? 56 : size === 'S' ? 20 : 22} />
    </span>
  )
}

export function ProductRow({ product: p, onOpen, hideBadge }: ProductCardProps) {
  const badge = p.badges.find((b) => b !== hideBadge)
  const soldOut = !p.available
  return (
    <div className={`mitem ${soldOut ? 'mitem--sold-out' : ''}`}>
      <button className="mitem__open" onClick={onOpen}>
        <ProductThumb product={p} />
        <span className="mitem__text">
          <span className="t-h3 mitem__name">{p.name}</span>
          <span className="t-body-sm muted mitem__blurb">{p.blurb}</span>
          <span className="mitem__price num">
            <span className="t-price">{peso(p.price)}</span>
            {/* the range on one line: ₱150.00–170.00 */}
            {p.priceMax > p.price && <span className="t-caption muted mitem__to">–{peso(p.priceMax).slice(1)}</span>}
            {soldOut ? <Badge tone="muted">Sold out</Badge> : badge && <Badge tone="gold">{badge}</Badge>}
          </span>
        </span>
      </button>
      <button
        className="mitem__add"
        aria-label={soldOut ? `${p.name} is sold out` : `Choose options for ${p.name}`}
        onClick={onOpen}
        disabled={soldOut}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  )
}

/** Product row skeleton (Home / Loading) — the final layout with flat bars at real size. */
export function ProductRowSkeleton() {
  return (
    <div className="mitem" aria-hidden>
      <span className="mitem__open">
        <span className="skeleton" style={{ width: 72, height: 72 }} />
        <span className="mitem__text">
          <span className="skeleton" style={{ width: 132, height: 18 }} />
          <span className="skeleton" style={{ width: 160, height: 14 }} />
          <span className="skeleton" style={{ width: 64, height: 16 }} />
        </span>
      </span>
    </div>
  )
}

/** A white plate holding menu-board rows. */
export function MenuBoard({ children }: { children: ReactNode }) {
  return <div className="menu-board">{children}</div>
}

/** Horizontal scrolling rail */
export function Rail({ children }: { children: ReactNode }) {
  return <div className="rail">{children}</div>
}

/* ---------- Cart bar ---------- */

/** CartBar — a black bar 12px above the bottom nav (or the home indicator when there is no nav). */
export function CartBar({
  count,
  total,
  onClick,
  withNav = true,
}: {
  count: number
  total: number
  onClick: () => void
  withNav?: boolean
}) {
  if (count === 0) return null
  return (
    <button className={`cart-bar ${withNav ? '' : 'cart-bar--no-nav'}`} onClick={onClick}>
      <span className="cart-bar__count t-caption num">{count}</span>
      <span className="t-button cart-bar__label">View cart</span>
      <span className="t-price">{peso(total)}</span>
      <Icon name="chevron" size={18} />
    </button>
  )
}

/* ---------- Selectors (Product Detail) ---------- */

/** Selector / GroupHeader */
export function GroupHeader({ title, required }: { title: string; required: boolean }) {
  return (
    <div className="group-header">
      <span className="t-h3">{title}</span>
      <span className={`t-caption ${required ? 'group-header__req' : 'muted'}`}>{required ? 'Required' : 'Optional'}</span>
    </div>
  )
}

/** Radio — the chosen option's dot is lit gold inside an ink ring. */
export function Radio({
  label,
  checked,
  onChange,
  priceDelta,
  price,
  name,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: () => void
  priceDelta?: string
  /** The choice's full price (a size on the menu board), shown in ink instead of a surcharge */
  price?: string
  name: string
  disabled?: boolean
}) {
  return (
    <label className={`radio ${disabled ? 'is-disabled' : ''} ${checked ? 'is-checked' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />
      <span className={`radio__ring ${checked ? 'is-checked' : ''}`}>{checked && <span />}</span>
      <span className="t-body radio__label">{label}</span>
      {price ? (
        <span className="t-price num">{price}</span>
      ) : (
        priceDelta && <span className="t-body-sm muted num">{priceDelta}</span>
      )}
    </label>
  )
}

/** Stepper / Quantity */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 20,
  size = 'M',
  removeAtMin,
  onRemove,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  /** M = 48px buttons (product detail), S = 36px (cart rows) */
  size?: 'M' | 'S'
  /** At the minimum, the minus button turns into a red "remove" button (O-02 Quick add). */
  removeAtMin?: boolean
  onRemove?: () => void
}) {
  const remove = removeAtMin && value <= min
  return (
    <div className={`stepper stepper--${size}`}>
      {remove ? (
        <button className="stepper__remove" aria-label="Remove" onClick={onRemove}>
          <Icon name="trash" size={18} />
        </button>
      ) : (
        <button aria-label="Decrease quantity" disabled={value <= min} onClick={() => onChange(value - 1)}>
          <Icon name="minus" size={18} />
        </button>
      )}
      <span className="t-button stepper__value num" aria-live="polite">
        {value}
      </span>
      <button aria-label="Increase quantity" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  )
}

/** Field / Textarea with counter */
export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  max = 140,
  helper,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  max?: number
  helper?: string
}) {
  return (
    <div className="field">
      <label className="t-body-sm" htmlFor={`ta-${label}`}>
        {label}
      </label>
      <textarea
        id={`ta-${label}`}
        className="textarea t-body"
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="textarea__helper t-caption muted">
        <span>{helper}</span>
        <span className="num">
          {value.length}/{max}
        </span>
      </div>
    </div>
  )
}

/** Control on a dark header — a plain 44px icon button. */
export function HeroControl({
  label,
  icon,
  onClick,
  style,
  pressed,
}: {
  label: string
  icon: IconName
  onClick?: () => void
  style?: CSSProperties
  pressed?: boolean
}) {
  return (
    <button className="hero-control" aria-label={label} title={label} onClick={onClick} style={style} aria-pressed={pressed}>
      <Icon name={icon} size={22} />
    </button>
  )
}

/* ---------- Generic list rows / cards used across flows ---------- */

/** Card container: a white plate */
export function Card({ children, className = '', padding = 16 }: { children: ReactNode; className?: string; padding?: number }) {
  return (
    <div className={`card ${className}`} style={{ padding }}>
      {children}
    </div>
  )
}

/** List / Row — 56px+ row with optional leading icon, label/sub, trailing value and chevron. */
export function ListRow({
  label,
  sub,
  value,
  icon,
  chevron = true,
  onClick,
  danger,
  trailing,
}: {
  label: ReactNode
  sub?: ReactNode
  value?: ReactNode
  icon?: IconName
  chevron?: boolean
  onClick?: () => void
  danger?: boolean
  trailing?: ReactNode
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`list-row ${danger ? 'is-danger' : ''}`} onClick={onClick}>
      {icon && <Icon name={icon} size={20} />}
      <span className="list-row__text">
        <span className="t-body">{label}</span>
        {sub && <span className="t-body-sm muted">{sub}</span>}
      </span>
      {value && <span className="t-body-sm muted list-row__value">{value}</span>}
      {trailing}
      {chevron && <Icon name="chevron" size={20} color="var(--muted)" />}
    </Tag>
  )
}

/** Divider line */
export function Divider() {
  return <hr className="divider" />
}
