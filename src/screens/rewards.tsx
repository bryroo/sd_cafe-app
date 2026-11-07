// Flow 5 — Rewards and promotions (C-20 … C-26)
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BottomNav, Chip, Rail, SectionHeader, Tabs } from '../components/blocks'
import { Alert, OptionRow } from '../components/order'
import { Content, Row, Screen, TopBar } from '../components/Screen'
import { Button, RuleCheck } from '../components/ui'
import { Icon } from '../components/Icon'
import {
  promotionById,
  promotions,
  rewardById,
  rewards,
  nextReward,
  type Activity,
  type Promotion,
  type Reward,
} from '../data/rewards'
import { useOverlay } from '../overlays/OverlayHost'
import { useApp } from '../state/AppState'
import { useShared } from '../state/shared'
import './rewards.css'

const fmt = (n: number) => n.toLocaleString('en-PH')

/** The points ledger (SRS POINTS_TXN), newest first */
function useActivity(): Activity[] {
  const { pointsLog } = useShared()
  const live = pointsLog.map((e) => {
    const d = new Date(e.at)
    return {
      id: e.id,
      description: e.description,
      date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Manila' }),
      month: d.toLocaleDateString('en-PH', { month: 'long', timeZone: 'Asia/Manila' }),
      points: e.points,
    }
  })
  return live
}

/** Progress / Tier */
function TierProgress({ label, value }: { label: string; value: number }) {
  return (
    <div className="tier-progress">
      <span className="t-body-sm">{label}</span>
      <span className="tier-progress__track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${value}%` }} />
      </span>
    </div>
  )
}

type RewardState = 'available' | 'need' | 'redeemed' | 'used' | 'expired'

/** Card / Reward */
function RewardCard({
  reward,
  state,
  points,
  onOpen,
  width,
}: {
  reward: Reward
  state: RewardState
  points: number
  onOpen: () => void
  width?: number
}) {
  const label =
    state === 'available'
      ? 'Available'
      : state === 'need'
        ? `Need ${fmt(reward.cost - points)} more pts`
        : state === 'redeemed'
          ? 'Redeemed'
          : state === 'used'
            ? 'Used'
            : 'Expired'
  return (
    <button className={`reward-card reward-card--${state}`} style={{ width }} onClick={onOpen}>
      <span className="reward-card__cost num">
        {fmt(reward.cost)}
        <span className="t-body-sm"> pts</span>
      </span>
      <span className="t-h3 reward-card__name">{reward.name}</span>
      <span className="reward-card__status t-caption">
        <Icon name={state === 'available' ? 'check' : state === 'need' ? 'lock' : state === 'redeemed' ? 'tag' : 'clock'} size={15} />
        {label}
      </span>
    </button>
  )
}

/** List / Activity */
function ActivityRow({ item }: { item: Activity }) {
  const earned = item.points > 0
  return (
    <div className="activity-row">
      <span className={`activity-row__disc ${earned ? 'is-earned' : ''}`}>
        <Icon name={earned ? 'plus' : 'tag'} size={18} color={earned ? 'var(--ink)' : 'var(--ink)'} />
      </span>
      <span className="activity-row__text">
        <span className="t-body">{item.description}</span>
        <span className="t-caption muted">{item.date}</span>
      </span>
      <span className="activity-row__points">
        <span className={`t-button ${earned ? 'is-earned' : ''}`}>
          {earned ? '+' : '−'}
          {fmt(Math.abs(item.points))} pts
        </span>
        <span className="t-caption muted">{earned ? 'Earned' : 'Redeemed'}</span>
      </span>
    </div>
  )
}

function useRewardState() {
  const { points } = useApp()
  return (r: Reward): RewardState => (r.cost > points ? 'need' : 'available')
}

/** Points needed for the next free-drink milestone (1,400 pts in the Figma copy: 1,240 + 160). */


