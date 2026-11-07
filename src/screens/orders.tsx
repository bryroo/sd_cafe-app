// Flow 4 — Order tracking and history (C-17, C-18, C-19)
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BottomNav, Tabs } from '../components/blocks'
import {
  Alert,
  FulfillmentBadge,
  FulfillmentDetails,
  OfflineBanner,
  OptionRow,
  OrderCard,
  OrderLine,
  PriceBreakdown,
  StatusBadge,
  StatusStepper,
  lineName,
} from '../components/order'
import { Content, Row, Screen, TopBar, TopBarAction } from '../components/Screen'
import { Button } from '../components/ui'
import { Icon } from '../components/Icon'
import { isUnavailable, peso, priceFor } from '../data/menu'
import { pastOrderByNumber, pastOrders, type PastOrder } from '../data/orders'
import { useOverlay } from '../overlays/OverlayHost'
import { useApp, type CartLine } from '../state/AppState'
import { useOnline, retryConnection } from '../state/online'
import {
  clock,
  dateTime,
  etaLine,
  lastSynced,
  moveOrder,
  reloadShared,
  stepLabel,
  type Fulfillment,
  type Order,
  type OrderStatus,
} from '../state/shared'
import './orders.css'

type Tone = 'muted' | 'accent' | 'success' | 'dark' | 'error'

const STEP_STATUS: OrderStatus[] = ['Received', 'Accepted', 'Preparing', 'Ready', 'Completed']

const STEPS: Record<Fulfillment, string[]> = {
  pickup: ['Received', 'Accepted', 'Preparing', 'Ready', 'Completed'],
  delivery: ['Received', 'Accepted', 'Preparing', 'Out for delivery', 'Delivered'],
}

const HEADLINES: Record<Fulfillment, string[]> = {
  pickup: ['We got your order', 'Order accepted', 'Preparing your order', 'Your order is ready', 'Order completed'],
  delivery: [
    'We got your order',
    'Order accepted',
    'Preparing your order',
    'Your order is on the way',
    'Order delivered',
  ],
}

/** `?state=` values the screen index uses to show a specific Figma frame (shown, not saved) */
const STATE_PARAM: Record<string, number | 'cancelled'> = {
  received: 0,
  preparing: 2,
  ready: 3,
  out: 3,
  completed: 4,
  delivered: 4,
  cancelled: 'cancelled',
}

export const summarize = (lines: CartLine[]) => {
  const count = lines.reduce((n, l) => n + l.qty, 0)
  return `${count} item${count === 1 ? '' : 's'} · ${lines.map(lineName).join(', ')}`
}

const stageOf = (o: Order) => Math.max(0, STEP_STATUS.indexOf(o.status))

/** The badge tone for an order's status: gold only while it is moving */
export const statusTone = (s: OrderStatus): Tone =>
  s === 'Cancelled' ? 'error' : s === 'Completed' ? 'dark' : s === 'Ready' ? 'success' : s === 'Received' ? 'muted' : 'accent'

/** "Updated just now" / "Updated 3 min ago", ticking */
function useUpdatedAgo() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  const mins = Math.floor((now - lastSynced()) / 60_000)
  return { label: mins < 1 ? 'Updated just now' : `Updated ${mins} min ago`, tick: () => setNow(Date.now()) }
}

/** FR-TRK-02: drag the screen down to refresh (touch); the top bar has a refresh button too */
function usePullToRefresh(onRefresh: () => void) {
  const [pull, setPull] = useState(0)
  const start = useRef<number | null>(null)
  const bind = {
    onTouchStart: (e: React.TouchEvent) => {
      const body = (e.currentTarget as HTMLElement).closest('.screen__body')
      start.current = body && body.scrollTop > 0 ? null : e.touches[0].clientY
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (start.current === null) return
      setPull(Math.max(0, Math.min(90, e.touches[0].clientY - start.current)))
    },
    onTouchEnd: () => {
      if (pull > 60) onRefresh()
      start.current = null
      setPull(0)
    },
  }
  return { pull, bind }
}

let updatesAsked = false

/** C-17 Order Tracking — pickup (Received → Completed, Cancelled) and delivery (→ Delivered).
 *  Staff move the order on from the staff console; this screen follows within a second or two. */
