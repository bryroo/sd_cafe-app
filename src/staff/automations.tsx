// Automated order monitoring (SRS 3.2.12): A-05 list, A-06 detail, OA-05 Retry.
import { useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/order'
import { productById } from '../data/menu'
import type { Automation, AutomationState } from '../data/automations'
import { clock, convertAutomation, runAutomation, simulateAutomation, useShared } from '../state/shared'
import { Fact, Metric, Modal, Panel, StaffButton, StaffOnly, useStaff } from './kit'

const STATE_LABEL: Record<AutomationState, string> = {
  queued: 'Queued',
  processing: 'Processing',
  succeeded: 'Succeeded',
  failed: 'Failed',
}
const stateTone = (a: Automation) =>
  a.handled ? 'dark' : a.state === 'failed' ? 'error' : a.state === 'succeeded' ? 'success' : a.state === 'processing' ? 'accent' : 'muted'
const stateLabel = (a: Automation) => (a.handled ? 'Handled manually' : STATE_LABEL[a.state])

const summary = (a: Automation) =>
  a.lines.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${productById(l.productId)?.name ?? l.productId}`).join(', ')

const isToday = (at: number) => {
  const d = (t: number) => new Date(t).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })
  return d(at) === d(Date.now())
}

const FILTERS: ('all' | AutomationState)[] = ['all', 'failed', 'queued', 'processing', 'succeeded']

/* ---------- A-05 Automated orders ---------- */

export function Automations() {
  const { automations } = useShared()
  const [params, setParams] = useSearchParams()
  const { go, act } = useStaff()
  const filter = (FILTERS.find((f) => f === params.get('filter')) ?? 'all') as (typeof FILTERS)[number]
  const open = (a: Automation) => a.state === 'failed' && !a.handled
  const list = automations
    .filter((a) => filter === 'all' || a.state === filter)
    // FR-AOM-02: failures that still need someone are pinned to the top
    .sort((a, b) => Number(open(b)) - Number(open(a)) || b.at - a.at)

  return (
    <div className="st-page">
      <div className="st-page__head">
        <h1 className="t-h1">Automated orders</h1>
        <StaffButton variant="secondary" icon="repeat" onClick={() => act(() => simulateAutomation(), 'A standing rule fired')}>
          Simulate automated order
        </StaffButton>
      </div>
      <div className="st-metrics">
        <Metric label="Queued" value={automations.filter((a) => a.state === 'queued').length} icon="clock" />
        <Metric label="Processing" value={automations.filter((a) => a.state === 'processing').length} icon="repeat" />
        <Metric label="Succeeded today" value={automations.filter((a) => a.state === 'succeeded' && isToday(a.at)).length} icon="check" />
        <Metric label="Failed today" value={automations.filter((a) => a.state === 'failed' && isToday(a.at)).length} icon="alert" alert />
      </div>
      <div className="st-chips" role="group" aria-label="Filter by state">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`st-chip t-button ${filter === f ? 'is-active' : ''}`}
            aria-pressed={filter === f}
            onClick={() => setParams(f === 'all' ? {} : { filter: f }, { replace: true })}
          >
            {f === 'all' ? 'All' : STATE_LABEL[f]}
          </button>
        ))}
      </div>
      <div className="st-rows">
        {list.length === 0 && <p className="t-body muted st-empty">Nothing here.</p>}
        {list.map((a) => (
          <div key={a.id} className={`st-row st-auto ${open(a) ? 'is-failed' : ''}`}>
            <button className="st-row__hit" onClick={() => go(`/staff/automations/${a.id}`)} aria-label={`${a.customer}, ${a.rule}`} />
            <span className="st-row__num t-body-sm num">{clock(a.at)}</span>
            <span className="st-row__who">
              <span className="t-body">
                {open(a) && <Icon name="alert" size={18} color="var(--negative)" />} {a.customer}
              </span>
              <span className="t-body-sm muted">{summary(a)}</span>
              {open(a) && <span className="t-body-sm st-auto__reason">{a.reason}</span>}
            </span>
            <span className="st-row__mode t-body-sm muted">{a.rule}</span>
            <span className="st-row__status">
              <StatusBadge size="M" label={stateLabel(a)} tone={stateTone(a)} />
            </span>
            <span className="st-row__age t-body-sm num">
              {a.orderNumber ? (
                <button className="link-text t-body-sm st-row__link" onClick={() => go(`/staff/orders/${a.orderNumber}`)}>
                  Order #{a.orderNumber}
                </button>
              ) : (
                <span className="muted">No order</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- A-06 Automated order detail ---------- */

export function AutomationDetail() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { automations } = useShared()
  const { go, act, online } = useStaff()
  const a = automations.find((x) => x.id === id)
  const sheet = params.get('sheet')

  if (!a) {
    return (
      <div className="st-page">
        <h1 className="t-h1">Automated order not found</h1>
        <StaffButton variant="secondary" onClick={() => go('/staff/automations')}>
          Back
        </StaffButton>
      </div>
    )
  }

  const failed = a.state === 'failed' && !a.handled

  return (
    <div className="st-page">
      <button className="st-back t-body-sm" onClick={() => go('/staff/automations')}>
        <Icon name="back" size={20} />
        Automated orders
      </button>
      <div className="st-detail-head">
        <h1 className="t-h1">{a.customer}</h1>
        <StatusBadge label={stateLabel(a)} tone={stateTone(a)} />
        <span className="t-body-sm muted">
          {a.rule} · {clock(a.at)}
        </span>
      </div>

      {failed && (
        <section className="st-actions" aria-label="Actions">
          <div className="st-action">
            <StaffButton icon="refresh" onClick={() => setParams({ sheet: 'retry' }, { replace: true })} disabled={!online}>
              Retry
            </StaffButton>
          </div>
          <div className="st-action">
            <StaffButton
              variant="secondary"
              disabled={!online}
              onClick={() => act(() => convertAutomation(a.id), 'Converted to a manual order')}
            >
              Convert to manual order
            </StaffButton>
          </div>
        </section>
      )}

      <div className="st-cols">
        <Panel title="Order">
          <Fact label="Items">{summary(a)}</Fact>
          <Fact label="Fulfillment">{a.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}</Fact>
          <Fact label="Customer message">{a.customerMessage ?? 'None sent yet'}</Fact>
          {a.orderNumber && (
            // FR-AOM-05: a succeeded automation links to the order it made
            <Fact label="Created order">
              <button className="link-text t-body" onClick={() => go(`/staff/orders/${a.orderNumber}`)}>
                Order #{a.orderNumber}
              </button>
            </Fact>
          )}
        </Panel>
        <StaffOnly>
          <Fact label="Customer">
            {a.customer} · <span className="num">{a.phone}</span>
          </Fact>
          <h3 className="t-h3">System response</h3>
          {a.response ? (
            <pre className="st-code" aria-label="System response, read only">
              {a.response.message}
              {'\n'}code: {a.response.code}
            </pre>
          ) : (
            <p className="t-body-sm muted">No errors.</p>
          )}
          <h3 className="t-h3">Processing timeline</h3>
          <ol className="st-timeline">
            {a.timeline.map((e, i) => (
              <li key={i}>
                <span className="t-caption num">{clock(e.at)}</span>
                <span className="t-body-sm">{e.label}</span>
              </li>
            ))}
          </ol>
        </StaffOnly>
      </div>

      {/* OA-05 Retry: shows why it failed before running the checks again */}
      {sheet === 'retry' && failed && (
        <Modal
          title="Retry this automated order?"
          onClose={() => setParams({}, { replace: true })}
          actions={
            <>
              <StaffButton
                onClick={() => {
                  setParams({}, { replace: true })
                  act(() => runAutomation(a.id))
                }}
              >
                Retry now
              </StaffButton>
              <StaffButton variant="secondary" onClick={() => setParams({}, { replace: true })}>
                Cancel
              </StaffButton>
            </>
          }
        >
          <p className="t-body">
            It failed because: <strong>{a.reason}</strong> ({a.response?.code}).
          </p>
          <p className="t-body-sm muted">
            Retry checks again that every item is available and the cafe is accepting orders. If they pass, a new order goes
            into the queue; if not, it stays failed with the new reason.
          </p>
        </Modal>
      )}
    </div>
  )
}