/** C-20 Rewards */
export function Rewards() {
  const navigate = useNavigate()
  const { points, myRewards } = useApp()
  const recent = useActivity()
  const stateOf = useRewardState()
  const unused = myRewards.filter((r) => r.status === 'Redeemed').length

  return (
    <Screen topBar={<TopBar type="title" title="Rewards" />} bottomNav={<BottomNav active="rewards" />}>
      <Content>
        <Row>
          <div className="card points-card">
            <span className="t-caption muted">Points balance</span>
            <span className="t-display">{fmt(points)}</span>
            <span className="t-body-sm muted">
              {nextReward(points).text}
            </span>
            <TierProgress label="3 more orders to reach Loyal" value={75} />
          </div>
        </Row>
        <Row>
          <div className="card options-card">
            <OptionRow icon="star" label="Your regular status" value="Regular" onClick={() => navigate('/rewards/status')} />
          </div>
        </Row>
        <Row>
          <SectionHeader title="Available rewards" onLink={() => navigate('/rewards/catalog')} />
        </Row>
        <Rail>
          {rewards.slice(0, 3).map((r) => (
            <RewardCard
              key={r.id}
              reward={r}
              state={stateOf(r)}
              points={points}
              // two cards and the edge of a third, so the row reads as one that scrolls
              width={156}
              onOpen={() => navigate(`/rewards/${r.id}`)}
            />
          ))}
        </Rail>
        <Row>
          <div className="card options-card">
            <OptionRow
              icon="tag"
              label="My rewards"
              value={`${unused} unused`}
              onClick={() => navigate('/rewards/catalog?tab=mine')}
            />
            <OptionRow
              icon="receipt"
              label="Offers for you"
              value={`${promotions.filter((p) => p.status === 'Active').length} active`}
              onClick={() => navigate('/promotions')}
            />
          </div>
        </Row>
        <Row>
          <SectionHeader title="Recent activity" onLink={() => navigate('/rewards/activity')} />
        </Row>
        <Row>
          <div className="activity-group">
            {recent.slice(0, 3).map((a) => (
              <ActivityRow key={a.id} item={a} />
            ))}
          </div>
        </Row>
      </Content>
    </Screen>
  )
}

/** C-21 Reward Catalog — Available and My rewards tabs. */
export function RewardCatalog() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'mine' ? 'mine' : 'available'
  const { points, myRewards } = useApp()
  const stateOf = useRewardState()

  return (
    <Screen
      topBar={
        <>
          <TopBar title="Rewards catalog" />
          <div className="tabs--full">
            <Tabs
              items={[
                { id: 'available', label: 'Available' },
                { id: 'mine', label: 'My rewards' },
              ]}
              value={tab}
              onChange={(t) => setParams(t === 'mine' ? { tab: 'mine' } : {}, { replace: true })}
            />
          </div>
        </>
      }
    >
      <Content>
        <Row>
          <div className="reward-grid">
            {tab === 'available'
              ? rewards.map((r) => (
                  <RewardCard
                    key={r.id}
                    reward={r}
                    state={stateOf(r)}
                    points={points}
                    onOpen={() => navigate(`/rewards/${r.id}`)}
                  />
                ))
              : myRewards.map((m) => {
                  const r = rewardById(m.rewardId)!
                  return (
                    <RewardCard
                      key={m.rewardId}
                      reward={r}
                      state={m.status === 'Redeemed' ? 'redeemed' : m.status === 'Used' ? 'used' : 'expired'}
                      points={points}
                      onOpen={() => navigate(`/rewards/${r.id}${m.status === 'Expired' ? '?state=expired' : ''}`)}
                    />
                  )
                })}
          </div>
        </Row>
        {tab === 'mine' && myRewards.length === 0 && (
          <Row>
            <p className="t-body muted">Rewards you redeem show up here.</p>
          </Row>
        )}
      </Content>
    </Screen>
  )
}

