// Staff order management (SRS 3.2.11): A-02 Dashboard, A-03 Incoming orders, A-04 Order detail,
// OA-01 Cancel order, OA-02 Internal note, and the Mark delayed sheet.
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Lamp } from '../components/Lamp'
import { PriceBreakdown, StatusBadge, formatOptions, lineName } from '../components/order'
import { peso } from '../data/menu'
import {
  MIN,
  addInternalNote,
  clock,
  dateTime,
  etaLine,
  eventFor,
  getShared,
  markDelayed,
  messageFor,
  moveOrder,
  nextStatuses,
  openState,
  setStore,
  stepLabel,
  undoAccept,
  useShared,
  type Order,
  type OrderStatus,
} from '../state/shared'
import { Fact, Metric, Modal, NewOrders, Panel, StaffButton, StaffOnly, age, firstNameOf, useStaff } from './kit'

const WAIT_FLAG = 10 * MIN

type Tone = 'muted' | 'accent' | 'success' | 'dark' | 'error'
const tone = (s: OrderStatus): Tone =>
  s === 'Cancelled' ? 'error' : s === 'Completed' ? 'dark' : s === 'Ready' ? 'success' : s === 'Received' ? 'muted' : 'accent'

/** The queue's name for a status: Received orders are "New" */
const statusName = (o: Order) => (o.status === 'Received' ? 'New' : stepLabel(o, o.status))

const itemCount = (o: Order) => o.lines.reduce((n, l) => n + l.qty, 0)

/** FR-STF-05: not accepted within 10 minutes */
const waiting = (o: Order, now: number) => o.status === 'Received' && now - o.placedAt >= WAIT_FLAG

/** What the action button says for each move */
const ACTION: Record<OrderStatus, (o: Order) => string> = {
  Received: () => 'Received',
  Accepted: () => 'Accept',
  Preparing: () => 'Start preparing',
  Ready: (o) => (o.fulfillment === 'delivery' ? 'Out for delivery' : 'Mark ready'),
  Completed: (o) => (o.fulfillment === 'delivery' ? 'Mark delivered' : 'Mark picked up'),
  Cancelled: () => 'Cancel order',
}

/** FR-STF-11: each action says which customer message it will send */
function CustomerGets({ o, to, reason }: { o: Order; to: OrderStatus; reason?: string }) {
  const m = messageFor(getShared(), eventFor(o, to, 'cafe'), o, reason ? { reason: reason.toLowerCase() } : {})
  return (
    <p className="st-gets t-body-sm">
      {m.enabled ? (
        <>
          <span className="muted">Customer gets{m.push ? ' (push)' : ''}:</span> <em>{m.body}</em>
        </>
      ) : (
        <span className="muted">No customer message: this template is turned off.</span>
      )}
    </p>
  )
}

/** Accept with a 5-second Undo (FR-STF-06) */
function useAccept() {
  const { act, toast } = useStaff()
  return (o: Order) => {
    const ok = act(() => moveOrder(o.number, 'Accepted', 'cafe', { actor: getShared().staff.name }))
    if (ok)
      toast(`Order #${o.number} accepted`, {
        label: 'Undo',
        onClick: () => act(() => undoAccept(o.number), `Order #${o.number} is back in New`),
      })
  }
}

/* ---------- A-02 Dashboard ---------- */

