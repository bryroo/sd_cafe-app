// Flow 1 — Launch and account (C-01 … C-08)
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Content, Row, Screen, TopBar } from '../components/Screen'
import {
  Button,
  Checkbox,
  Loader,
  Logo,
  OtpInput,
  PasswordField,
  Photo,
  RuleCheck,
  TextField,
} from '../components/ui'
import { Alert, OfflineBanner } from '../components/order'
import { Icon } from '../components/Icon'
import { toIntl, useApp } from '../state/AppState'
import { useOverlay } from '../overlays/OverlayHost'
import { retryConnection, useOnline } from '../state/online'
import { customerLogin, customerSignUp, isMobileRegistered, useShared } from '../state/shared'
import interiorPhoto from '../assets/photos/interior-banquette.webp'
import './account.css'

/** C-01 Splash */
export function Splash() {
  const navigate = useNavigate()
  const { session } = useApp()
  // The saved session is checked against the database before choosing where to go
  const { ready } = useShared()
  useEffect(() => {
    if (!ready) return
    // SRS FR-ACC-09: Home for a valid session, otherwise Welcome. First-time help is the Get started card on
    // Home, where people learn by doing, instead of slides before they can see the menu.
    const next = session === 'member' ? '/home' : '/welcome'
    const t = setTimeout(() => navigate(next, { replace: true }), 1200)
    return () => clearTimeout(t)
  }, [navigate, session, ready])

  return (
    <Screen theme="dark" bg="secondary" bodyClassName="splash">
      <div className="splash__content">
        <span className="splash__logo">
          <Logo height={200} />
        </span>
        <Loader />
      </div>
    </Screen>
  )
}

/** C-03 Welcome */
export function Welcome() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const overlay = useOverlay()
  const { setSession } = useApp()

  // FR-ACC-11: a deleted account lands here with a short confirmation
  useEffect(() => {
    if (params.get('deleted') !== '1') return
    setSession('signed-out')
    overlay.toast('Account deleted')
    setParams({}, { replace: true })
  }, [params, setParams, overlay, setSession])

  return (
    <Screen
      statusOverlay
      statusTheme="dark"
      footer={
        <>
          <Button onClick={() => navigate('/sign-up')}>Create account</Button>
          <Button variant="secondary" onClick={() => navigate('/log-in')}>
            Log in
          </Button>
          <Button
            variant="text"
            height={48}
            onClick={() => {
              setSession('guest')
              navigate('/home')
            }}
          >
            Browse as guest
          </Button>
        </>
      }
    >
      <Photo
        src={interiorPhoto}
        alt="Inside MEGS' Cafe: grey concrete walls, black wall lamps on a pipe rail, an orange banquette and wooden chairs"
        height={340}
        position="50% 30%"
      />
      <div className="welcome__content">
        <h1 className="welcome__logo">
          <Logo height={148} />
        </h1>
        <p className="t-h3 welcome__tagline">The best time is coffee time.</p>
        <p className="t-body muted">Order ahead for pickup at the counter, or have it delivered.</p>
      </div>
    </Screen>
  )
}

const digits = (v: string) => v.replace(/\D/g, '').replace(/^(63|0)/, '')

/** The sign-up form until the code step creates the account. Kept in memory only, never saved:
 *  it holds the password. */
let pendingSignUp: { name: string; phone: string; email: string; password: string } | null = null