/** C-22 Reward Detail — Default, Insufficient, Redeemed, Expired. */
export function RewardDetail() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { points, redeemReward, myRewards } = useApp()
  const reward = rewardById(id)
  const [justRedeemed, setJustRedeemed] = useState(params.get('state') === 'redeemed')
  const [busy, setBusy] = useState(false)

  if (!reward) return <MissingItem title="Reward" />

  const forced = params.get('state')
  // FR-LOY-06: a reward already redeemed and not yet used can't be redeemed again
  const holds = myRewards.some((m) => m.rewardId === reward.id && m.status === 'Redeemed')
  const state: 'default' | 'insufficient' | 'redeemed' | 'expired' = justRedeemed || holds
    ? 'redeemed'
    : forced === 'expired'
      ? 'expired'
      : forced === 'insufficient' || reward.cost > points
        ? 'insufficient'
        : 'default'

  const redeem = async () => {
    const ok = await overlay.confirm('redeem', { name: reward.name, cost: reward.cost, balance: points })
    if (!ok) return
    // FR-LOY-05: points out and voucher in, in one database transaction
    setBusy(true)
    try {
      await redeemReward(reward.id, reward.cost)
      setJustRedeemed(true)
    } catch (err) {
      // 3.2.7.5: a failed or repeated redemption spends nothing
      const msg = err instanceof Error ? err.message : ''
      overlay.toast(/already have/i.test(msg) ? msg : "Couldn't redeem. Your points were not spent.")
    } finally {
      setBusy(false)
    }
  }

  const need = Math.max(0, reward.cost - points)

  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Reward" />}
      footer={
        state === 'redeemed' ? (
          <Button onClick={() => navigate('/menu')}>Use it on your next order</Button>
        ) : (
          <Button disabled={state !== 'default' || busy} onClick={redeem} aria-busy={busy}>
            Redeem · {fmt(reward.cost)} pts
          </Button>
        )
      }
    >
      <div className="content detail-content">
        <Row>
          <header className={`board ${state === 'expired' ? 'board--dim' : ''}`}>
            <span className="board__figure num">
              {fmt(reward.cost)}
              <span className="t-h3"> pts</span>
            </span>
            <h2 className="t-display">{reward.name}</h2>
          </header>
        </Row>
        {state === 'insufficient' && (
          <Row>
            <Alert tone="info">You need {fmt(need)} more points to redeem this reward.</Alert>
          </Row>
        )}
        {state === 'expired' && (
          <Row>
            <Alert tone="warning">This reward has expired.</Alert>
          </Row>
        )}
        {state === 'redeemed' && (
          <>
            <Row>
              <Alert tone="success">Added to your rewards</Alert>
            </Row>
            <Row>
              <p className="t-body-sm muted">Balance: {fmt(points)} pts</p>
            </Row>
          </>
        )}
        <Row>
          <Terms items={reward.terms} />
        </Row>
      </div>
    </Screen>
  )
}

function Terms({ items }: { items: string[] }) {
  return (
    <div className="terms">
      <h2 className="t-h3">Terms</h2>
      {items.map((t) => (
        <p key={t} className="terms__item t-body-sm muted">
          <Icon name="check" size={16} color="var(--muted)" />
          {t}
        </p>
      ))}
    </div>
  )
}

function MissingItem({ title }: { title: string }) {
  return (
    <Screen topBar={<TopBar title={title} />}>
      <Content>
        <Row>
          <p className="t-body muted">This item is no longer available.</p>
        </Row>
      </Content>
    </Screen>
  )
}

/** C-23 Points Activity — All / Earned / Redeemed chips, grouped by month. */
export function PointsActivity() {
  const [filter, setFilter] = useState<'All' | 'Earned' | 'Redeemed'>('All')
  const all = useActivity()
  const items = all.filter(
    (a) => filter === 'All' || (filter === 'Earned' ? a.points > 0 : a.points < 0),
  )
  const months = [...new Set(items.map((a) => a.month))]

  return (
    <Screen topBar={<TopBar title="Points activity" />}>
      <Content>
        <Row>
          <div className="chip-row">
            {(['All', 'Earned', 'Redeemed'] as const).map((f) => (
              <Chip key={f} label={f} selected={filter === f} onClick={() => setFilter(f)} />
            ))}
          </div>
        </Row>
        {months.map((m) => (
          <Row key={m}>
            <div className="activity-group">
              <h2 className="t-h3">{m}</h2>
              {items
                .filter((a) => a.month === m)
                .map((a) => (
                  <ActivityRow key={a.id} item={a} />
                ))}
            </div>
          </Row>
        ))}
      </Content>
    </Screen>
  )
}

