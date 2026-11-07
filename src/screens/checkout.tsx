// Flow 3 — Cart, pickup or delivery, checkout (C-14, C-32, C-33, C-15, C-16)
import { useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Content, Row, Screen, TopBar } from '../components/Screen'
import { TextArea } from '../components/blocks'
import {
  AddressCard,
  Alert,
  CartItem,
  ClosedBanner,
  FulfillmentDetails,
  FulfillmentSelector,
  FulfillmentSummary,
  OptionRow,
  OrderLine,
  PriceBreakdown,
  lineName,
} from '../components/order'
import { etaLine, type CartLine } from '../state/shared'
import { Button, Loader, TextField } from '../components/ui'
import { Icon } from '../components/Icon'
import { Lamp } from '../components/Lamp'
import { peso } from '../data/menu'
import { offerHint } from '../data/rewards'
import {
  FREE_DRINK_THRESHOLD,
  useApp,
  type Address,
} from '../state/AppState'
import { useOverlay } from '../overlays/OverlayHost'
import './checkout.css'

/** Totals for the current cart, fulfillment and discount choice. */
function useTotals() {
  return useApp().totals
}

function EmptyCart() {
  const navigate = useNavigate()
  return (
    <Screen
      topBar={<TopBar title="Your order" />}
      footer={<Button onClick={() => navigate('/menu')}>Browse the menu</Button>}
    >
      <div className="empty-cart">
        <Icon name="receipt" size={40} color="var(--muted)" />
        <h2 className="t-h2">Your cart is empty</h2>
        <p className="t-body muted">Add a drink or a meal to get started.</p>
      </div>
    </Screen>
  )
}

/** C-14 Cart — Default (pickup) and Delivery states follow the chosen fulfillment. */
export function Cart() {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { cart, setQty, fulfillment, addresses, addressId, open, unavailableLines } = useApp()
  const { subtotal, reward, offer, discount, deliveryFee, total } = useTotals()
  const address = addresses.find((a) => a.id === addressId)
  const hint = offerHint(cart)

  if (cart.length === 0) return <EmptyCart />

  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Your order" />}
      footer={
        <Button
          className="btn--split"
          height={52}
          disabled={unavailableLines.length > 0}
          onClick={() => navigate('/checkout')}
        >
          <span>Checkout</span>
          <span className="num">{peso(total)}</span>
        </Button>
      }
    >
      <Content>
        {!open.open && (
          <Row>
            <ClosedBanner {...open} />
          </Row>
        )}
        {unavailableLines.length > 0 && (
          <Row>
            <Alert tone="danger">
              {unavailableLines.map(lineName).join(' and ')} {unavailableLines.length > 1 ? 'are' : 'is'} no longer
              available. Remove {unavailableLines.length > 1 ? 'them' : 'it'} to check out.
            </Alert>
          </Row>
        )}
        <Row>
          <FulfillmentSummary type={fulfillment} address={address} onChange={() => navigate('/fulfillment')} />
        </Row>
        <Row>
          <div className="cart-items">
            {cart.map((l) => (
              <CartItem
                key={l.key}
                line={l}
                onQty={async (q) => {
                  if (q > 0 || (await overlay.confirm('remove-item', { name: lineName(l) }))) setQty(l.key, q)
                }}
                onEdit={() => navigate(`/product/${l.productId}?edit=${encodeURIComponent(l.key)}`)}
              />
            ))}
          </div>
        </Row>
        <Row>
          <div>
            <Button variant="text" height={48} full={false} onClick={() => navigate('/menu')}>
              Add more items
            </Button>
          </div>
        </Row>
        {hint && (
          <Row>
            <Alert tone="success">{hint}</Alert>
          </Row>
        )}
        {subtotal < FREE_DRINK_THRESHOLD && (
          <Row>
            <Alert>Add {peso(FREE_DRINK_THRESHOLD - subtotal)} more to get a free drink.</Alert>
          </Row>
        )}
        <Row>
          <PriceBreakdown subtotal={subtotal} reward={reward} offer={offer} discount={discount} deliveryFee={deliveryFee} />
        </Row>
      </Content>
    </Screen>
  )
}

