// Flow 6 — Profile and settings (C-27 … C-31)
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BottomNav, CardSkeleton, CountBadge, EmptyState, Radio } from '../components/blocks'
import { AddressCard, Alert } from '../components/order'
import { Content, Row, Screen, TopBar } from '../components/Screen'
import { Button, Checkbox, LogoMark, TextField, Toggle } from '../components/ui'
import { Icon, type IconName } from '../components/Icon'

/** One plain outline icon per settings row, by what the row opens. */
const rowIcons: Record<string, IconName> = {
  'Edit profile': 'user',
  'Payment methods': 'card',
  'Saved addresses': 'pin',
  'Order history': 'receipt',
  'Points activity': 'star',
  'Regular status': 'tag',
  Notifications: 'bell',
  Settings: 'sliders',
  'Help and support': 'help',
  "About MEGS' Cafe": 'info',
  'Log out': 'logout',
  Language: 'globe',
  'Install app': 'phone',
  Privacy: 'lock',
  'Delete account': 'trash',
  'Reset demo data': 'refresh',
  'Exit guest mode': 'logout',
  'E-wallet': 'phone',
  'Pay at counter': 'store',
}
import { useOverlay } from '../overlays/OverlayHost'
import { DRINK_SIZES, resetDemo, useApp } from '../state/AppState'
import { customerDataExport, markNoteRead, saveProfile, useShared, type CustomerNote } from '../state/shared'
import { isIos, promptInstall, usePwa } from '../state/pwa'
import { useValidation } from '../state/forms'
import { useDarkMode, useTheme, type ThemePref } from '../state/theme'
import './profile.css'

/** Row / Settings — icon, label, optional value, chevron. Renders as a button only when it does something. */
function SettingsRow({
  label,
  value,
  onClick,
  danger,
  chevron = true,
  badge,
}: {
  label: string
  value?: string
  onClick?: () => void
  danger?: boolean
  chevron?: boolean
  /** A count after the label (unread notifications) */
  badge?: number
}) {
  const content = (
    <>
      <Icon name={rowIcons[label] ?? 'card'} size={20} color={danger ? 'var(--negative)' : 'var(--muted)'} />
      <span className="t-body option-row__label">{label}</span>
      {!!badge && <CountBadge count={badge} label={`${badge} unread`} />}
      {value && <span className="t-body-sm muted option-row__value">{value}</span>}
      {chevron && !danger && <Icon name="chevron" size={20} color="var(--muted)" />}
    </>
  )
  const cls = `option-row ${danger ? 'option-row--danger' : ''}`
  return onClick ? (
    <button className={cls} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  )
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <>
      {title && (
        <Row>
          <p className="t-caption muted">{title}</p>
        </Row>
      )}
      <Row>
        <div className="card options-card">{children}</div>
      </Row>
    </>
  )
}

