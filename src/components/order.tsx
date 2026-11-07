// Order-related blocks: fulfillment, cart lines, price rows, alerts, and the conduit tracker.
import type { ReactNode } from 'react'
import { peso } from '../data/menu'
import { DELIVERY_MINUTES, getShared, type Address, type CartLine, type Fulfillment } from '../state/shared'
import { productById } from '../data/menu'
import { ProductThumb, Stepper } from './blocks'
import { Icon, type IconName } from './Icon'
import { Lamp } from './Lamp'
import './order.css'

/** Before an order exists: pickup takes the cafe's default preparation time (FR-OPS-03) */
export const etaFor = (f: Fulfillment) =>
  f === 'delivery' ? `Arrives in about ${DELIVERY_MINUTES} min` : `Ready in about ${getShared().store.prepMinutes} min`

/** "Medium · 16 oz", "Hot", "Oat milk", "50%" → "Medium · Hot · Oat milk · 50% sugar" */
export function formatOptions(options: string[]) {
  return options
    .map((o) => {
      if (/ · \d+ oz$/.test(o)) return o.replace(' · ', ' ')
      if (/^\d+%$/.test(o)) return `${o} sugar`
      return o
    })
    .join(' · ')
}

export const lineName = (l: CartLine) => l.name ?? productById(l.productId)?.name ?? 'Item'

const fulfillmentIcon = (f: Fulfillment): IconName => (f === 'delivery' ? 'truck' : 'store')

/** Badge / Fulfillment — Pickup or Delivery, in steel. */
export function FulfillmentBadge({ type, size = 'M' }: { type: Fulfillment; size?: 'M' | 'L' }) {
  return (
    <span className={`fulfillment-badge fulfillment-badge--${size} ${size === 'L' ? 't-body-sm' : 't-caption'}`}>
      <Icon name={fulfillmentIcon(type)} size={size === 'L' ? 18 : 15} />
      {type === 'delivery' ? 'Delivery' : 'Pickup'}
    </span>
  )
}

/** Fulfillment / Summary — compact card at the top of Cart and Checkout. */
export function FulfillmentSummary({
  type,
  address,
  onChange,
}: {
  type: Fulfillment
  address?: Address
  onChange?: () => void
}) {
  const delivery = type === 'delivery'
  return (
    <button className="card fulfillment-summary" onClick={onChange} disabled={!onChange}>
      <span className="fulfillment-summary__lamp">
        {delivery ? <Icon name={fulfillmentIcon(type)} size={20} /> : <Lamp state="lit" size={26} />}
      </span>
      <span className="fulfillment-summary__body">
        <span className="t-h3">{delivery ? `Delivery to ${address?.name ?? 'your address'}` : 'Pickup at the counter'}</span>
        <span className="t-body-sm muted">{delivery ? `${address?.street ?? ''} · ${etaFor(type)}` : etaFor(type)}</span>
      </span>
      {onChange && <span className="t-body-sm link-text">Change</span>}
    </button>
  )
}

/** Fulfillment / Details — status line + location/recipient block. */
export function FulfillmentDetails({
  type,
  address,
  status,
  tone = 'default',
  orderNumber,
}: {
  type: Fulfillment
  address?: Address
  /** Overrides the ETA line, e.g. "Ready for pickup". */
  status?: string
  /** success = done states, accent = the lit, in-motion states */
  tone?: 'default' | 'success' | 'accent'
  /** Shows the large order-number block (Order Tracking / Ready). */
  orderNumber?: number
}) {
  const delivery = type === 'delivery'
  return (
    <div className="card fulfillment-details">
      <div className="fulfillment-details__head">
        <span className="t-h3">{delivery ? 'Delivery details' : 'Pickup details'}</span>
        <FulfillmentBadge type={type} />
      </div>
      <div className={`fulfillment-details__status fulfillment-details__status--${tone}`}>
        <Icon name={tone === 'success' ? 'check' : 'clock'} size={18} />
        <span className="t-button">{status ?? etaFor(type)}</span>
      </div>
      {orderNumber != null && (
        <div className="fulfillment-details__number">
          <span className="t-body-sm">Show this number at the counter</span>
          <span className="fulfillment-details__number-value num">#{orderNumber}</span>
        </div>
      )}
      <hr className="divider" />
      {delivery && address ? (
        <div className="fulfillment-details__recipient">
          <span className="t-caption muted">Delivering to</span>
          <span className="t-h3">{address.name}</span>
          <span className="t-body-sm muted">{address.street}</span>
          <span className="t-body-sm muted num">{address.phone}</span>
          {address.notes && (
            <span className="fulfillment-details__note t-body-sm">
              <Icon name="door" size={16} />
              {address.notes}
            </span>
          )}
        </div>
      ) : (
        <div className="fulfillment-details__location">
          <Icon name="pin" size={20} />
          <span className="fulfillment-details__location-text">
            <span className="t-button">MEGS' Cafe</span>
            <span className="t-body-sm muted">Pick up at the counter</span>
          </span>
        </div>
      )}
    </div>
  )
}