export function OrderTracking() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const overlay = useOverlay()
  const online = useOnline()
  const { lastOrder, activeOrders, myOrders, notificationsOn } = useApp()
  const n = Number(params.get('n'))
  // A link to a specific order (e.g. from a notification) shows that order or says it's gone, never a different one
  const order = n ? myOrders.find((o) => o.number === n) : lastOrder || activeOrders[0]
  const forced = params.get('state')
  const updated = useUpdatedAgo()
  const [spinning, setSpinning] = useState(false)

  const refresh = () => {
    setSpinning(true)
    if (online) reloadShared()
    else retryConnection()
    updated.tick()
    setTimeout(() => setSpinning(false), 600)
  }
  const { pull, bind } = usePullToRefresh(refresh)

  // O-11 Get order updates — asked once, when tracking an order placed in this session.
  useEffect(() => {
    if (updatesAsked || notificationsOn || forced || !order || order.number === 1042) return
    const t = setTimeout(() => {
      updatesAsked = true
      overlay.open('order-updates')
    }, 600)
    return () => clearTimeout(t)
  }, [notificationsOn, forced, overlay, order])

  if (!order) {
    return (
      <Screen topBar={<TopBar title="Order" onBack={() => navigate('/home')} />}>
        <Content>
          <Row>
            <p className="t-body muted">
              {n ? `We couldn't find order #${n}. It may have been removed.` : "There's no order to track. Orders you place show up here."}
            </p>
          </Row>
        </Content>
      </Screen>
    )
  }

  const f = order.fulfillment
  const forcedState = forced ? STATE_PARAM[forced] : undefined
  const cancelled = forcedState === 'cancelled' || (forcedState === undefined && order.status === 'Cancelled')
  const stage = typeof forcedState === 'number' ? forcedState : stageOf(order)
  const times = STEP_STATUS.map((s, i) => {
    if (typeof forcedState === 'number') return i <= stage ? clock(order.placedAt) : undefined
    const e = order.timeline.find((t) => t.status === s)
    return e ? clock(e.at) : undefined
  })
  const delayed = !cancelled && order.isDelayed && forcedState === undefined

  // SRS FR-TRK-04 / AS-09: cancellable while Received or Accepted; from Preparing on, it's too late
  const cancel = async () => {
    if (stage >= 2) return overlay.open('too-late')
    const ok = await overlay.confirm('cancel-order')
    if (!ok) return
    try {
      // FR-TRK-05: the shared store refunds in-app payments and gives the voucher back
      moveOrder(order.number, 'Cancelled', 'customer')
    } catch {
      overlay.open('too-late')
    }
  }

  const detailStatus = (): { status?: string; tone?: 'default' | 'success' | 'accent' } => {
    if (f === 'pickup') {
      if (stage === 3) return { status: 'Ready for pickup', tone: 'success' }
      if (stage === 4) return { status: `Picked up at ${times[4] ?? clock(Date.now())}`, tone: 'success' }
      return { status: etaLine(order) }
    }
    if (stage === 3) return { status: `Out for delivery · ${etaLine(order).toLowerCase()}`, tone: 'accent' }
    if (stage === 4) return { status: `Delivered at ${times[4] ?? clock(Date.now())}`, tone: 'success' }
    return { status: etaLine(order) }
  }

  const headline = cancelled ? 'Order cancelled' : HEADLINES[f][stage]

  return (
    <Screen
      topBar={
        <TopBar
          title={`Order #${order.number}`}
          onBack={() => navigate('/home')}
          actions={<TopBarAction label="Refresh" icon="refresh" onClick={refresh} />}
        />
      }
    >
      <div className="ptr" {...bind}>
        {(pull > 0 || spinning) && (
          <div className="ptr__spinner" style={{ height: spinning ? 40 : pull / 2 }} aria-hidden>
            <Icon name="refresh" size={20} style={{ transform: `rotate(${pull * 4}deg)` }} />
          </div>
        )}
        <Content>
          {!online && (
            <Row>
              <OfflineBanner onRetry={refresh}>You're offline. This is the last status we had · {updated.label}.</OfflineBanner>
            </Row>
          )}
          <Row>
            <section className="track-board" aria-label="Order status">
              <div className="track-badges">
                {/* The headline names the stage; the badge only flags a cancelled or delayed order */}
                {cancelled && <StatusBadge label="Cancelled" tone="error" />}
                {delayed && <StatusBadge label="Delayed" tone="accent" />}
                <span className="track-board__mode t-body-sm">
                  <Icon name={f === 'delivery' ? 'truck' : 'store'} size={18} />
                  {f === 'delivery' ? 'Delivery' : 'Pickup'}
                </span>
              </div>
              <h2 className="t-display track-board__headline">{headline}</h2>
              {!cancelled && <StatusStepper steps={STEPS[f]} current={stage} times={times} dark />}
            </section>
          </Row>
          {online && (
            <Row>
              <p className="t-caption muted track-updated" aria-live="polite">
                {updated.label}
              </p>
            </Row>
          )}

          {delayed && (
            <Row>
              <Alert tone="warning">Taking a bit longer. New estimate: {etaLine(order).toLowerCase()}.</Alert>
            </Row>
          )}

          {cancelled ? (
            <Row>
              <Alert tone="danger">
                {order.cancelledBy === 'customer'
                  ? 'You cancelled this order.'
                  : `The cafe cancelled this order: ${(order.cancelReason ?? 'an item ran out').toLowerCase()}.`}{' '}
                {refundNote(order)}
              </Alert>
            </Row>
          ) : (
            <Row>
              <FulfillmentDetails
                type={f}
                address={order.address}
                {...detailStatus()}
                orderNumber={f === 'pickup' && stage === 3 ? order.number : undefined}
              />
            </Row>
          )}

          <Row>
            <div className="card options-card">
              <OptionRow
                icon="receipt"
                label="Order summary"
                value={`${order.lines.reduce((n, l) => n + l.qty, 0)} items · ${peso(order.total)}`}
                onClick={() => navigate(`/orders/${order.number}`)}
              />
            </div>
          </Row>
          <Row>
            <p className="t-body-sm muted">Need help with your order? Ask at the counter or call the cafe.</p>
          </Row>
          {!cancelled && stage <= 1 && (
            <Row>
              <Button variant="danger-outline" onClick={cancel}>
                Cancel order
              </Button>
            </Row>
          )}
        </Content>
      </div>
    </Screen>
  )
}