/** Profile → Display: a quick light/dark switch for this device (Settings keeps "Same as this device") */
function DarkModeSwitch() {
  const [dark, setDark] = useDarkMode()
  return (
    <>
      <Row>
        <p className="t-caption muted">Display</p>
      </Row>
      <Row>
        <div className="card toggles-card">
          <Toggle label="Dark mode" description="On this device" on={dark} onChange={setDark} />
        </div>
      </Row>
    </>
  )
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

/** C-27 Profile */
export function Profile() {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { name, session, setSession } = useApp()
  const { notifications } = useShared()
  const unread = notifications.filter((n) => !n.read).length

  if (session !== 'member') {
    return (
      <Screen topBar={<TopBar type="title" title="Profile" />} bottomNav={<BottomNav active="profile" />}>
        <div className="guest-profile">
          <LogoMark size={48} />
          <h2 className="t-h2">Log in to see your profile</h2>
          <p className="t-body muted">Track orders, earn points and save your favourite drinks.</p>
          <Button onClick={() => navigate('/log-in')}>Log in</Button>
          <Button variant="secondary" onClick={() => navigate('/sign-up')}>
            Create account
          </Button>
        </div>
        <Content>
          <DarkModeSwitch />
          <Group title="Help">
            <SettingsRow label="Help and support" onClick={() => overlay.open('help')} />
            <SettingsRow label="About MEGS' Cafe" onClick={() => overlay.open('about')} />
          </Group>
          {/* Browsing as a guest is a mode, so it needs a way out: back to Welcome */}
          <Group>
            <SettingsRow
              label="Exit guest mode"
              onClick={() => {
                setSession('signed-out')
                navigate('/welcome', { replace: true })
              }}
            />
          </Group>
        </Content>
      </Screen>
    )
  }

  return (
    <Screen topBar={<TopBar type="title" title="Profile" />} bottomNav={<BottomNav active="profile" />}>
      <Content>
        <Row>
          <div className="identity">
            <span className="avatar t-h2">{initials(name)}</span>
            <span className="identity__name">
              <span className="t-h2">{name}</span>
              <span className="tier-pill t-caption">
                <Icon name="star" size={15} color="var(--gold-ink)" />
                Regular
              </span>
            </span>
          </div>
        </Row>
        <Group title="Account">
          <SettingsRow label="Edit profile" onClick={() => navigate('/profile/edit')} />
          <SettingsRow label="Payment methods" onClick={() => navigate('/profile/payment')} />
          <SettingsRow label="Saved addresses" onClick={() => navigate('/profile/addresses')} />
        </Group>
        {/* Orders, points and status live in their own tabs; Profile holds only what has no tab */}
        <Group title="Inbox">
          <SettingsRow label="Notifications" badge={unread} onClick={() => navigate('/notifications')} />
        </Group>
        <DarkModeSwitch />
        <Group title="App">
          <SettingsRow label="Settings" onClick={() => navigate('/settings')} />
          <SettingsRow label="Privacy" onClick={() => navigate('/settings/privacy')} />
        </Group>
        <Group title="Help">
          <SettingsRow label="Help and support" onClick={() => overlay.open('help')} />
          <SettingsRow label="About MEGS' Cafe" onClick={() => overlay.open('about')} />
        </Group>
        <Group>
          <SettingsRow label="Log out" danger onClick={() => overlay.open('logout')} />
        </Group>
      </Content>
    </Screen>
  )
}

/** C-28 Edit Profile — Default and Saved. */
export function EditProfile() {
  const [params] = useSearchParams()
  const { name, phone, defaultSize } = useApp()
  const { customer } = useShared()
  const [draft, setDraft] = useState(name)
  const [email, setEmail] = useState(customer?.email ?? '')
  const [birthday, setBirthday] = useState(customer?.birthday ?? '')
  const [size, setSize] = useState(defaultSize)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const overlay = useOverlay()

  // `?state=saved` (screen index): show the saved confirmation
  useEffect(() => {
    if (params.get('state') === 'saved') overlay.toast('Profile saved')
  }, [params, overlay])

  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Edit profile" />}
      footer={
        <Button
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            if (!draft.trim()) {
              setNameError('Enter your name.')
              nameRef.current?.focus()
              return
            }
            // FR-PRF-02 / 3.2.10.5: a failed save keeps the edited values and says so
            setBusy(true)
            setError('')
            try {
              await saveProfile({
                full_name: draft.trim(),
                email: email.trim() || null,
                birthday: birthday || null,
                default_drink_size: size || null,
              })
              overlay.toast('Profile saved')
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't save. Try again.")
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <Content>
        {error && (
          <Row>
            <Alert tone="danger">{/duplicate|unique/i.test(error) ? 'That email is already used by another account.' : error}</Alert>
          </Row>
        )}
        <Row>
          <TextField
            ref={nameRef}
            label="Name"
            value={draft}
            error={nameError}
            onChange={(e) => {
              setDraft(e.target.value)
              setNameError('')
            }}
            onBlur={() => !draft.trim() && setNameError('Enter your name.')}
            autoComplete="name"
          />
        </Row>
        <Row>
          <TextField label="Mobile number" helper="Verified" value={phone} readOnly className="t-body is-readonly" />
        </Row>
        <Row>
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Row>
        <Row>
          <TextField
            label="Birthday (optional)"
            type="date"
            helper="Used for birthday offers"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
          />
        </Row>
        <Row>
          <p className="t-caption muted">Saved preferences</p>
        </Row>
        <Row>
          {/* FR-CRT-05 / FR-PRF-02: preselected on product pages when the drink comes in this size */}
          <div className="field">
            <label htmlFor="f-default-size" className="t-body-sm">
              Default drink size
            </label>
            <div className="field__input field__input--select">
              <select id="f-default-size" className="t-body" value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="">No preference</option>
                {DRINK_SIZES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={20} color="var(--muted)" style={{ transform: 'rotate(90deg)' }} />
            </div>
            <p className="t-caption muted">Picked for you on drinks that come in this size</p>
          </div>
        </Row>
      </Content>
    </Screen>
  )
}

/** Notification permission as the phone reports it ("denied" = turned off in phone settings) */
const permission = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

/** C-29 Settings */
export function Settings() {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { notificationsOn, setNotificationsOn, promoConsent, setPromoConsent, remindersOn, setRemindersOn } = useApp()
  const denied = permission() === 'denied'
  const [howTo, setHowTo] = useState(false)
  const [theme, setTheme] = useTheme()
  // Install to the home screen: the browser's dialog where there is one, Safari's steps on iPhone
  const pwa = usePwa()
  const [iosSteps, setIosSteps] = useState(false)
  const offerInstall = !pwa.installed && (pwa.canInstall || isIos())
  const install = async () => {
    if (!pwa.canInstall) {
      setIosSteps((v) => !v)
      return
    }
    if ((await promptInstall()) === 'accepted') overlay.toast("MEGS' Cafe is on your home screen")
  }

  // FR-PRF-05: each toggle saves at once; turning order updates on asks the phone for permission
  const setOrderUpdates = async (v: boolean) => {
    setNotificationsOn(v)
    if (v && permission() === 'default') {
      try {
        await Notification.requestPermission()
      } catch {
        /* the phone said no or can't ask: in-app updates still arrive */
      }
    }
  }

  return (
    <Screen topBar={<TopBar title="Settings" />}>
      <Content>
        <Row>
          <p className="t-caption muted">Notifications</p>
        </Row>
        {denied && (
          <Row>
            <Alert
              tone="warning"
              action={
                <button className="t-body-sm link-text" onClick={() => setHowTo((v) => !v)}>
                  Open settings
                </button>
              }
            >
              Turned off in phone settings. You still see updates in the app, and tracking keeps syncing.
            </Alert>
          </Row>
        )}
        {denied && howTo && (
          <Row>
            <p className="t-body-sm muted">
              To turn them back on, open your phone's Settings, find MEGS' Cafe (or your browser), choose Notifications
              and allow them. Then come back here.
            </p>
          </Row>
        )}
        <Row>
          <div className="card toggles-card">
            <Toggle
              label="Order updates"
              description={denied ? 'Turned off in phone settings' : 'Status changes for your orders'}
              on={notificationsOn && !denied}
              onChange={setOrderUpdates}
              disabled={denied}
            />
            <Toggle
              label="Promotions"
              description={denied ? 'Turned off in phone settings' : 'Offers and new items'}
              on={promoConsent && !denied}
              onChange={setPromoConsent}
              disabled={denied}
            />
            <Toggle
              label="Rewards reminders"
              description={denied ? 'Turned off in phone settings' : 'Points and rewards nearing expiry'}
              on={remindersOn && !denied}
              onChange={setRemindersOn}
              disabled={denied}
            />
          </div>
        </Row>
        <Row>
          <p className="t-caption muted" id="appearance-title">
            Appearance
          </p>
        </Row>
        <Row>
          <div className="card appearance-card" role="radiogroup" aria-labelledby="appearance-title">
            {(
              [
                ['system', 'Same as this device'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ] as [ThemePref, string][]
            ).map(([id, label]) => (
              <Radio key={id} name="appearance" label={label} checked={theme === id} onChange={() => setTheme(id)} />
            ))}
          </div>
        </Row>
        <Group title="General">
          <SettingsRow label="Language" value="English" chevron={false} />
          <SettingsRow label="Privacy" onClick={() => navigate('/settings/privacy')} />
          {offerInstall && <SettingsRow label="Install app" value="Works offline" onClick={install} />}
        </Group>
        {offerInstall && iosSteps && (
          <Row>
            <p className="t-body-sm muted" role="status">
              In Safari, tap Share at the bottom of the screen, then Add to Home Screen. MEGS' Cafe then opens full
              screen from your home screen and works offline.
            </p>
          </Row>
        )}
        <Group title="Demo">
          <SettingsRow
            label="Reset demo data"
            value="Clears this device"
            onClick={async () => {
              if (await overlay.confirm('reset-demo')) resetDemo()
            }}
          />
        </Group>
      </Content>
    </Screen>
  )
}

/** C-34 Privacy (FR-PRF-06, NFR-SEC-07): the notice, consent for promotional messages, a copy of your data */
export function Privacy() {
  const overlay = useOverlay()
  const { promoConsent, setPromoConsent } = useApp()

  const download = () => {
    const blob = new Blob([JSON.stringify(customerDataExport(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'megs-cafe-my-data.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <Screen topBar={<TopBar title="Privacy" />}>
      <Content>
        <Row>
          <div className="privacy-notice">
            <h2 className="t-h3">What we keep and why</h2>
            <p className="t-body">
              MEGS' Cafe keeps your name, mobile number and email to run your account, your orders and saved addresses to
              prepare and deliver them, and your points and rewards so you can use them.
            </p>
            <p className="t-body">
              We never keep card numbers: cards are held by the payment provider. We use your data only for your orders and,
              if you agree below, for offers. We don't sell it.
            </p>
            <p className="t-body">
              Under the Data Privacy Act of 2012 (Republic Act No. 10173) you can see the data we hold, have it corrected,
              withdraw consent and ask us to delete it. Ask at the counter or use the options below.
            </p>
          </div>
        </Row>
        <Row>
          <div className="card toggles-card">
            <Toggle
              label="Promotional messages"
              description="Offers and new items, by notification. Off unless you turn it on."
              on={promoConsent}
              onChange={setPromoConsent}
            />
          </div>
        </Row>
        <Row>
          <h2 className="t-h3">Your data</h2>
        </Row>
        <Row>
          <Button variant="secondary" onClick={download}>
            Download my data
          </Button>
        </Row>
        <Group>
          <SettingsRow label="Delete account" danger onClick={() => overlay.open('delete-account')} />
        </Group>
      </Content>
    </Screen>
  )
}

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m} min ago`
  if (m < 24 * 60) return `${Math.round(m / 60)} hr ago`
  if (m < 48 * 60) return 'Yesterday'
  return new Date(at).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', timeZone: 'Asia/Manila' })
}

const isToday = (at: number) => {
  const d = (t: number) => new Date(t).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })
  return d(at) === d(Date.now())
}

/** C-30 Notifications — FR-TRK-07: Today and Earlier, unread marked by a dot, bold title and "Unread" */
export function Notifications() {
  const navigate = useNavigate()
  const { notifications, ready } = useShared()
  const sorted = [...notifications].sort((a, b) => b.at - a.at)
  const unread = notifications.filter((n) => !n.read)
  const overlay = useOverlay()
  // The same per-message update as opening one, for each unread message
  const markAll = async () => {
    await Promise.all(unread.map((n) => markNoteRead(n.id)))
    overlay.toast('All caught up')
  }

  const open = (n: CustomerNote) => {
    markNoteRead(n.id)
    navigate(n.to)
  }

  return (
    <Screen
      topBar={
        <TopBar
          title="Notifications"
          actions={
            unread.length > 0 && (
              <Button variant="text" height={48} full={false} onClick={markAll}>
                Mark all read
              </Button>
            )
          }
        />
      }
    >
      <Content>
        {/* First load: card outlines instead of a false "No notifications yet" */}
        {!ready &&
          sorted.length === 0 &&
          [0, 1, 2].map((i) => (
            <Row key={i}>
              <CardSkeleton lines={2} />
            </Row>
          ))}
        {ready && sorted.length === 0 && (
          <EmptyState illustration="bell" title="No notifications yet">
            Order updates and offers show up here.
          </EmptyState>
        )}
        {(['Today', 'Earlier'] as const).map((day) => {
          const items = sorted.filter((n) => isToday(n.at) === (day === 'Today'))
          if (!items.length) return null
          return (
            <div key={day} className="notes-group">
              <Row>
                <p className="t-caption muted">{day}</p>
              </Row>
              <Row>
                <div className="card notes-card">
                  {items.map((n) => {
                    const unread = !n.read
                    return (
                      <button key={n.id} className="note" onClick={() => open(n)}>
                        <span className={`note__dot ${unread ? 'is-unread' : ''}`} />
                        <span className="note__text">
                          <span className="note__head">
                            <span className={unread ? 't-h3' : 't-body'}>{n.title}</span>
                            {unread && <span className="t-caption note__unread">Unread</span>}
                          </span>
                          <span className="t-body-sm muted">{n.body}</span>
                          <span className="t-caption muted">{ago(n.at)}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </Row>
            </div>
          )
        })}
      </Content>
    </Screen>
  )
}

/** C-31 Payment Methods */
export function PaymentMethods() {
  const navigate = useNavigate()
  const { paymentMethods } = useApp()
  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Payment methods" />}
      footer={
        <Button variant="secondary" onClick={() => navigate('/profile/payment/add')}>
          Add payment method
        </Button>
      }
    >
      <Content>
        <Group>
          {paymentMethods.map((m) => (
            <SettingsRow key={m.label} label={m.label} value={m.status} chevron={m.label !== 'Pay at counter'} />
          ))}
        </Group>
      </Content>
    </Screen>
  )
}

/** C-31 Add Payment Method — placeholder form (to be replaced by the payment provider SDK). */
export function AddPaymentMethod() {
  const navigate = useNavigate()
  const { addPaymentMethod } = useApp()
  const [number, setNumber] = useState('')
  const [holder, setHolder] = useState('')
  const [expiry, setExpiry] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const digits = number.replace(/\D/g, '')
  const v = useValidation(
    {
      number: digits.length >= 12 ? undefined : 'Enter the full card number (12 or more digits).',
      holder: holder.trim() ? undefined : 'Enter the name as it appears on the card.',
      expiry: /^\d{2}\s*\/\s*\d{2}$/.test(expiry.trim()) ? undefined : 'Enter the expiry as MM / YY, like 08 / 28.',
    },
    (k) => `pm-${k}`,
  )

  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Add payment method" />}
      footer={
        <Button
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            if (!v.check()) return
            // NFR-SEC-03 / IR-01: only the last four digits and a token are kept, never the card number
            setBusy(true)
            setError('')
            try {
              await addPaymentMethod({ label: `Card ending ${digits.slice(-4)}` }, makeDefault)
              navigate(-1)
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't save the card. Try again.")
              setBusy(false)
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <Content>
        <Row>
          <Alert>Placeholder form. To be replaced by the payment provider SDK.</Alert>
        </Row>
        {error && (
          <Row>
            <Alert tone="danger">{error}</Alert>
          </Row>
        )}
        <Row>
          <p className="t-body-sm muted">
            Demo test cards: a number ending <span className="num">0002</span> is always declined; one ending{' '}
            <span className="num">0119</span> is charged, then placing the order fails once (Retry is safe).
          </p>
        </Row>
        <Row>
          <TextField
            id="pm-number"
            label="Card number"
            placeholder="1234 5678 9012 3456"
            inputMode="numeric"
            autoComplete="off"
            value={number}
            error={v.err('number')}
            onBlur={() => v.touch('number')}
            onChange={(e) => setNumber(e.target.value)}
          />
        </Row>
        <Row>
          <TextField
            id="pm-holder"
            label="Name on card"
            placeholder="Maria Santos"
            autoComplete="off"
            value={holder}
            error={v.err('holder')}
            onBlur={() => v.touch('holder')}
            onChange={(e) => setHolder(e.target.value)}
          />
        </Row>
        <Row>
          <TextField
            id="pm-expiry"
            label="Expiry"
            placeholder="MM / YY"
            helper="Month and year, like 08 / 28"
            inputMode="numeric"
            autoComplete="off"
            value={expiry}
            error={v.err('expiry')}
            onBlur={() => v.touch('expiry')}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </Row>
        <Row>
          <Checkbox label="Make this my default" checked={makeDefault} onChange={setMakeDefault} />
        </Row>
      </Content>
    </Screen>
  )
}

/** Saved addresses (linked from Profile; not drawn in Figma — reuses the address cards from C-32). */
export function SavedAddresses() {
  const navigate = useNavigate()
  const { addresses, addressId, setAddressId } = useApp()
  return (
    <Screen
      footerBorder
      topBar={<TopBar title="Saved addresses" />}
      footer={
        <Button variant="secondary" onClick={() => navigate('/address/new')}>
          Add new address
        </Button>
      }
    >
      <Content>
        {addresses.map((a) => (
          <Row key={a.id}>
            <AddressCard
              address={a}
              selected={a.id === addressId}
              onSelect={() => setAddressId(a.id)}
              onEdit={() => navigate(`/address/${a.id}`)}
            />
          </Row>
        ))}
      </Content>
    </Screen>
  )
}
