// Staff console building blocks: the console context (toasts, write errors, unsaved-edit guard),
// dialogs and sheets, the "Staff only" panel, metric tiles and small formatting helpers.
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { MIN } from '../state/shared'

/* ---------- Context ---------- */

export type StaffApi = {
  toast: (text: string, action?: { label: string; onClick: () => void }) => void
  /** Runs a write (a database call returns a promise); on failure shows "Couldn't update. Try again." with
   *  Retry, and nothing changes. Returns false only when the write failed straight away. */
  act: (write: () => void | Promise<unknown>, success?: string) => boolean
  /** Navigate inside the console, asking first if an editor has unsaved changes (OA-04) */
  go: (to: string) => void
  /** An editor reports unsaved changes */
  setDirty: (dirty: boolean) => void
  online: boolean
  now: number
}

export const StaffCtx = createContext<StaffApi | null>(null)

export function useStaff() {
  const ctx = useContext(StaffCtx)
  if (!ctx) throw new Error('useStaff must be used inside the staff console')
  return ctx
}

/** Order numbers that arrived while this tab was open, highlighted for 2 seconds (FR-STF-04) */
export const NewOrders = { fresh: new Set<number>() }

/* ---------- Formatting ---------- */

/** "4 min", "1 hr 5 min" */
export function age(from: number, now: number) {
  const m = Math.max(0, Math.floor((now - from) / MIN))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`
}

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0]

/* ---------- Dialogs and sheets ---------- */

/** A modal panel: a centred dialog on a tablet, a bottom sheet on a phone. Esc and the scrim close it. */
export function Modal({
  title,
  onClose,
  children,
  actions,
  tone = 'default',
}: {
  title: string
  onClose: () => void
  children?: ReactNode
  actions?: ReactNode
  tone?: 'default' | 'danger'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="st-modal-root">
      <div className="st-scrim" onClick={onClose} aria-hidden />
      <div className={`st-modal st-modal--${tone}`} role="dialog" aria-modal aria-label={title} tabIndex={-1} ref={ref}>
        <div className="st-modal__head">
          <h2 className="t-h2">{title}</h2>
          <button className="st-icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="st-modal__body">{children}</div>
        {actions && <div className="st-modal__actions">{actions}</div>}
      </div>
    </div>
  )
}

/* ---------- Panels ---------- */

/** UI-10: everything the customer never sees sits in this panel, labelled with a lock */
export function StaffOnly({ children }: { children: ReactNode }) {
  return (
    <section className="st-panel st-staff-only" aria-label="Staff only">
      <h2 className="st-staff-only__head t-caption">
        <Icon name="lock" size={16} />
        Staff only
      </h2>
      {children}
    </section>
  )
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="st-panel">
      {(title || action) && (
        <div className="st-panel__head">
          {title && <h2 className="t-h3">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** A count on the dashboard and the automations strip; links when it has somewhere to go */
export function Metric({
  label,
  value,
  icon,
  alert,
  onClick,
}: {
  label: string
  value: number
  icon: IconName
  alert?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="st-metric__label t-body-sm">
        <Icon name={icon} size={18} />
        {label}
      </span>
      <span className="st-metric__value num">{value}</span>
    </>
  )
  const cls = `st-metric ${alert && value > 0 ? 'st-metric--alert' : ''}`
  return onClick ? (
    <button className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** A key / value line in a panel */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="st-fact">
      <span className="t-body-sm muted">{label}</span>
      <span className="t-body st-fact__value">{children}</span>
    </div>
  )
}

/** Big touch button (UI-05: at least 56 × 56) */
export function StaffButton({
  children,
  variant = 'primary',
  onClick,
  disabled,
  icon,
  small,
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'text'
  onClick?: () => void
  disabled?: boolean
  icon?: IconName
  small?: boolean
}) {
  return (
    <button className={`st-btn st-btn--${variant} ${small ? 'st-btn--small' : ''}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={20} />}
      <span className="t-button">{children}</span>
    </button>
  )
}