/** Badge / Status (order status). Gold only for the lit, in-progress states. */
export function StatusBadge({
  label,
  tone,
  size = 'L',
}: {
  label: string
  tone: 'muted' | 'accent' | 'success' | 'dark' | 'error'
  size?: 'M' | 'L'
}) {
  return (
    <span className={`status-badge status-badge--${tone} status-badge--${size} ${size === 'L' ? 't-body-sm' : 't-caption'}`}>
      {label}
    </span>
  )
}

/**
 * The conduit tracker — the cafe's black pipe runs down the steps and each step hangs a wall lamp.
 * Passed steps are dark lamps, the current step is lit gold, the ones to come are outlines.
 * The final step shows as done (not lit) once reached, as in the Completed / Delivered frames.
 */
export function StatusStepper({
  steps,
  current,
  times = [],
  dark = false,
}: {
  steps: string[]
  current: number
  /** When each reached step happened (FR-TRK-01) */
  times?: (string | undefined)[]
  /** Set on the black tracker panel */
  dark?: boolean
}) {
  return (
    <ol className={`conduit ${dark ? 'conduit--dark' : ''}`}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        const state = i < current || (last && i === current) ? 'done' : i === current ? 'lit' : 'off'
        return (
          <li key={s} className={`conduit__step conduit__step--${state}`} aria-current={state === 'lit' ? 'step' : undefined}>
            <span className="conduit__lamp">
              <Lamp state={state} size={30} />
            </span>
            <span className="conduit__text">
              <span className={state === 'lit' ? 't-h3' : 't-body'}>{s}</span>
              {state !== 'off' && times[i] && <span className="t-caption conduit__time num">{times[i]}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** List / OrderLine — "1×  Name / options  ₱price" */
export function OrderLine({ line }: { line: CartLine }) {
  return (
    <div className="order-line">
      <span className="t-button muted order-line__qty num">{line.qty}×</span>
      <span className="order-line__text">
        <span className="t-body">{lineName(line)}</span>
        {line.options.length > 0 && <span className="t-body-sm muted">{formatOptions(line.options)}</span>}
      </span>
      <span className="t-price">{peso(line.unitPrice * line.qty)}</span>
    </div>
  )
}

/** Card / Order — history and active order cards. */
export function OrderCard({
  number,
  summary,
  total,
  when = 'Today, 10:42 AM',
  status,
  action,
  onAction,
  onOpen,
}: {
  number: number
  summary: string
  total: number
  when?: string
  status: { label: string; tone: 'muted' | 'accent' | 'success' | 'dark' | 'error' }
  action: string
  onAction: () => void
  onOpen?: () => void
}) {
  return (
    <div className="card order-card">
      <button className="order-card__hit" onClick={onOpen} aria-label={`Order #${number} details`} />
      <div className="order-card__head">
        <span className="t-h3 num">Order #{number}</span>
        <StatusBadge size="M" label={status.label} tone={status.tone} />
      </div>
      <span className="t-body-sm muted order-card__summary">{summary}</span>
      <div className="order-card__meta">
        <span className="t-price">{peso(total)}</span>
        <span className="t-caption muted">{when}</span>
      </div>
      <button className="btn btn--secondary btn--full order-card__action" style={{ height: 40 }} onClick={onAction}>
        <span className="t-button">{action}</span>
      </button>
    </div>
  )
}

/** Fulfillment / Selector — Pickup | Delivery segments. The chosen one is set in black steel. */
export function FulfillmentSelector({
  value,
  onChange,
  deliveryOff = false,
}: {
  value: Fulfillment
  onChange: (f: Fulfillment) => void
  /** FR-OPS-05: the cafe has turned delivery off */
  deliveryOff?: boolean
}) {
  const seg = (type: Fulfillment, label: string) => {
    const on = value === type
    const off = type === 'delivery' && deliveryOff
    return (
      <button
        className={`fulfillment-seg ${on ? 'is-selected' : ''}`}
        role="radio"
        aria-checked={on}
        disabled={off}
        onClick={() => onChange(type)}
      >
        <span className="fulfillment-seg__head">
          <Icon name={fulfillmentIcon(type)} size={22} />
          <span className="t-h3">{label}</span>
          {on && <Icon name="check" size={18} color="var(--gold)" />}
        </span>
        <span className="t-body-sm fulfillment-seg__eta">{off ? 'Not available right now' : etaFor(type)}</span>
      </button>
    )
  }
  return (
    <div className="fulfillment-selector" role="radiogroup" aria-label="Pickup or delivery">
      {seg('pickup', 'Pickup')}
      {seg('delivery', 'Delivery')}
    </div>
  )
}

/** Address card with radio, label tag and edit link (Pickup or Delivery / Delivery). */
export function AddressCard({
  address,
  selected,
  onSelect,
  onEdit,
}: {
  address: Address
  selected: boolean
  onSelect: () => void
  onEdit: () => void
}) {
  return (
    <div className={`card address-card ${selected ? 'is-selected' : ''}`}>
      <button className="address-card__hit" role="radio" aria-checked={selected} onClick={onSelect}>
        <span className={`radio__ring ${selected ? 'is-checked' : ''}`} />
        <span className="address-card__body">
          <span className="address-card__tags">
            <span className="t-h3">{address.label}</span>
            {address.isDefault && <span className="tier-badge t-caption">Default</span>}
          </span>
          <span className="t-body">{address.name}</span>
          <span className="t-body-sm muted">{address.street}</span>
          <span className="t-body-sm muted num">{address.phone}</span>
        </span>
      </button>
      <button className="address-card__edit t-body-sm link-text" onClick={onEdit}>
        Edit
      </button>
    </div>
  )
}

/** Item / Cart — a line on the order slip: name and options, quantity, price on one right edge. */
export function CartItem({
  line,
  onQty,
  onEdit,
  readOnly,
}: {
  line: CartLine
  onQty?: (q: number) => void
  onEdit?: () => void
  readOnly?: boolean
}) {
  const opts = formatOptions(line.options)
  const product = productById(line.productId)
  return (
    <div className="cart-item">
      {product && <ProductThumb product={product} size="S" />}
      <div className="cart-item__body">
        <span className="cart-item__top">
          <span className="t-h3">
            {readOnly && line.qty > 1 ? `${line.qty} × ` : ''}
            {lineName(line)}
          </span>
          <span className="t-price num">{peso(line.unitPrice * line.qty)}</span>
        </span>
        {opts && <span className="t-body-sm muted">{opts}</span>}
        {line.note && <span className="t-body-sm muted">Note: {line.note}</span>}
        {product && !product.available && !readOnly && (
          <span className="cart-item__gone t-body-sm">
            <Icon name="alert" size={16} />
            No longer available. Remove it to check out.
          </span>
        )}
        {!readOnly && (
          <span className="cart-item__controls">
            <Stepper size="S" value={line.qty} min={0} onChange={(q) => onQty?.(q)} />
            <button className="t-body-sm link-text cart-item__edit" onClick={onEdit}>
              Edit
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

/** Row / Price */
export function PriceRow({ label, amount, total }: { label: string; amount: string; total?: boolean }) {
  return (
    <div className={`price-row ${total ? 'price-row--total' : ''}`}>
      <span className={total ? 't-h2' : 't-body'}>{label}</span>
      <span className={total ? 't-h2 num' : 't-price'}>{amount}</span>
    </div>
  )
}

/** Row / Discount (Tier, Applied) */
/** A discount line: label, "Saved", the amount with a minus sign, and an optional note under it */
export function DiscountRow({ label = 'Regular discount', note, amount }: { label?: string; note?: string; amount: number }) {
  return (
    <div className="price-row discount-row">
      <span className="discount-row__body">
        <span className="discount-row__left">
          <span className="t-body">{label}</span>
          <span className="discount-row__tag t-caption">Saved</span>
        </span>
        {note && <span className="t-body-sm muted">{note}</span>}
      </span>
      <span className="t-price num">−{peso(amount)}</span>
    </div>
  )
}

/** Price breakdown block used by Cart, Checkout and Order Detail — a printed receipt. */
export function PriceBreakdown({
  subtotal,
  reward,
  offer,
  discount,
  deliveryFee,
}: {
  subtotal: number
  reward?: { name: string; amount: number; items: { name: string; amount: number }[] } | null
  offer?: { name: string; amount: number; note: string } | null
  discount: number
  deliveryFee: number
}) {
  const rewardOff = reward?.amount ?? 0
  const offerOff = offer?.amount ?? 0
  // SRS FR-CHK-04: Subtotal, tier discount, promotion, reward, delivery fee, Total;
  // every discount carries a minus sign, a label and the word "Saved"
  return (
    <div className="price-breakdown">
      <PriceRow label="Subtotal" amount={peso(subtotal)} />
      {discount > 0 && <DiscountRow amount={discount} />}
      {offer && <DiscountRow label={offer.name} note={offer.note || undefined} amount={offerOff} />}
      {reward && (
        <DiscountRow
          label={reward.name}
          note={reward.items.length ? `${reward.items.map((i) => i.name).join(' and ')} free` : undefined}
          amount={rewardOff}
        />
      )}
      {deliveryFee > 0 && <PriceRow label="Delivery fee" amount={peso(deliveryFee)} />}
      <PriceRow total label="Total" amount={peso(Math.max(0, subtotal - discount - offerOff - rewardOff) + deliveryFee)} />
    </div>
  )
}

/** Feedback / Alert */
export function Alert({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  children: ReactNode
  action?: ReactNode
}) {
  const icon: IconName = tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'
  return (
    <div className={`alert alert--${tone}`} role="status">
      <Icon name={icon} size={20} />
      <span className="t-body-sm alert__text">{children}</span>
      {action}
    </div>
  )
}

/** Feedback / Offline — one banner with Retry; what is saved on the phone stays visible under it */
export function OfflineBanner({ children, onRetry }: { children?: ReactNode; onRetry: () => void }) {
  return (
    <div className="alert alert--warning offline-banner" role="status">
      <Icon name="offline" size={20} />
      <span className="t-body-sm alert__text">{children ?? "You're offline. Showing what's saved on this phone."}</span>
      <button className="t-body-sm link-text offline-banner__retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

/** Feedback / Closed — the cafe isn't taking orders: today's hours and the next opening time */
export function ClosedBanner({ why, today, next }: { why?: 'paused' | 'hours'; today: string; next?: string }) {
  return (
    <div className="alert alert--warning closed-banner" role="status">
      <Icon name="clock" size={20} />
      <span className="alert__text closed-banner__text">
        <span className="t-button">{why === 'paused' ? "We're not taking orders right now" : "We're closed right now"}</span>
        <span className="t-body-sm">
          {today}
          {next ? ` · ${next}` : ''}. You can still browse and fill your cart.
        </span>
      </span>
    </div>
  )
}

/** Checkout options row (Order summary / Discount & rewards / Payment method) */
export function OptionRow({
  label,
  value,
  icon,
  onClick,
}: {
  label: string
  value: string
  icon: IconName
  onClick?: () => void
}) {
  return (
    <button className="option-row" onClick={onClick}>
      <Icon name={icon} size={20} color="var(--muted)" />
      <span className="t-body option-row__label">{label}</span>
      <span className="t-body-sm muted option-row__value">{value}</span>
      <Icon name="chevron" size={20} color="var(--muted)" />
    </button>
  )
}