/** C-24 Regular Status */
export function RegularStatus() {
  const navigate = useNavigate()
  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Regular status" />}
      footer={<Button onClick={() => navigate('/menu')}>Order now</Button>}
    >
      <Content>
        <Row>
          <div className="card tier-card">
            <span className="tier-badge t-caption">Regular</span>
            <span className="t-h1">5% off</span>
            <span className="t-body-sm muted">Applied automatically at checkout</span>
            <TierProgress label="3 more orders to reach Loyal" value={50} />
          </div>
        </Row>
        <Row>
          <TierProgress label="3 more orders in 30 days to reach Loyal" value={50} />
        </Row>
        <Row>
          <div className="how-it-works">
            <h2 className="t-h3">How it works</h2>
            <RuleCheck label="Order 5 times in 30 days to become Loyal" met />
            <RuleCheck label="Loyal members get 10% off every order" met={false} pendingLabel="Not yet" />
            <RuleCheck label="Stay Loyal by ordering at least 3 times a month" met={false} pendingLabel="Not yet" />
          </div>
        </Row>
      </Content>
    </Screen>
  )
}

/** Card / Promo */
function PromoCard({ promo, onOpen }: { promo: Promotion; onOpen: () => void }) {
  const past = promo.status !== 'Active'
  return (
    <button className={`promo-card ${past ? 'is-past' : ''}`} onClick={onOpen}>
      <span className="promo-card__text">
        <span className="t-button promo-card__title">{promo.title}</span>
        <span className="t-caption muted">{promo.validity}</span>
        {past && (
          <span className="promo-card__status t-caption">
            <Icon name="clock" size={16} color="var(--muted)" />
            {promo.status}
          </span>
        )}
      </span>
      <Icon name="chevron" size={20} color="var(--muted)" />
    </button>
  )
}

/** C-25 Promotions — Active and Past tabs. */
export function Promotions() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'past' ? 'past' : 'active'
  const list = promotions.filter((p) => (tab === 'active' ? p.status === 'Active' : p.status !== 'Active'))

  return (
    <Screen
      topBar={
        <>
          <TopBar title="Promotions" />
          <div className="tabs--full">
            <Tabs
              items={[
                { id: 'active', label: 'Active' },
                { id: 'past', label: 'Past' },
              ]}
              value={tab}
              onChange={(t) => setParams(t === 'past' ? { tab: 'past' } : {}, { replace: true })}
            />
          </div>
        </>
      }
    >
      <Content>
        {list.map((p) => (
          <Row key={p.id}>
            <PromoCard promo={p} onOpen={() => navigate(`/promotions/${p.id}`)} />
          </Row>
        ))}
      </Content>
    </Screen>
  )
}

/** C-26 Promotion Detail — Default, Expired, Used. */
export function PromotionDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const promo = promotionById(id)
  if (!promo) return <MissingItem title="Offer" />

  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Offer" />}
      footer={
        promo.status === 'Expired' ? (
          <Button onClick={() => navigate('/promotions', { replace: true })}>See current offers</Button>
        ) : (
          <Button
            disabled={promo.status === 'Used'}
            onClick={() => navigate(promo.section ? `/menu?section=${promo.section}` : '/menu')}
          >
            Order now
          </Button>
        )
      }
    >
      <div className="content detail-content">
        <Row>
          <header className={`board ${promo.status === 'Active' ? '' : 'board--dim'}`}>
            <h2 className="t-display board__title">{promo.title}</h2>
            <span className="validity t-body-sm">
              <Icon name={promo.status === 'Used' ? 'check' : 'clock'} size={16} />
              {promo.validity}
            </span>
            <p className="t-body board__text">{promo.description}</p>
          </header>
        </Row>
        {promo.status === 'Expired' && (
          <Row>
            <Alert tone="info">This offer has ended.</Alert>
          </Row>
        )}
        {promo.status === 'Used' && (
          <Row>
            <Alert tone="info">You've used this offer.</Alert>
          </Row>
        )}
        <Row>
          <Terms items={promo.terms} />
        </Row>
      </div>
    </Screen>
  )
}