/** C-32 Pickup or Delivery — Default (pickup) and Delivery states. */
export function PickupOrDelivery() {
  const navigate = useNavigate()
  const { fulfillment, setFulfillment, addresses, addressId, setAddressId, deliveryEnabled } = useApp()
  const address = addresses.find((a) => a.id === addressId)

  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Pickup or delivery" />}
      footer={
        <Button
          disabled={fulfillment === 'delivery' && !address}
          onClick={() => navigate('/checkout', { replace: true })}
        >
          Continue to checkout
        </Button>
      }
    >
      <Content>
        <Row>
          <FulfillmentSelector value={fulfillment} onChange={setFulfillment} deliveryOff={!deliveryEnabled} />
        </Row>
        {!deliveryEnabled && (
          <Row>
            <Alert>Delivery is off for now. You can still order for pickup at the counter.</Alert>
          </Row>
        )}
        {fulfillment === 'delivery' && (
          <>
            <Row>
              <h2 className="t-h3">Deliver to</h2>
            </Row>
            <Row>
              <div className="address-list" role="radiogroup" aria-label="Delivery address">
                {addresses.map((a) => (
                  <AddressCard
                    key={a.id}
                    address={a}
                    selected={a.id === addressId}
                    onSelect={() => setAddressId(a.id)}
                    onEdit={() => navigate(`/address/${a.id}`)}
                  />
                ))}
              </div>
            </Row>
            <Row>
              <div>
                <Button variant="secondary" height={48} full={false} onClick={() => navigate('/address/new')}>
                  Add new address
                </Button>
              </div>
            </Row>
          </>
        )}
        <Row>
          <FulfillmentDetails type={fulfillment} address={address} />
        </Row>
      </Content>
    </Screen>
  )
}