/** C-04 Sign Up */
export function SignUp() {
  const navigate = useNavigate()
  const { setPhone, name, setName } = useApp()
  const online = useOnline()
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // DPA: consent is the customer's to give, so the box starts unticked
  const [agreed, setAgreed] = useState(false)
  const strong = password.length >= 8 && /\d/.test(password)
  // 3.2.1.5: a number that already has an account gets a link to Log in instead (asked of the database)
  const [taken, setTaken] = useState(false)
  useEffect(() => {
    setTaken(false)
    if (digits(mobile).length !== 10) return
    let live = true
    const t = setTimeout(() => {
      isMobileRegistered(mobile).then((yes) => live && setTaken(yes), () => {})
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [mobile])
  // Messages show after a field is left, or on Continue; they say what to fix, not just "invalid"
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const show = (k: string) => setShown((v) => ({ ...v, [k]: true }))
  const problems: Record<string, string | undefined> = {
    name: name.trim() ? undefined : 'Enter your name.',
    mobile: taken
      ? 'This number already has an account.'
      : digits(mobile).length === 10
        ? undefined
        : 'Enter an 11-digit mobile number, like 0917 123 4567.',
    email: !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Enter an email like name@example.com, or leave it empty.',
    password: strong ? undefined : 'Use 8 or more characters, with at least one number.',
    agreed: agreed ? undefined : 'Tick the box to agree to the Terms and Privacy Policy.',
  }
  const err = (k: string) => (shown[k] || (k === 'mobile' && taken) ? problems[k] : undefined)
  const order = ['name', 'mobile', 'email', 'password', 'agreed']

  const submit = () => {
    setShown(Object.fromEntries(order.map((k) => [k, true])))
    const first = order.find((k) => problems[k])
    if (first) {
      document.getElementById(`su-${first}`)?.focus()
      return
    }
    setPhone(mobile)
    pendingSignUp = { name, phone: mobile, email, password }
    navigate('/verify')
  }

  return (
    <Screen
      topBar={<TopBar />}
      footer={
        <Button disabled={!online} onClick={submit}>
          Continue
        </Button>
      }
    >
      <Content>
        <Row>
          <h1 className="t-h1">Create your account</h1>
        </Row>
        {!online && (
          <Row>
            <OfflineBanner onRetry={retryConnection}>You're offline. Connect to create your account.</OfflineBanner>
          </Row>
        )}
        <Row>
          <TextField
            id="su-name"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => show('name')}
            error={err('name')}
            autoComplete="name"
          />
        </Row>
        <Row>
          <TextField
            id="su-mobile"
            label="Mobile number"
            helper="We will text you a 6-digit code"
            placeholder="0917 123 4567"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            onBlur={() => show('mobile')}
            inputMode="tel"
            autoComplete="tel"
            error={err('mobile')}
          />
          {taken && (
            <Button
              variant="text"
              height={48}
              full={false}
              onClick={() => navigate(`/log-in?id=${encodeURIComponent(mobile)}`)}
            >
              Log in with this number
            </Button>
          )}
        </Row>
        <Row>
          <TextField
            id="su-email"
            label="Email (optional)"
            placeholder="name@example.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => show('email')}
            error={err('email')}
            autoComplete="email"
          />
        </Row>
        <Row>
          <PasswordField
            id="su-password"
            label="Password"
            helper="8 or more characters, with at least one number"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => show('password')}
            error={err('password')}
            autoComplete="new-password"
          />
        </Row>
        <Row>
          <div className="field">
            <Checkbox id="su-agreed" label="I agree to the Terms and Privacy Policy" checked={agreed} onChange={setAgreed} />
            {err('agreed') && (
              <p className="field__error t-caption" role="alert">
                <Icon name="alert" size={16} />
                {err('agreed')}
              </p>
            )}
          </div>
        </Row>
      </Content>
    </Screen>
  )
}

const RESEND_AFTER = 30

/** C-05 Verification — `?mode=reset` continues to Reset Password instead of Home. */
export function Verification() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reset = params.get('mode') === 'reset'
  const { phone, setSession, setFirstLaunch } = useApp()
  const [code, setCode] = useState('')
  const [wait, setWait] = useState(RESEND_AFTER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // FR-ACC-03: the account is created only once the code is entered (codes are simulated until SMS is on)
  const verify = async () => {
    if (reset) return navigate('/reset-password')
    if (!pendingSignUp) return navigate('/sign-up', { replace: true })
    setBusy(true)
    setError('')
    try {
      await customerSignUp(pendingSignUp)
      pendingSignUp = null
      setSession('member')
      setFirstLaunch(true)
      navigate('/home', { replace: true })
    } catch (err) {
      setCode('')
      setError(err instanceof Error ? err.message : "Couldn't create your account. Try again.")
    } finally {
      setBusy(false)
    }
  }

  // SRS FR-ACC-05: resend only after a 30-second cooldown, showing the time left
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  // SRS FR-ACC-04: the sixth digit submits the code (the prototype accepts any six digits)
  useEffect(() => {
    if (code.length === 6) verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  return (
    <Screen
      topBar={<TopBar />}
      footer={
        <Button disabled={code.length < 6 || busy} onClick={verify} aria-busy={busy}>
          {busy ? 'Creating your account…' : 'Verify'}
        </Button>
      }
    >
      <Content>
        <Row>
          <h1 className="t-h1">Enter the 6-digit code</h1>
        </Row>
        <Row>
          <div className="sent-to">
            <span className="t-body muted">Sent to {toIntl(phone)}</span>
            <Button variant="text" height={48} full={false} onClick={() => navigate(-1)}>
              Edit
            </Button>
          </div>
        </Row>
        <Row>
          <OtpInput value={code} onChange={setCode} />
        </Row>
        {error && (
          <Row>
            <Alert tone="danger">{error}</Alert>
          </Row>
        )}
        <Row>
          {wait > 0 ? (
            <p className="t-body muted resend" aria-live="polite">
              Resend code in 0:{String(wait).padStart(2, '0')}
            </p>
          ) : (
            <button className="t-body link-text resend" onClick={() => setWait(RESEND_AFTER)}>
              Resend code
            </button>
          )}
        </Row>
      </Content>
    </Screen>
  )
}

/** "14:32" */
const mmss = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** The mobile number or email last used to log in on this device, so coming back is one field.
 *  Only the identifier is kept, never the password; deleting the account clears it (megs.*). */
const LAST_LOGIN = 'megs.last-login'
const DEMO_ID = '0917 123 4567'
const lastLogin = () => {
  try {
    return window.localStorage.getItem(LAST_LOGIN) ?? ''
  } catch {
    return ''
  }
}

/** C-06 Log In — FR-ACC-07: 5 wrong passwords lock sign-in for 15 minutes, with a live countdown */
export function LogIn() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { setSession } = useApp()
  const online = useOnline()
  // The demo account (demo-reset seed); the lockout is kept by the database (FR-ACC-07)
  const [id, setId] = useState(() => params.get('id') ?? (lastLogin() || DEMO_ID))
  // The demo password is filled in only for the demo account
  const [password, setPassword] = useState(() => (!params.get('id') && (lastLogin() || DEMO_ID) === DEMO_ID ? 'password1' : ''))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const locked = lockedUntil > now

  useEffect(() => {
    if (!locked) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [locked])

  const [missing, setMissing] = useState<{ id?: string; password?: string }>({})

  const submit = async () => {
    const m = { id: id.trim() ? undefined : 'Enter your mobile number or email.', password: password ? undefined : 'Enter your password.' }
    setMissing(m)
    if (m.id || m.password) {
      document.getElementById(m.id ? 'li-id' : 'li-password')?.focus()
      return
    }
    setBusy(true)
    const r = await customerLogin(id, password)
    setBusy(false)
    if (r.ok) {
      try {
        window.localStorage.setItem(LAST_LOGIN, id.trim())
      } catch {
        /* storage blocked: the field is just empty next time */
      }
      setSession('member')
      navigate('/home', { replace: true })
      return
    }
    setNow(Date.now())
    if (r.offline) {
      setError("Couldn't reach the cafe. Check your connection and try again.")
    } else if (r.lockedUntil) {
      setLockedUntil(r.lockedUntil)
      setError('')
    } else {
      // One banner, never saying which field was wrong (3.2.1.5)
      setError(
        `That mobile number or email and password don't match. ${r.left} attempt${r.left === 1 ? '' : 's'} left before sign-in is paused.`,
      )
    }
  }

  return (
    <Screen
      topBar={<TopBar />}
      footer={
        <Button disabled={locked || !online || busy} onClick={submit} aria-busy={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      }
    >
      <Content>
        <Row>
          <h1 className="t-h1">Log in</h1>
        </Row>
        {!online && (
          <Row>
            <OfflineBanner onRetry={retryConnection}>You're offline. Connect to log in.</OfflineBanner>
          </Row>
        )}
        {params.get('updated') && (
          <Row>
            <Alert tone="info">
              Password reset arrives with SMS codes at launch. Your password is unchanged: log in with it as before.
            </Alert>
          </Row>
        )}
        {locked && (
          <Row>
            <Alert tone="danger">
              Too many attempts. Try again in <span className="num">{mmss(lockedUntil - now)}</span>.
            </Alert>
          </Row>
        )}
        {error && !locked && (
          <Row>
            <Alert tone="danger">{error}</Alert>
          </Row>
        )}
        <Row>
          <TextField
            id="li-id"
            label="Mobile number or email"
            value={id}
            error={missing.id}
            onChange={(e) => {
              setId(e.target.value)
              setLockedUntil(0)
              setMissing((v) => ({ ...v, id: undefined }))
            }}
            inputMode="email"
            autoComplete="username"
          />
        </Row>
        <Row>
          <PasswordField
            id="li-password"
            label="Password"
            value={password}
            error={missing.password}
            onChange={(e) => {
              setPassword(e.target.value)
              setMissing((v) => ({ ...v, password: undefined }))
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoComplete="current-password"
            helper="Demo password: password1"
          />
        </Row>
        <Row>
          <div className="forgot-row">
            <Button variant="text" height={48} full={false} onClick={() => navigate('/forgot-password')}>
              Forgot password?
            </Button>
          </div>
        </Row>
      </Content>
    </Screen>
  )
}

/** C-07 Forgot Password */
export function ForgotPassword() {
  const navigate = useNavigate()
  const [id, setId] = useState('')
  const [error, setError] = useState('')
  const send = () => {
    if (!id.trim()) {
      setError('Enter the mobile number or email on your account.')
      document.getElementById('fp-id')?.focus()
      return
    }
    navigate('/verify?mode=reset')
  }

  return (
    <Screen
      topBar={<TopBar />}
      footer={<Button onClick={send}>Send reset code</Button>}
    >
      <Content>
        <Row>
          <h1 className="t-h1">Reset your password</h1>
        </Row>
        <Row>
          <p className="t-body muted">Enter your mobile number or email and we'll send you a code.</p>
        </Row>
        <Row>
          <TextField
            id="fp-id"
            label="Mobile number or email"
            placeholder="0917 123 4567"
            value={id}
            error={error}
            onChange={(e) => {
              setId(e.target.value)
              setError('')
            }}
            autoComplete="username"
          />
        </Row>
      </Content>
    </Screen>
  )
}

/** C-08 Reset Password */
// While SMS codes are simulated this is a walkthrough: saving changes nothing, because a reset that
// worked behind a made-up code would let anyone take over any account (spec 2026-11-08, section 3).
export function ResetPassword() {
  const navigate = useNavigate()
  const [pw, setPw] = useState('password1')
  const [confirm, setConfirm] = useState('password1')
  const longEnough = pw.length >= 8
  const hasNumber = /\d/.test(pw)
  const [tried, setTried] = useState(false)
  const pwError = tried && !(longEnough && hasNumber) ? 'Use 8 or more characters, with at least one number.' : undefined
  const confirmError = tried && pw !== confirm ? "The two passwords don't match." : undefined
  const save = () => {
    setTried(true)
    if (!longEnough || !hasNumber) return document.getElementById('rp-new')?.focus()
    if (pw !== confirm) return document.getElementById('rp-confirm')?.focus()
    navigate('/log-in?updated=1', { replace: true })
  }

  return (
    <Screen
      topBar={<TopBar />}
      footer={<Button onClick={save}>Save password</Button>}
    >
      <Content>
        <Row>
          <h1 className="t-h1">Set a new password</h1>
        </Row>
        <Row>
          <PasswordField
            id="rp-new"
            label="New password"
            value={pw}
            error={pwError}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        </Row>
        <Row>
          <PasswordField
            id="rp-confirm"
            label="Confirm password"
            value={confirm}
            error={confirmError}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Row>
        <Row>
          <div className="rules">
            <RuleCheck label="8 or more characters" met={longEnough} />
            <RuleCheck label="At least one number" met={hasNumber} />
          </div>
        </Row>
      </Content>
    </Screen>
  )
}
