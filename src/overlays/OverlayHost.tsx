// Overlays O-01 … O-12: bottom sheets and dialogs, rendered inside the phone frame.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Radio, Stepper, TextArea } from '../components/blocks'
import { DiscountRow, formatOptions } from '../components/order'
import { Button, Photo, TextField } from '../components/ui'
import { Icon } from '../components/Icon'
import counterPhoto from '../assets/photos/counter-cup-meal.webp'
import { peso, productById } from '../data/menu'
import { checkPromo, featuredPromotion, freeItemsLine, rewardById, rewardSavings } from '../data/rewards'
import { COUNTER, quickAddLine, tierDiscount, useApp } from '../state/AppState'
import { DAYS, deleteCustomerData, hourLabel, useShared } from '../state/shared'
import { signalCartAdded } from '../state/feedback'
import { withNext } from '../state/guest'
import { CONTACT } from '../data/contact'
import './overlays.css'

export type OverlayId =
  | 'promo'
  | 'quick-add'
  | 'login-to-order'
  | 'discounts'
  | 'payment'
  | 'cancel-order'
  | 'too-late'
  | 'redeem'
  | 'unavailable'
  | 'login-again'
  | 'similar-order'
  | 'order-updates'
  | 'logout'
  | 'remove-item'
  | 'payment-declined'
  | 'order-failed'
  | 'delete-account'
  | 'help'
  | 'about'
  | 'shortcuts'
  | 'reset-demo'

type Payload = Record<string, unknown>
type Current = { id: OverlayId; data: Payload; resolve?: (ok: boolean) => void }

type ToastAction = { label: string; onClick: () => void }

type OverlayApi = {
  open: (id: OverlayId, data?: Payload) => void
  /** Opens a dialog and resolves true when the user takes the primary action. */
  confirm: (id: OverlayId, data?: Payload) => Promise<boolean>
  close: () => void
  /** A short message over the top of the screen (status changes, "Account deleted") */
  toast: (text: string, action?: ToastAction) => void
}

const Ctx = createContext<OverlayApi | null>(null)

export function useOverlay() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useOverlay must be used inside OverlayHost')
  return ctx
}

export function OverlayHost({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null)
  const [toastState, setToast] = useState<{ text: string; action?: ToastAction; id: number } | null>(null)
  const toast = useCallback((text: string, action?: ToastAction) => setToast({ text, action, id: Date.now() }), [])
  useEffect(() => {
    if (!toastState) return
    const t = setTimeout(() => setToast(null), toastState.action ? 5000 : 4000)
    return () => clearTimeout(t)
  }, [toastState])

  const close = useCallback(() => {
    setCurrent((c) => {
      c?.resolve?.(false)
      return null
    })
  }, [])
  const open = useCallback((id: OverlayId, data: Payload = {}) => setCurrent({ id, data }), [])
  const confirm = useCallback(
    (id: OverlayId, data: Payload = {}) => new Promise<boolean>((resolve) => setCurrent({ id, data, resolve })),
    [],
  )
  /** Resolve a confirm() as accepted and close. */
  const accept = useCallback(() => {
    setCurrent((c) => {
      c?.resolve?.(true)
      return null
    })
  }, [])

  // While a sheet or dialog is open: Esc closes it, Tab stays inside it, and focus goes back to
  // whatever opened it when it closes.
  useEffect(() => {
    if (!current) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close()
      if (e.key !== 'Tab') return
      const root = document.querySelector<HTMLElement>('.overlay-root')
      if (!root) return
      const items = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const inside = root.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [current, close])

  // Overlays render into the phone frame (#phone) so they never cover the prototype chrome.
  const target = typeof document !== 'undefined' ? document.getElementById('phone') : null

  const api = useMemo(() => ({ open, confirm, close, toast }), [open, confirm, close, toast])

  return (
    <Ctx.Provider value={api}>
      {children}
      {current &&
        target &&
        createPortal(
          <div className="overlay-root">
            <div className="overlay-scrim" onClick={close} aria-hidden />
            <OverlayContent current={current} close={close} accept={accept} open={open} />
          </div>,
          target,
        )}
      {toastState &&
        target &&
        createPortal(
          <div className="app-toast" role="status" aria-live="polite" key={toastState.id}>
            <span className="t-body app-toast__text">{toastState.text}</span>
            {toastState.action && (
              <button
                className="t-button app-toast__action"
                onClick={() => {
                  toastState.action!.onClick()
                  setToast(null)
                }}
              >
                {toastState.action.label}
              </button>
            )}
          </div>,
          target,
        )}
    </Ctx.Provider>
  )
}

/* ---------- Shells ---------- */

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <div className="sheet" role="dialog" aria-modal aria-label={title} tabIndex={-1} ref={ref}>
      <div className="sheet__handle" aria-hidden>
        <span />
      </div>
      <div className="sheet__header">
        <h2 className="t-h2">{title}</h2>
        <button className="sheet__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="sheet__body">{children}</div>
    </div>
  )
}