/** C-33 Delivery Address — add (`/address/new`) or edit (`/address/:id`). */
export function DeliveryAddress() {
  const { id = 'new' } = useParams()
  const navigate = useNavigate()
  const { addresses, saveAddress, setAddressId, name, phone } = useApp()
  const existing = addresses.find((a) => a.id === id)

  const [recipient, setRecipient] = useState(existing?.name ?? '')
  const [mobile, setMobile] = useState(existing?.phone ?? '')
  const [street, setStreet] = useState(existing?.street ?? '')
  const [landmark, setLandmark] = useState('')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const valid = recipient.trim() && mobile.trim() && street.trim()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The order is delivered to an address saved on the account (the server reads it when ordering)
  const submit = async () => {
    const a: Address = {
      id: existing?.id ?? `addr-${Date.now()}`,
      label: existing?.label ?? 'Other',
      name: recipient.trim(),
      phone: mobile.trim(),
      street: [landmark.trim(), street.trim()].filter(Boolean).join(', '),
      notes: notes.trim() || undefined,
      isDefault: existing?.isDefault,
    }
    setBusy(true)
    setError('')
    try {
      const savedId = await saveAddress(a)
      setAddressId(savedId)
      navigate(-1)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the address. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen topBar={<TopBar title="Delivery address" />}>
      <Content>
        <Row>
          <div className="address-form">
            <TextField
              label="Recipient name"
              helper="Required"
              placeholder={name}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoComplete="name"
            />
            <TextField
              label="Mobile number"
              helper="Required"
              placeholder={phone}
              inputMode="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              autoComplete="tel"
            />
            <TextField
              label="Street address"
              helper="Required"
              placeholder="House no., street, barangay, city"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              autoComplete="street-address"
            />
            <TextField
              label="Building, unit or landmark"
              helper="Optional"
              placeholder="e.g. Unit 8B, near the church"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
            />
            <TextArea
              label="Delivery notes"
              helper="Optional"
              placeholder="e.g. Leave at the door"
              value={notes}
              onChange={setNotes}
            />
            <p className="t-body-sm muted">Saved to your addresses, so you can pick it again next time.</p>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button disabled={!valid || busy} onClick={submit} aria-busy={busy}>
              {busy ? 'Saving…' : 'Save address'}
            </Button>
          </div>
        </Row>
        <Row>
          <p className="t-caption muted">
            Address entry is a placeholder form. It is replaced by the maps / address provider SDK.
          </p>
        </Row>
      </Content>
    </Screen>
  )
}

/** C-15 Checkout — Default, Delivery, Processing (Place order shows the scrim + spinner). */
export function Checkout() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const app = useApp()
  const { cart, cartCount, fulfillment, addresses, addressId, payment, session, useTierDiscount, placeOrder, open, unavailableLines } =
    app
  const { subtotal, reward, offer, discount, deliveryFee, total, promoProblem } = useTotals()
  const overlay = useOverlay()
  const [note, setNote] = useState('')
  const [processing, setProcessing] = useState(params.get('state') === 'processing')
  const [paymentError, setPaymentError] = useState(false)
  const paymentRow = useRef<HTMLDivElement>(null)
  // One id per checkout: a retry or a double tap re-sends the same id and never makes a second order
  const attempt = useRef(crypto.randomUUID())
  const address = addresses.find((a) => a.id === addressId)
  const blocked = !open.open || unavailableLines.length > 0

  if (cart.length === 0 && !processing) return <EmptyCart />

  const submit = async (retry = false): Promise<void> => {
    if (session !== 'member') {
      overlay.open('login-to-order')
      return
    }
    if (blocked) return
    // FR-CHK-07: no payment method → the row shows an error and scrolls into view
    if (!payment) {
      setPaymentError(true)
      paymentRow.current?.scrollIntoView({ block: 'center' })
      return
    }
    // FR-CHK-09: the same cart ordered in the last 5 minutes
    const last = app.lastOrder
    if (!retry && last && last.status !== 'Cancelled' && Date.now() - last.placedAt < 5 * 60 * 1000 && sameCart(last.lines, cart)) {
      const go = await overlay.confirm('similar-order')
      if (!go) return
    }
    setProcessing(true)
    // Demo test card (README): 0119 shows the "order failed after payment" screen once; the retry
    // re-sends the same attempt id, so it can never make a second order (IR-08)
    if (payment === FAILS_ONCE_CARD && !failedAttempts.has(attempt.current)) {
      failedAttempts.add(attempt.current)
      await new Promise((r) => setTimeout(r, 1200))
      setProcessing(false)
      if (await overlay.confirm('order-failed')) return submit(true)
      return
    }
    // The server prices the cart again and places the order (place-order Edge Function)
    const r = await placeOrder(note, attempt.current)
    if (r.ok) {
      navigate('/order-confirmation', { replace: true })
      return
    }
    setProcessing(false)
    switch (r.code) {
      // Test card 0002, or a real decline: nothing was charged (3.2.4.5)
      case 'PAYMENT_DECLINED': {
        if (await overlay.confirm('payment-declined')) return submit(true)
        overlay.open('payment')
        return
      }
      // A connection problem or a failure after payment: safe to retry with the same attempt id
      case 'OFFLINE':
      case 'ORDER_FAILED':
      case 'FAILED': {
        if (await overlay.confirm('order-failed')) return submit(true)
        return
      }
      // Prices, offers, a code or a voucher changed: the new totals are on screen; say why (3.2.4.5)
      case 'PROMO_INVALID':
        app.setAppliedPromo(null)
        overlay.toast(r.message)
        return
      case 'REWARD_INVALID':
        app.setAppliedReward(null)
        overlay.toast(r.message)
        return
      case 'SIGN_IN':
        overlay.open('login-to-order')
        return
      default:
        // TOTAL_CHANGED, STORE_CLOSED, ITEM_UNAVAILABLE, DELIVERY_OFF, ADDRESS, PAYMENT: the cart is kept
        overlay.toast(r.message)
    }
  }

  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Checkout" />}
      footer={
        <Button
          onClick={() => submit()}
          disabled={processing || blocked}
          aria-busy={processing}
          className={`btn--processing ${processing ? '' : 'btn--split'}`}
          height={52}
        >
          {processing ? (
            <Loader dark />
          ) : (
            <>
              <span>Place order</span>
              <span className="num">{peso(total)}</span>
            </>
          )}
        </Button>
      }
      overlay={processing && <div className="processing-scrim" aria-hidden />}
    >
      <Content>
        {!open.open && (
          <Row>
            <ClosedBanner {...open} />
          </Row>
        )}
        {unavailableLines.length > 0 && (
          <Row>
            <Alert tone="danger">
              {unavailableLines.map(lineName).join(' and ')} {unavailableLines.length > 1 ? 'are' : 'is'} no longer
              available. Go back to your cart to remove {unavailableLines.length > 1 ? 'them' : 'it'}.
            </Alert>
          </Row>
        )}
        {promoProblem && (
          <Row>
            <Alert tone="warning">{promoProblem}</Alert>
          </Row>
        )}
        <Row>
          <FulfillmentSummary type={fulfillment} address={address} onChange={() => navigate('/fulfillment')} />
        </Row>
        <Row>
          <section className="card checkout-items" aria-labelledby="checkout-items">
            <div className="checkout-items__head">
              <h2 id="checkout-items" className="t-h3">
                {cartCount} item{cartCount === 1 ? '' : 's'}
              </h2>
              <button className="t-body-sm link-text" onClick={() => navigate('/cart')}>
                Edit
              </button>
            </div>
            {cart.map((l) => (
              <OrderLine key={l.key} line={l} />
            ))}
          </section>
        </Row>
        <Row>
          <div className={`card options-card ${paymentError ? 'options-card--error' : ''}`} ref={paymentRow}>
            <OptionRow
              icon="tag"
              label="Discount & rewards"
              value={
                session !== 'member'
                  ? 'Log in to use'
                  : [offer?.code, reward?.name].filter(Boolean).join(' · ') ||
                    (useTierDiscount ? 'Regular discount' : 'None')
              }
              onClick={() => overlay.open('discounts')}
            />
            <OptionRow
              icon="card"
              label="Payment method"
              value={payment || 'Choose a method'}
              onClick={() => {
                setPaymentError(false)
                overlay.open('payment')
              }}
            />
          </div>
          {paymentError && (
            <p className="field__error t-caption" role="alert">
              <Icon name="alert" size={16} />
              Choose how you'll pay.
            </p>
          )}
        </Row>
        <Row>
          <TextArea
            label="Note for the cafe"
            placeholder="Optional"
            helper="Optional · up to 140 characters"
            value={note}
            onChange={setNote}
          />
        </Row>
        <Row>
          <PriceBreakdown subtotal={subtotal} reward={reward} offer={offer} discount={discount} deliveryFee={deliveryFee} />
        </Row>
      </Content>
    </Screen>
  )
}