export function Dashboard({ onTurnOff }: { onTurnOff: () => void }) {
  const { orders, automations, store } = useShared()
  const { go, now, act } = useStaff()
  const count = (s: OrderStatus) => orders.filter((o) => o.status === s).length
  const failed = automations.filter((a) => a.state === 'failed' && !a.handled)
  const late = orders.filter((o) => waiting(o, now)).sort((a, b) => a.placedAt - b.placedAt)
  const open = openState(store, now)
  const latest = [...orders].sort((a, b) => b.placedAt - a.placedAt).slice(0, 5)

  return (
    <div className="st-page">
      <h1 className="t-h1">Dashboard</h1>

      <section className={`st-accepting ${open.open ? 'is-on' : ''}`} aria-label="Accepting orders">
        <Lamp state={open.open ? 'lit' : 'off'} size={40} />
        <span className="st-accepting__text">
          <span className="t-h2">{store.acceptingOrders ? 'Accepting orders' : 'Not accepting orders'}</span>
          <span className="t-body-sm">
            {open.today}
            {!open.open && open.why === 'hours' && store.acceptingOrders ? ` · closed now · ${open.next ?? ''}` : ''}
          </span>
        </span>
        {store.acceptingOrders ? (
          <StaffButton variant="secondary" onClick={onTurnOff}>
            Stop orders
          </StaffButton>
        ) : (
          <StaffButton onClick={() => act(() => setStore({ acceptingOrders: true }), 'Accepting orders again')}>Start accepting</StaffButton>
        )}
      </section>

      <div className="st-metrics">
        <Metric label="New" value={count('Received')} icon="bell" alert onClick={() => go('/staff/orders?tab=Received')} />
        <Metric label="Preparing" value={count('Preparing')} icon="cup" onClick={() => go('/staff/orders?tab=Preparing')} />
        <Metric label="Ready" value={count('Ready')} icon="check" onClick={() => go('/staff/orders?tab=Ready')} />
        <Metric label="Delayed" value={orders.filter((o) => o.isDelayed && o.status !== 'Cancelled').length} icon="clock" alert />
        <Metric label="Automation failures" value={failed.length} icon="repeat" alert onClick={() => go('/staff/automations?filter=failed')} />
      </div>

      <div className="st-cols">
        <Panel title="Alerts">
          {late.length === 0 && failed.length === 0 && store.acceptingOrders && open.open ? (
            <p className="t-body muted">Nothing needs you right now.</p>
          ) : (
            <ul className="st-alerts">
              {!store.acceptingOrders && (
                <li className="st-alert">
                  <Icon name="alert" size={20} />
                  <span className="t-body">Accepting orders is off. Customers can't order.</span>
                </li>
              )}
              {store.acceptingOrders && !open.open && (
                <li className="st-alert">
                  <Icon name="clock" size={20} />
                  <span className="t-body">Outside opening hours. {open.next}.</span>
                </li>
              )}
              {late.map((o) => (
                <li key={o.number}>
                  <button className="st-alert" onClick={() => go(`/staff/orders/${o.number}`)}>
                    <Icon name="clock" size={20} />
                    <span className="t-body">
                      Order #{o.number} waiting {age(o.placedAt, now)} to be accepted
                    </span>
                    <Icon name="chevron" size={20} />
                  </button>
                </li>
              ))}
              {failed.map((a) => (
                <li key={a.id}>
                  <button className="st-alert" onClick={() => go(`/staff/automations/${a.id}`)}>
                    <Icon name="repeat" size={20} />
                    <span className="t-body">
                      Automated order failed: {a.customer} · {a.reason}
                    </span>
                    <Icon name="chevron" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Latest orders" action={<button className="link-text t-body-sm" onClick={() => go('/staff/orders')}>All orders</button>}>
          <div className="st-rows">
            {latest.map((o) => (
              <OrderRow key={o.number} o={o} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

/* ---------- A-03 Incoming orders ---------- */

const TABS: { id: OrderStatus; label: string }[] = [
  { id: 'Received', label: 'New' },
  { id: 'Accepted', label: 'Accepted' },
  { id: 'Preparing', label: 'Preparing' },
  { id: 'Ready', label: 'Ready' },
  { id: 'Completed', label: 'Completed' },
  { id: 'Cancelled', label: 'Cancelled' },
]

function OrderRow({ o, withAccept }: { o: Order; withAccept?: boolean }) {
  const { go, now, online } = useStaff()
  const accept = useAccept()
  const late = waiting(o, now)
  return (
    <div className={`st-row ${NewOrders.fresh.has(o.number) ? 'is-fresh' : ''} ${late ? 'is-late' : ''}`}>
      <button className="st-row__hit" onClick={() => go(`/staff/orders/${o.number}`)} aria-label={`Order #${o.number}`} />
      <span className="st-row__num t-h3 num">#{o.number}</span>
      <span className="st-row__who">
        <span className="t-body">{firstNameOf(o.customerName)}</span>
        <span className="t-body-sm muted">
          {itemCount(o)} item{itemCount(o) === 1 ? '' : 's'} · {peso(o.total)}
        </span>
      </span>
      <span className="st-row__mode t-body-sm">
        <Icon name={o.fulfillment === 'delivery' ? 'truck' : 'store'} size={18} />
        {o.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}
      </span>
      <span className="st-row__age t-body-sm num">
        {late ? (
          <span className="st-late">
            <Icon name="clock" size={16} />
            Waiting {age(o.placedAt, now)}
          </span>
        ) : (
          age(o.placedAt, now)
        )}
      </span>
      <span className="st-row__status">
        <StatusBadge size="M" label={statusName(o)} tone={tone(o.status)} />
        {o.isDelayed && <StatusBadge size="M" label="Delayed" tone="accent" />}
      </span>
      {withAccept && o.status === 'Received' && (
        <span className="st-row__accept">
          <StaffButton small onClick={() => accept(o)} disabled={!online}>
            Accept
          </StaffButton>
        </span>
      )}
    </div>
  )
}

export function OrderQueue() {
  const { orders } = useShared()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'Received') as OrderStatus
  const list = orders
    .filter((o) => o.status === tab)
    // FR-STF-03: New oldest first (fair queue); the rest newest first
    .sort((a, b) => (tab === 'Received' ? a.placedAt - b.placedAt : b.placedAt - a.placedAt))

  return (
    <div className="st-page">
      <h1 className="t-h1">Incoming orders</h1>
      <div className="st-tabs" role="tablist" aria-label="Order status">
        {TABS.map((t) => {
          const n = orders.filter((o) => o.status === t.id).length
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`st-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
            >
              <span className="t-button">{t.label}</span>
              <span className="st-tab__count num">{n}</span>
            </button>
          )
        })}
      </div>
      <div className="st-rows st-rows--queue">
        {list.length === 0 && <p className="t-body muted st-empty">No {TABS.find((t) => t.id === tab)!.label.toLowerCase()} orders.</p>}
        {list.map((o) => (
          <OrderRow key={o.number} o={o} withAccept />
        ))}
      </div>
    </div>
  )
}

/* ---------- A-04 Order detail ---------- */

const REASONS = ['Out of stock', 'Too busy', 'Customer request', 'Payment issue', 'Other']

export function OrderDetail() {
  const { number = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { orders, staff } = useShared()
  const { go, act, now, online } = useStaff()
  const accept = useAccept()
  const o = orders.find((x) => x.number === Number(number))
  const sheet = params.get('sheet')
  const setSheet = (s: string | null) => setParams(s ? { sheet: s } : {}, { replace: true })

  if (!o) {
    return (
      <div className="st-page">
        <h1 className="t-h1">Order not found</h1>
        <StaffButton variant="secondary" onClick={() => go('/staff/orders')}>
          Back to orders
        </StaffButton>
      </div>
    )
  }

  const moves = nextStatuses(o.status)
  const forward = moves.find((s) => s !== 'Cancelled')
  const canCancel = moves.includes('Cancelled')
  const canDelay = o.status === 'Accepted' || o.status === 'Preparing'
  const move = (to: OrderStatus) => {
    if (to === 'Accepted') return accept(o)
    act(() => moveOrder(o.number, to, 'cafe', { actor: staff.name }), `Order #${o.number}: ${stepLabel(o, to)}`)
  }

  return (
    <div className="st-page">
      <button className="st-back t-body-sm" onClick={() => go('/staff/orders')}>
        <Icon name="back" size={20} />
        Orders
      </button>
      <div className="st-detail-head">
        <h1 className="t-h1 num">Order #{o.number}</h1>
        <StatusBadge label={statusName(o)} tone={tone(o.status)} />
        {o.isDelayed && <StatusBadge label="Delayed" tone="accent" />}
        <span className="t-body-sm muted">
          {o.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'} · placed {age(o.placedAt, now)} ago
          {waiting(o, now) ? ' · waiting to be accepted' : ''}
        </span>
      </div>

      {/* Action bar: only the moves Table 3-1 allows from here */}
      {(forward || canCancel) && (
        <section className="st-actions" aria-label="Actions">
          {forward && (
            <div className="st-action">
              <StaffButton onClick={() => move(forward)} disabled={!online}>
                {ACTION[forward](o)}
              </StaffButton>
              <CustomerGets o={o} to={forward} />
            </div>
          )}
          {canDelay && (
            <div className="st-action">
              <StaffButton variant="secondary" icon="clock" onClick={() => setSheet('delay')} disabled={!online}>
                Mark delayed
              </StaffButton>
            </div>
          )}
          {canCancel && (
            <div className="st-action">
              <StaffButton variant="danger" onClick={() => setSheet('cancel')} disabled={!online}>
                Cancel order
              </StaffButton>
            </div>
          )}
        </section>
      )}

      <div className="st-cols">
        {/* What the customer sees */}
        <Panel title="Order">
          <div className="st-lines">
            {o.lines.map((l) => (
              <div key={l.key} className="st-line">
                <span className="t-h3 num">{l.qty}×</span>
                <span className="st-line__text">
                  <span className="t-body">{lineName(l)}</span>
                  {l.options.length > 0 && <span className="t-body-sm muted">{formatOptions(l.options)}</span>}
                  {l.note && <span className="t-body-sm st-line__note">Note: {l.note}</span>}
                </span>
                <span className="t-price num">{peso(l.unitPrice * l.qty)}</span>
              </div>
            ))}
          </div>
          {o.note && (
            <p className="st-customer-note t-body">
              <Icon name="note" size={18} />
              {o.note}
            </p>
          )}
          <PriceBreakdown
            subtotal={o.subtotal}
            discount={o.discount}
            offer={o.offerName ? { name: o.offerName, amount: o.offerDiscount ?? 0, note: o.promoCode ? `Code ${o.promoCode}` : '' } : null}
            reward={o.rewardName ? { name: o.rewardName, amount: o.rewardDiscount ?? 0, items: [] } : null}
            deliveryFee={o.deliveryFee}
          />
          <Fact label={o.fulfillment === 'delivery' ? 'Deliver to' : 'Pickup'}>
            {o.fulfillment === 'delivery' && o.address ? `${o.address.name}, ${o.address.street}` : 'At the counter'}
          </Fact>
          {o.status !== 'Completed' && o.status !== 'Cancelled' && <Fact label="Estimate">{etaLine(o)}</Fact>}
          {o.status === 'Cancelled' && (
            <Fact label="Cancelled">
              {o.cancelledBy === 'customer' ? 'By the customer' : 'By the cafe'}: {o.cancelReason}
            </Fact>
          )}
        </Panel>

        {/* UI-10 / FR-STF-09: never shown to the customer */}
        <StaffOnly>
          <Fact label="Customer">
            {o.customerName} · <span className="num">{o.customerPhone}</span>
          </Fact>
          <Fact label="Payment">
            {o.payment} · <strong>{o.paymentStatus}</strong>
            {o.paymentRef && <span className="num muted"> · {o.paymentRef}</span>}
          </Fact>
          <Fact label="Discounts applied">
            {[
              o.discount ? `Regular −${peso(o.discount)}` : '',
              o.offerName ? `${o.offerName} −${peso(o.offerDiscount ?? 0)}` : '',
              o.rewardName ? `${o.rewardName} −${peso(o.rewardDiscount ?? 0)}` : '',
            ]
              .filter(Boolean)
              .join(' · ') || 'None'}
          </Fact>
          <Fact label="Source">{o.source === 'automated' ? 'Automated order' : 'Customer app'}</Fact>

          <div className="st-subhead">
            <h3 className="t-h3">Internal notes</h3>
            <StaffButton small variant="secondary" icon="plus" onClick={() => setSheet('note')}>
              Add note
            </StaffButton>
          </div>
          {o.internalNotes.length === 0 ? (
            <p className="t-body-sm muted">No notes yet.</p>
          ) : (
            <ul className="st-notes">
              {o.internalNotes.map((n, i) => (
                <li key={i}>
                  <span className="t-body">{n.text}</span>
                  <span className="t-caption muted">
                    {n.author} · {dateTime(n.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="t-h3">Timeline</h3>
          <ol className="st-timeline">
            {o.timeline.map((e, i) => (
              <li key={i}>
                <span className="t-caption num">{clock(e.at)}</span>
                <span className="t-body-sm">
                  {e.label} <span className="muted">· {e.by}</span>
                </span>
              </li>
            ))}
          </ol>
        </StaffOnly>
      </div>

      {sheet === 'cancel' && canCancel && <CancelSheet o={o} onClose={() => setSheet(null)} />}
      {sheet === 'note' && (
        <NoteSheet
          onClose={() => setSheet(null)}
          onSave={(text) => {
            if (act(() => addInternalNote(o.number, text), 'Note saved')) setSheet(null)
          }}
        />
      )}
      {sheet === 'delay' && canDelay && <DelaySheet o={o} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** OA-01 Cancel order: a reason is required, and the customer message is previewed (FR-STF-07) */
function CancelSheet({ o, onClose }: { o: Order; onClose: () => void }) {
  const { act } = useStaff()
  const { staff } = useShared()
  const [reason, setReason] = useState('')
  const [other, setOther] = useState('')
  const text = reason === 'Other' ? other.trim() : reason
  const paidInApp = o.paymentStatus === 'Paid'

  return (
    <Modal
      title={`Cancel order #${o.number}?`}
      tone="danger"
      onClose={onClose}
      actions={
        <>
          <StaffButton
            variant="danger"
            disabled={!text}
            onClick={() => {
              if (act(() => moveOrder(o.number, 'Cancelled', 'cafe', { reason: text, actor: staff.name }), `Order #${o.number} cancelled`))
                onClose()
            }}
          >
            Cancel order
          </StaffButton>
          <StaffButton variant="secondary" onClick={onClose}>
            Keep order
          </StaffButton>
        </>
      }
    >
      <fieldset className="st-reasons">
        <legend className="t-body-sm">Reason (required)</legend>
        {REASONS.map((r) => (
          <label key={r} className={`st-radio ${reason === r ? 'is-on' : ''}`}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span className="t-body">{r}</span>
          </label>
        ))}
        {reason === 'Other' && (
          <input
            className="st-input t-body"
            placeholder="Say why, in a few words"
            value={other}
            maxLength={80}
            onChange={(e) => setOther(e.target.value)}
            aria-label="Other reason"
            autoFocus
          />
        )}
      </fieldset>
      {text && <CustomerGets o={o} to="Cancelled" reason={text} />}
      <p className="t-body-sm muted">
        {paidInApp
          ? `Paid in the app (${o.payment}): a refund starts as soon as you cancel. Both apps show "Refund started".`
          : 'Not paid yet: nothing to refund.'}
        {o.rewardName ? ` The ${o.rewardName} voucher goes back to the customer.` : ''}
      </p>
    </Modal>
  )
}

/** OA-02 Internal note (FR-STF-10) */
function NoteSheet({ onClose, onSave }: { onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Modal
      title="Internal note"
      onClose={onClose}
      actions={
        <>
          <StaffButton disabled={!text.trim()} onClick={() => onSave(text.trim())}>
            Save note
          </StaffButton>
          <StaffButton variant="secondary" onClick={onClose}>
            Cancel
          </StaffButton>
        </>
      }
    >
      <textarea
        className="st-input st-textarea t-body"
        value={text}
        maxLength={280}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Customer called: extra napkins"
        aria-label="Note"
        autoFocus
      />
      <p className="t-caption muted">Saved with your name and the time. Customers never see internal notes.</p>
    </Modal>
  )
}

/** Mark delayed with a new estimate (FR-STF-08) */
function DelaySheet({ o, onClose }: { o: Order; onClose: () => void }) {
  const { act } = useStaff()
  const [mins, setMins] = useState(10)
  const preview = messageFor(getShared(), 'delayed', o, { pickup_time: `${mins} min` })
  return (
    <Modal
      title={`Delay order #${o.number}`}
      onClose={onClose}
      actions={
        <>
          <StaffButton
            disabled={!(mins > 0)}
            onClick={() => {
              if (act(() => markDelayed(o.number, mins), `Order #${o.number} marked delayed`)) onClose()
            }}
          >
            Mark delayed
          </StaffButton>
          <StaffButton variant="secondary" onClick={onClose}>
            Cancel
          </StaffButton>
        </>
      }
    >
      <label className="st-field">
        <span className="t-body-sm">New estimate, in minutes from now</span>
        <input
          className="st-input t-body num"
          type="number"
          min={1}
          max={120}
          value={mins}
          onChange={(e) => setMins(Number(e.target.value))}
        />
      </label>
      <p className="st-gets t-body-sm">
        <span className="muted">Customer gets (push):</span> <em>{preview.body}</em>
      </p>
    </Modal>
  )
}