function Dialog({ title, children, actions }: { title: string; children?: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <div className="dialog" role="alertdialog" aria-modal aria-label={title} tabIndex={-1} ref={ref}>
      <h2 className="t-h2">{title}</h2>
      {children}
      <div className="dialog__actions">{actions}</div>
    </div>
  )
}

/* ---------- Content ---------- */

function OverlayContent({
  current,
  close,
  accept,
  open,
}: {
  current: Current
  close: () => void
  accept: () => void
  open: OverlayApi['open']
}) {
  const navigate = useNavigate()
  const app = useApp()
  const { toast } = useOverlay()
  const { id, data } = current

  switch (id) {
    /* O-01 Promo modal */
    case 'promo': {
      const promo = featuredPromotion
      if (!promo) return null
      return (
        <div className="dialog dialog--promo" role="dialog" aria-modal aria-label={promo.title}>
          <div className="dialog--promo__hero">
            <Photo
              src={counterPhoto}
              alt="The MEGS' sign on the concrete wall and a MEGS' kraft cup"
              height={168}
              position="50% 22%"
            />
            <button className="dialog--promo__close" aria-label="Close" onClick={close}>
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="dialog--promo__body">
            <h2 className="t-h2">{promo.title}</h2>
            <p className="t-body muted">{promo.description}</p>
            <Button
              onClick={() => {
                close()
                navigate(`/promotions/${promo.id}`)
              }}
            >
              View offer
            </Button>
          </div>
        </div>
      )
    }

    /* O-02 Quick add */
    case 'quick-add':
      return <QuickAddSheet productId={String(data.productId)} close={close} />

    /* O-03 Log in to place your order */
    case 'login-to-order':
      return (
        // Guests browse only: ordering (and anything account-related) needs an account. After logging
        // in or signing up they come back to `next`, the screen they were on.
        <Sheet title={String(data.title ?? 'Log in to order')} onClose={close}>
          <p className="t-body muted">
            {String(data.body ?? "Ordering needs an account. Log in or create one, and you'll come right back here.")}
          </p>
          <Button
            onClick={() => {
              close()
              navigate(withNext('/log-in', data.next ? String(data.next) : undefined))
            }}
          >
            Log in
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              close()
              navigate(withNext('/sign-up', data.next ? String(data.next) : undefined))
            }}
          >
            Create account
          </Button>
        </Sheet>
      )

    /* O-04 Discounts and rewards (default + invalid code) */
    case 'discounts':
      return <DiscountsSheet close={close} />

    /* O-05 Payment method */
    case 'payment':
      return (
        <Sheet title="Payment method" onClose={close}>
          <div role="radiogroup" aria-label="Payment method">
            {app.paymentMethods
              .filter(({ label }) => !(app.fulfillment === 'delivery' && label === COUNTER))
              .map(({ label: m }) => (
              <Radio
                key={m}
                name="payment"
                label={m}
                checked={app.payment === m}
                onChange={() => {
                  app.setPayment(m)
                  setTimeout(close, 150)
                }}
              />
              ))}
          </div>
        </Sheet>
      )

    /* O-06 Cancel this order? */
    case 'cancel-order':
      return (
        <Dialog
          title="Cancel this order?"
          actions={
            <>
              <Button onClick={close}>Keep order</Button>
              <Button variant="danger-outline" onClick={accept}>
                Cancel order
              </Button>
            </>
          }
        >
          <p className="t-body muted">Refunds, if any, go to your original payment method.</p>
        </Dialog>
      )

    /* O-06 Too late to cancel */
    case 'too-late':
      return (
        <Dialog title="Too late to cancel" actions={<Button onClick={close}>OK</Button>}>
          <p className="t-body muted">The cafe has started preparing your order.</p>
        </Dialog>
      )

    /* O-07 Redeem <reward>? */
    case 'redeem': {
      const name = String(data.name ?? 'Free drink')
      const cost = Number(data.cost ?? 200)
      const balance = Number(data.balance ?? 480)
      return (
        <Dialog
          title={`Redeem ${name}?`}
          actions={
            <>
              <Button onClick={accept}>Redeem</Button>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
            </>
          }
        >
          <p className="t-body muted">Spend {cost} points?</p>
          <p className="t-body">
            Balance: {balance.toLocaleString()} → {(balance - cost).toLocaleString()} pts
          </p>
        </Dialog>
      )
    }

    /* O-08 Some items aren't available */
    case 'unavailable': {
      const items = (data.items as string[]) ?? ['Pumpkin Spice Latte', 'Banana Bread Slice']
      return (
        <Dialog
          title="Some items aren't available"
          actions={
            <>
              <Button onClick={accept}>Continue with the rest</Button>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
            </>
          }
        >
          <p className="t-body muted">These items are missing from the menu today:</p>
          <ul className="dialog__list">
            {items.map((i) => (
              <li key={i} className="t-body">
                <Icon name="minus" size={16} color="var(--muted)" />
                {i}
              </li>
            ))}
          </ul>
        </Dialog>
      )
    }

    /* O-09 Please log in again */
    case 'login-again':
      return (
        <Dialog
          title="Please log in again"
          actions={
            <Button
              onClick={() => {
                close()
                app.setSession('signed-out')
                navigate('/log-in')
              }}
            >
              Log in
            </Button>
          }
        >
          <p className="t-body muted">For your security your session has ended.</p>
        </Dialog>
      )

    /* O-10 You placed a similar order 2 minutes ago */
    case 'similar-order': {
      const mins = app.lastOrder ? Math.max(1, Math.round((Date.now() - app.lastOrder.placedAt) / 60000)) : 2
      return (
        <Dialog
          title={`You placed the same order ${mins} minute${mins === 1 ? '' : 's'} ago`}
          actions={
            <>
              <Button
                onClick={() => {
                  close()
                  navigate(app.lastOrder ? `/orders/tracking?n=${app.lastOrder.number}` : '/orders/tracking')
                }}
              >
                View order
              </Button>
              <Button variant="secondary" onClick={accept}>
                Place another
              </Button>
            </>
          }
        >
          {app.lastOrder && (
            <>
              <span className="dialog__order-pill t-caption">
                Order #{app.lastOrder.number} · {peso(app.lastOrder.total)}
              </span>
              {/* The items the two orders share, so the customer can see why they're being asked */}
              <ul className="dialog__order-lines t-body-sm" aria-label="Items in that order">
                {app.lastOrder.lines.map((l) => (
                  <li key={l.key}>
                    {l.qty}× {productById(l.productId)?.name ?? 'Item'}
                    {l.options.length > 0 && <span className="muted"> · {l.options.join(' · ')}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Dialog>
      )
    }

    /* O-11 Get order updates */
    case 'order-updates':
      return (
        <Sheet title="Get order updates" onClose={close}>
          <p className="t-body muted">Get told when your order is ready.</p>
          <Button
            onClick={() => {
              app.setNotificationsOn(true)
              close()
            }}
          >
            Turn on notifications
          </Button>
          <Button variant="text" height={48} onClick={close}>
            Not now
          </Button>
        </Sheet>
      )

    /* Remove an item from the cart (the stepper's trash at quantity 1) */
    case 'remove-item':
      return (
        <Dialog
          title={`Remove ${String(data.name ?? 'this item')}?`}
          actions={
            <>
              <Button variant="danger" onClick={accept}>
                Remove
              </Button>
              <Button variant="secondary" onClick={close}>
                Keep it
              </Button>
            </>
          }
        >
          <p className="t-body muted">It will be taken out of your order.</p>
        </Dialog>
      )

    /* O-13 Payment didn't go through (3.2.4.5) */
    case 'payment-declined':
      return (
        <Dialog
          title="Payment didn't go through"
          actions={
            <>
              <Button onClick={accept}>Retry</Button>
              <Button variant="secondary" onClick={close}>
                Change method
              </Button>
            </>
          }
        >
          <p className="t-body muted">You haven't been charged. Your cart is just as you left it.</p>
        </Dialog>
      )

    /* O-14 We couldn't place your order (3.2.4.5) — Retry re-sends the same attempt, never a second order */
    case 'order-failed':
      return (
        <Dialog
          title="We couldn't place your order"
          actions={
            <>
              <Button onClick={accept}>Retry</Button>
              <Button variant="secondary" onClick={close}>
                Not now
              </Button>
            </>
          }
        >
          <p className="t-body muted">You haven't been charged. Retrying is safe: it can't place the order twice.</p>
        </Dialog>
      )

    /* O-15 Delete account? (FR-ACC-11) */
    case 'delete-account':
      return (
        <Dialog
          title="Delete your account?"
          actions={
            <>
              <Button
                variant="danger"
                onClick={async () => {
                  close()
                  try {
                    // The cafe keeps anonymized order records; everything personal goes (SRS 3.8)
                    await deleteCustomerData()
                    window.location.replace(window.location.pathname + '#/welcome?deleted=1')
                    window.location.reload()
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Couldn't delete your account. Try again.")
                  }
                }}
              >
                Delete account
              </Button>
              <Button variant="secondary" onClick={close}>
                Keep my account
              </Button>
            </>
          }
        >
          <p className="t-body muted">
            This erases your profile, saved addresses and payment methods, your cart, your{' '}
            {app.points.toLocaleString('en-PH')} points and unused rewards, and your notifications. It can't be undone.
          </p>
        </Dialog>
      )

    /* Profile → Help and support */
    case 'help':
      return <HelpSheet close={close} />

    /* Profile → About */
    case 'about':
      return (
        <Sheet title="About MEGS' Cafe" onClose={close}>
          <p className="t-body">The best time is coffee time.</p>
          <p className="t-body muted">
            Order ahead for pickup at the counter or for delivery, follow your order live, and earn points toward free
            drinks.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              close()
              navigate('/settings/privacy')
            }}
          >
            Privacy and your data
          </Button>
          <p className="t-caption muted">App version {__APP_VERSION__}</p>
        </Sheet>
      )

    /* "?" on a keyboard: what the shortcuts are */
    case 'shortcuts':
      return (
        <Sheet title="Keyboard shortcuts" onClose={close}>
          <dl className="shortcuts">
            {[
              ['Alt + 1 … 5', 'Home, Menu, Orders, Rewards, Profile'],
              ['/', 'Search the menu'],
              ['?', 'Show these shortcuts'],
              ['Esc', 'Close a sheet or dialog'],
            ].map(([k, v]) => (
              <div key={k} className="shortcuts__row">
                <dt>
                  <kbd className="t-body-sm">{k}</kbd>
                </dt>
                <dd className="t-body">{v}</dd>
              </div>
            ))}
          </dl>
        </Sheet>
      )

    /* Settings → Reset demo data */
    case 'reset-demo':
      return (
        <Dialog
          title="Reset the demo?"
          actions={
            <>
              <Button variant="danger" onClick={accept}>
                Reset demo
              </Button>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
            </>
          }
        >
          <p className="t-body muted">The cart, orders, staff console and store settings on this device will be cleared.</p>
        </Dialog>
      )

    /* O-12 Log out? */
    case 'logout':
      return (
        <Dialog
          title="Log out?"
          actions={
            <>
              <Button
                variant="danger"
                onClick={() => {
                  close()
                  // The cart is kept for this account and comes back on the next log in
                  app.setSession('signed-out')
                  navigate('/welcome', { replace: true })
                }}
              >
                Log out
              </Button>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
            </>
          }
        >
          {app.cartCount > 0 && (
            <p className="t-body muted">
              You have {app.cartCount} item{app.cartCount === 1 ? '' : 's'} in your cart. We'll keep them for you, and
              they'll be back when you log in again.
            </p>
          )}
        </Dialog>
      )
  }
  void open
  return null
}

function QuickAddSheet({ productId, close }: { productId: string; close: () => void }) {
  const { addToCart } = useApp()
  const { toast } = useOverlay()
  const navigate = useNavigate()
  const product = productById(productId)
  const [qty, setQty] = useState(1)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  if (!product) return null
  const line = quickAddLine(product.id)
  return (
    <Sheet title="Quick add" onClose={close}>
      <div className="quick-add-row">
        <span className="quick-add-row__text">
          <span className="t-h3">{product.name}</span>
          {/* What the standard order is for this item, so nothing is added unseen */}
          {line.options.length > 0 && <span className="t-body-sm muted">{formatOptions(line.options)}</span>}
          <span className="t-body num">{peso(line.unitPrice)}</span>
        </span>
        <Stepper value={qty} onChange={setQty} min={1} />
      </div>
      {noteOpen ? (
        <TextArea label="Note" placeholder="e.g. less ice" value={note} onChange={setNote} helper="Optional" />
      ) : (
        <div>
          <Button variant="text" height={48} full={false} onClick={() => setNoteOpen(true)}>
            Add a note
          </Button>
        </div>
      )}
      <Button
        className="btn--split"
        onClick={() => {
          addToCart({ ...line, qty, note: note.trim() })
          close()
          signalCartAdded()
          toast(`Added ${product.name}`, { label: 'View cart', onClick: () => navigate('/cart') })
        }}
      >
        <span>Add to order</span>
        <span className="num">{peso(line.unitPrice * qty)}</span>
      </Button>
      <Button
        variant="text"
        height={48}
        onClick={() => {
          close()
          navigate(`/product/${product.id}`)
        }}
      >
        Choose size and options
      </Button>
    </Sheet>
  )
}

function DiscountsSheet({ close }: { close: () => void }) {
  const app = useApp()
  const member = app.session === 'member'
  const [choice, setChoice] = useState<string | null>(app.appliedReward)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const applied = app.totals.offer?.code
  const tier = member ? tierDiscount(app.cartTotal, app.tierPct) : 0
  const [checking, setChecking] = useState(false)
  const applyCode = async () => {
    // SRS FR-PRO-08: the server knows the codes; date window, minimum spend and use are checked here,
    // and again by the server when the order is placed
    setChecking(true)
    const check = await checkPromo(code, app.cartTotal, app.cartTotal - tier)
    setChecking(false)
    if (!check.ok) return setError(check.error)
    app.setAppliedPromo(check.code)
    setCode('')
    setError('')
  }
  const usable = app.myRewards.filter((m) => m.status === 'Redeemed')
  const expired = app.myRewards.filter((m) => m.status === 'Expired')

  return (
    <Sheet title="Discounts and rewards" onClose={close}>
      <h3 className="t-h3">Automatic</h3>
      {member ? (
        <DiscountRow amount={tierDiscount(app.cartTotal, app.tierPct)} />
      ) : (
        <p className="t-body-sm muted">Log in to get your Regular discount.</p>
      )}
      {app.totals.offer && !applied && (
        <div className="offer-applied">
          <span className="t-body">{app.totals.offer.name}</span>
          <span className="t-price num">−{peso(app.totals.offer.amount)}</span>
          <span className="t-body-sm muted">{app.totals.offer.note} · applied automatically</span>
        </div>
      )}
      <hr className="divider" />
      <h3 className="t-h3">Your rewards</h3>
      {usable.length === 0 ? (
        <p className="t-body-sm muted">You have no rewards to use. Redeem one with your points in Rewards.</p>
      ) : (
        <div role="radiogroup" aria-label="Your rewards">
          <Radio name="reward" label="Don't use a reward" checked={choice === null} onChange={() => setChoice(null)} />
          {usable.map((m) => {
            const r = rewardById(m.rewardId)
            if (!r) return null
            const s = rewardSavings(r, app.cart)
            return (
              <div key={r.id} className="reward-choice">
                <Radio
                  name="reward"
                  label={r.name}
                  checked={choice === r.id}
                  onChange={() => setChoice(r.id)}
                  disabled={!s.applies}
                  priceDelta={s.applies ? `−${peso(s.amount)}` : undefined}
                />
                <p className="t-body-sm muted reward-choice__note">
                  {s.applies ? `Free: ${freeItemsLine(s.items)}` : `Add ${s.missing} to your order to use this.`}
                </p>
              </div>
            )
          })}
        </div>
      )}
      {expired.map((m) => {
        const r = rewardById(m.rewardId)
        return r ? <Radio key={r.id} name="reward-expired" label={`${r.name} · Expired`} checked={false} onChange={() => {}} disabled /> : null
      })}
      <hr className="divider" />
      <h3 className="t-h3">Promo code</h3>
      {applied ? (
        <div className="offer-applied">
          <span className="t-body">{app.totals.offer!.name}</span>
          <span className="t-price num">−{peso(app.totals.offer!.amount)}</span>
          <span className="t-body-sm muted">
            One promotion per order: the code replaces the automatic offer.{' '}
            <button className="link-text t-body-sm" onClick={() => app.setAppliedPromo(null)}>
              Remove code
            </button>
          </span>
        </div>
      ) : (
        <div className="promo-row">
        <TextField
          label="Code"
          placeholder="Enter code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase())
            setError('')
          }}
          error={error}
        />
        <Button
          variant="secondary"
          height={48}
          full={false}
          disabled={!code.trim() || !member || checking}
          onClick={applyCode}
          aria-busy={checking}
        >
          {checking ? 'Checking…' : 'Apply code'}
        </Button>
        </div>
      )}
      {!applied && app.totals.offer && (
        <p className="t-body-sm muted">One promotion per order: a code replaces {app.totals.offer.name}.</p>
      )}
      <Button
        onClick={() => {
          app.setUseTierDiscount(true)
          app.setAppliedReward(choice)
          close()
        }}
      >
        Done
      </Button>
    </Sheet>
  )
}