/** Demo test cards (see the README) */
export const DECLINED_CARD = 'Card ending 0002'
export const FAILS_ONCE_CARD = 'Card ending 0119'
/** Attempts whose first try already "failed" with the 0119 card: the retry goes through */
const failedAttempts = new Set<string>()

/** Same items, options, notes and quantities, in any order */
const sameCart = (a: CartLine[], b: CartLine[]) => {
  const sig = (lines: CartLine[]) =>
    lines
      .map((l) => `${l.productId}|${l.options.join(',')}|${l.note}|${l.qty}`)
      .sort()
      .join(';')
  return sig(a) === sig(b)
}

/** C-16 Order Confirmation — Default (pickup) and Delivery. */
export function OrderConfirmation() {
  const navigate = useNavigate()
  const { lastOrder, fulfillment, addresses, addressId } = useApp()
  const type = lastOrder?.fulfillment ?? fulfillment
  const address = lastOrder?.address ?? addresses.find((a) => a.id === addressId)

  return (
    <Screen
      footer={
        <>
          <Button
            onClick={() => navigate(lastOrder ? `/orders/tracking?n=${lastOrder.number}` : '/orders/tracking', { replace: true })}
          >
            Track order
          </Button>
          <Button variant="secondary" onClick={() => navigate('/menu', { replace: true })}>
            Back to menu
          </Button>
        </>
      }
    >
      <div className="confirmation">
        <header className="confirmation__head">
          <span className="confirmation__icon">
            <Lamp state="lit" size={56} label="" />
          </span>
          <div>
            <h1 className="t-h1">Order #{lastOrder?.number ?? 1042} placed</h1>
            <p className="t-body muted">Follow it on the tracker until it's ready.</p>
          </div>
        </header>
        <div className="confirmation__details">
          <FulfillmentDetails type={type} address={address} status={lastOrder ? etaLine(lastOrder) : undefined} />
        </div>
        {lastOrder && (
          <section className="card confirmation__items" aria-labelledby="conf-items">
            <h2 id="conf-items" className="t-h3">
              Your order
            </h2>
            {lastOrder.lines.map((l) => (
              <OrderLine key={l.key} line={l} />
            ))}
            {lastOrder.discount > 0 && (
              <div className="confirmation__row t-body-sm">
                <span>Regular discount</span>
                <span className="num">−{peso(lastOrder.discount)}</span>
              </div>
            )}
            {!!lastOrder.offerDiscount && (
              <div className="confirmation__row t-body-sm">
                <span>{lastOrder.offerName}</span>
                <span className="num">−{peso(lastOrder.offerDiscount)}</span>
              </div>
            )}
            {!!lastOrder.rewardDiscount && (
              <div className="confirmation__row t-body-sm">
                <span>{lastOrder.rewardName}</span>
                <span className="num">−{peso(lastOrder.rewardDiscount)}</span>
              </div>
            )}
            {lastOrder.deliveryFee > 0 && (
              <div className="confirmation__row t-body-sm">
                <span>Delivery fee</span>
                <span className="num">{peso(lastOrder.deliveryFee)}</span>
              </div>
            )}
            <div className="confirmation__total">
              <span className="t-h3">Total · {lastOrder.payment}</span>
              <span className="t-h3 num">{peso(lastOrder.total)}</span>
            </div>
          </section>
        )}
        <p className="confirmation__points t-body-sm">
          <Icon name="star" size={18} color="var(--gold-ink)" />+{lastOrder?.points ?? 120} points when completed
        </p>
      </div>
    </Screen>
  )
}