/** What happens to the money on a cancelled order */
export const refundNote = (o: Pick<Order, 'paymentStatus' | 'payment'>) =>
  o.paymentStatus === 'Refund started'
    ? `Refund started to ${o.payment}. It can take 3–7 banking days.`
    : 'You were not charged.'

/** Adds a past order's lines to the cart; asks first (O-08) if some items are off the menu today. */
function useReorder() {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { addToCart } = useApp()
  return async (lines: CartLine[]) => {
    const gone = (l: CartLine) => isUnavailable(l.productId) || priceFor(l.productId, l.options) === undefined
    const missing = lines.filter(gone)
    if (missing.length) {
      const ok = await overlay.confirm('unavailable', { items: missing.map(lineName) })
      // SRS FR-ROR-04: if every item is unavailable, the cart is left unchanged
      if (!ok || missing.length === lines.length) return
    }
    lines
      .filter((l) => !gone(l))
      .forEach((l) =>
        addToCart({ productId: l.productId, options: l.options, note: l.note, unitPrice: priceFor(l.productId, l.options)!, qty: l.qty }),
      )
    navigate('/cart')
  }
}

/** C-18 Orders — Active and History tabs. */
export function Orders() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'history' ? 'history' : 'active'
  const { activeOrders, myOrders } = useApp()
  const reorder = useReorder()
  const done = myOrders.filter((o) => o.status === 'Completed' || o.status === 'Cancelled')

  return (
    <Screen
      topBar={
        <>
          <TopBar type="title" title="Orders" />
          <div className="tabs--full">
            <Tabs
              items={[
                { id: 'active', label: 'Active' },
                { id: 'history', label: 'History' },
              ]}
              value={tab}
              onChange={(t) => setParams(t === 'history' ? { tab: 'history' } : {}, { replace: true })}
            />
          </div>
        </>
      }
      bottomNav={<BottomNav active="orders" />}
    >
      <Content>
        {tab === 'active' ? (
          activeOrders.length ? (
            activeOrders.map((o) => (
              <Row key={o.number}>
                <OrderCard
                  number={o.number}
                  summary={`${summarize(o.lines)} · ${etaLine(o)}`}
                  total={o.total}
                  when={dateTime(o.placedAt)}
                  status={{ label: o.isDelayed ? 'Delayed' : stepLabel(o, o.status), tone: statusTone(o.status) }}
                  action="Track order"
                  onAction={() => navigate(`/orders/tracking?n=${o.number}`)}
                  onOpen={() => navigate(`/orders/tracking?n=${o.number}`)}
                />
              </Row>
            ))
          ) : (
            <Row>
              <div className="orders-empty">
                <Icon name="receipt" size={36} color="var(--muted)" />
                <span className="t-h3">No active orders</span>
                <span className="t-body muted">Orders you place show up here until they're done.</span>
                <Button full={false} onClick={() => navigate('/menu')}>
                  Start an order
                </Button>
              </div>
            </Row>
          )
        ) : (
          // FR-ROR-01: newest first — orders from the app, then the older history
          <>
            {done.map((o) => (
              <Row key={o.number}>
                <OrderCard
                  number={o.number}
                  summary={summarize(o.lines)}
                  total={o.total}
                  when={dateTime(o.placedAt)}
                  status={{ label: stepLabel(o, o.status), tone: statusTone(o.status) }}
                  action="Reorder"
                  onAction={() => reorder(o.lines)}
                  onOpen={() => navigate(`/orders/${o.number}`)}
                />
              </Row>
            ))}
            {pastOrders.map((o) => (
              <Row key={o.number}>
                <OrderCard
                  number={o.number}
                  summary={summarize(o.lines)}
                  total={o.subtotal - o.discount}
                  when={o.date}
                  status={{ label: o.status, tone: o.status === 'Cancelled' ? 'error' : 'dark' }}
                  action="Reorder"
                  onAction={() => reorder(o.lines)}
                  onOpen={() => navigate(`/orders/${o.number}`)}
                />
              </Row>
            ))}
          </>
        )}
      </Content>
    </Screen>
  )
}