/** Profile → Help and support: where order help lives, how to reach the cafe, opening hours. */
function HelpSheet({ close }: { close: () => void }) {
  const navigate = useNavigate()
  const { store } = useShared()
  const rows = [
    CONTACT.phone && { icon: 'phone' as const, label: 'Call', value: CONTACT.phone, href: `tel:${CONTACT.phone.replace(/\s/g, '')}` },
    CONTACT.email && { icon: 'mail' as const, label: 'Email', value: CONTACT.email, href: `mailto:${CONTACT.email}` },
    CONTACT.facebook && { icon: 'globe' as const, label: 'Facebook', value: CONTACT.facebook, href: `https://${CONTACT.facebook}` },
  ].filter(Boolean) as { icon: 'phone' | 'mail' | 'globe'; label: string; value: string; href: string }[]
  return (
    <Sheet title="Help and support" onClose={close}>
      <p className="t-body muted">
        For anything about an order you've placed, the quickest help is at the counter. Have your order number ready.
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          close()
          navigate('/orders')
        }}
      >
        Go to my orders
      </Button>
      <h3 className="t-h3 help-heading">
        Contact the cafe
        {CONTACT.placeholder && <span className="badge badge--muted badge--sm t-caption">Sample details</span>}
      </h3>
      <ul className="help-list">
        {rows.map((r) => (
          <li key={r.label}>
            <a
              className="help-list__row"
              href={r.href}
              target={r.href.startsWith('http') ? '_blank' : undefined}
              rel={r.href.startsWith('http') ? 'noopener' : undefined}
            >
              <Icon name={r.icon} size={20} />
              <span className="t-body">{r.label}</span>
              <span className="t-body-sm muted help-list__value">{r.value}</span>
            </a>
          </li>
        ))}
      </ul>
      <h3 className="t-h3">Opening hours</h3>
      <dl className="help-hours t-body-sm">
        {store.hours.map((h, i) => (
          <div key={DAYS[i]} className="help-hours__row">
            <dt>{DAYS[i]}</dt>
            <dd className="num">{h.closed ? 'Closed' : `${hourLabel(h.open)} – ${hourLabel(h.close)}`}</dd>
          </div>
        ))}
      </dl>
      {CONTACT.address && <p className="t-body-sm muted">{CONTACT.address}</p>}
    </Sheet>
  )
}
