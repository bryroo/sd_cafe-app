// Overlays O-01 … O-12: bottom sheets and dialogs, rendered inside the phone frame.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Radio, Stepper, TextArea } from '../components/blocks'
import { DiscountRow } from '../components/order'
import { Button, Photo, TextField } from '../components/ui'
import { Icon } from '../components/Icon'
import counterPhoto from '../assets/photos/counter-cup-meal.webp'
import { peso, productById } from '../data/menu'
import { checkPromo, featuredPromotion, freeItemsLine, rewardById, rewardSavings } from '../data/rewards'
import { COUNTER, quickAddLine, tierDiscount, useApp } from '../state/AppState'
import { deleteCustomerData } from '../state/shared'
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

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
          <div className="app-toast" role="status" key={toastState.id}>
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
        <Sheet title="Log in to place your order" onClose={close}>
          <p className="t-body muted">Your cart is saved. Log in or sign up and you will come right back to it.</p>
          <Button
            onClick={() => {
              close()
              navigate('/log-in')
            }}
          >
            Log in
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              close()
              navigate('/sign-up')
            }}
          >
            Sign up
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
  const product = productById(productId)
  const [qty, setQty] = useState(1)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  if (!product) return null
  return (
    <Sheet title="Quick add" onClose={close}>
      <div className="quick-add-row">
        <span className="quick-add-row__text">
          <span className="t-h3">{product.name}</span>
          <span className="t-body muted">{peso(product.price)}</span>
        </span>
        <Stepper value={qty} onChange={setQty} min={1} removeAtMin onRemove={close} />
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
        onClick={() => {
          addToCart({ ...quickAddLine(product.id), qty, note: note.trim() })
          close()
        }}
      >
        Add · {peso(product.price * qty)}
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
          {checking ? 'Checking…' : 'Apply'}
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
        Apply
      </Button>
    </Sheet>
  )
}