/** C-19 Order Detail — an order from the app, or one from the older history. */
export function OrderDetail() {
  const { number = '' } = useParams()
  const navigate = useNavigate()
  const reorder = useReorder()
  const { myOrders } = useApp()
  const n = Number(number)
  const live = myOrders.find((o) => o.number === n)
  const past: PastOrder | undefined = live ? undefined : pastOrderByNumber(n)

  if (!live && !past) {
    return (
      <Screen topBar={<TopBar title="Order" />}>
        <Content>
          <Row>
            <p className="t-body muted">We couldn't find that order.</p>
          </Row>
        </Content>
      </Screen>
    )
  }

  const lines = live ? live.lines : past!.lines
  const status = live ? stepLabel(live, live.status) : past!.status
  const tone = live ? statusTone(live.status) : past!.status === 'Cancelled' ? 'error' : 'dark'
  const f = live ? live.fulfillment : past!.fulfillment
  const active = live && live.status !== 'Completed' && live.status !== 'Cancelled'

  return (
    <Screen
      footerBorder
      topBar={<TopBar title={`Order #${n}`} />}
      footer={
        active ? (
          <Button onClick={() => navigate(`/orders/tracking?n=${n}`)}>Track order</Button>
        ) : (
          <Button onClick={() => reorder(lines)}>Reorder</Button>
        )
      }
    >
      <Content>
        <Row>
          <div className="detail-head">
            <StatusBadge label={status} tone={tone} />
            <FulfillmentBadge type={f} size="L" />
            <span className="t-body-sm muted">{live ? dateTime(live.placedAt) : past!.date}</span>
          </div>
        </Row>
        {live?.status === 'Cancelled' && (
          <Row>
            <Alert tone="danger">
              {live.cancelledBy === 'customer' ? 'You cancelled this order.' : `Cancelled by the cafe: ${live.cancelReason}.`}{' '}
              {refundNote(live)}
            </Alert>
          </Row>
        )}
        <Row>
          <div>
            {lines.map((l) => (
              <OrderLine key={l.key} line={l} />
            ))}
          </div>
        </Row>
        <Row>
          {live ? (
            <PriceBreakdown
              subtotal={live.subtotal}
              discount={live.discount}
              offer={live.offerName ? { name: live.offerName, amount: live.offerDiscount ?? 0, note: '' } : null}
              reward={live.rewardName ? { name: live.rewardName, amount: live.rewardDiscount ?? 0, items: [] } : null}
              deliveryFee={live.deliveryFee}
            />
          ) : (
            <PriceBreakdown subtotal={past!.subtotal} discount={past!.discount} deliveryFee={0} />
          )}
        </Row>
        <Row>
          <div className="card options-card">
            <div className="option-row">
              <Icon name="card" size={20} color="var(--muted)" />
              <span className="t-body option-row__label">Payment method</span>
              <span className="t-body-sm muted">{live ? live.payment : past!.payment}</span>
            </div>
            <div className="option-row">
              <Icon name="receipt" size={20} color="var(--muted)" />
              <span className="t-body option-row__label">Order number</span>
              <span className="t-body-sm muted">#{n}</span>
            </div>
          </div>
        </Row>
      </Content>
    </Screen>
  )
}
