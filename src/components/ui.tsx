import { useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import logoArt from '../assets/brand/megs-logo.webp'
import markArt from '../assets/brand/megs-mark.webp'
import spinner from '../assets/figma/spinner.svg'
import { Icon } from './Icon'
import './ui.css'

type ButtonVariant = 'primary' | 'secondary' | 'text' | 'text-small' | 'danger' | 'danger-outline'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  /** Height in px: 56 (default), 48, 40. */
  height?: 56 | 52 | 48 | 40
  full?: boolean
  icon?: ReactNode
}

/** Button / Primary, Secondary (outline), Text */
export function Button({
  variant = 'primary',
  height = 56,
  full = true,
  icon,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`btn btn--${variant} ${full ? 'btn--full' : ''} ${className}`}
      style={{ height }}
      {...rest}
    >
      {icon}
      <span className="t-button">{children}</span>
    </button>
  )
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  helper?: string
  /** Error message — shows the error state (red border + message) */
  error?: string
  trailing?: ReactNode
  /** Lets a form focus its first invalid field */
  ref?: Ref<HTMLInputElement>
}

/** Field / Text — label, 56px input, optional helper or error row. */
export function TextField({ label, helper, error, trailing, id, ref, ...rest }: TextFieldProps) {
  const inputId = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  const noteId = `${inputId}-note`
  return (
    <div className={`field ${error ? 'field--error' : ''}`}>
      <label htmlFor={inputId} className="t-body-sm">
        {label}
      </label>
      <div className="field__input">
        <input
          ref={ref}
          id={inputId}
          className="t-body"
          aria-invalid={!!error}
          aria-describedby={error || helper ? noteId : undefined}
          {...rest}
        />
        {trailing}
      </div>
      {error ? (
        <p id={noteId} className="field__error t-caption" role="alert">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : (
        helper && (
          <p id={noteId} className="t-caption muted">
            {helper}
          </p>
        )
      )}
    </div>
  )
}

/** Password field with a Show/Hide control (SRS FR-ACC-06) */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [shown, setShown] = useState(false)
  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          className="field__reveal t-body-sm"
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      }
    />
  )
}

/** Checkbox */
export function Checkbox({
  label,
  checked,
  onChange,
  priceDelta,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  priceDelta?: string
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`checkbox__box ${checked ? 'is-checked' : ''}`}>
        {checked && <Icon name="check" size={16} color="var(--on-dark)" />}
      </span>
      <span className="checkbox__label t-body">{label}</span>
      {priceDelta && <span className="t-body-sm muted">{priceDelta}</span>}
    </label>
  )
}

/** Toggle — a labelled switch that saves as soon as it changes */
export function Toggle({
  label,
  description,
  on,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <span className="toggle__text">
        <span className="t-body">{label}</span>
        {description && <span className="t-body-sm muted">{description}</span>}
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={`toggle__track ${on ? 'is-on' : ''}`} aria-hidden>
        <span />
      </span>
    </label>
  )
}

/** Input / OTP — six 48×56 digit boxes. */
export function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '')
  return (
    <div className="otp">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          className="otp__digit"
          inputMode="numeric"
          maxLength={1}
          value={d}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, '').slice(-1)
            const next = digits.slice()
            next[i] = ch
            onChange(next.join(''))
            if (ch && i < 5) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus()
          }}
          // SRS FR-ACC-04: a pasted code fills all six boxes
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
            if (!pasted) return
            e.preventDefault()
            onChange(pasted)
            refs.current[Math.min(pasted.length, 5)]?.focus()
          }}
        />
      ))}
    </div>
  )
}

/** Pagination / Dots */
export function PaginationDots({ count = 3, active }: { count?: number; active: number }) {
  return (
    <div className="dots" aria-label={`Slide ${active + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={i === active ? 'is-active' : ''} />
      ))}
    </div>
  )
}

/** Logo mark — the crowned face from the MEGS' logo in gold on a black disc, like the cup sticker.
 *  The artwork is a transparent mask, so it takes any colour. */
export function LogoMark({ size = 112 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} role="img" aria-label="MEGS' Cafe">
      <span className="logo-mark__art" style={{ ['--logo' as string]: `url(${markArt})` }} />
    </span>
  )
}

/** The full MEGS' logo (crowned face over the wordmark), drawn in the current text colour. */
export function Logo({ height = 120, label = "MEGS' Cafe" }: { height?: number; label?: string }) {
  return (
    <span
      className="logo"
      style={{ height, width: height * LOGO_RATIO, ['--logo' as string]: `url(${logoArt})` }}
      role="img"
      aria-label={label}
    />
  )
}
const LOGO_RATIO = 364 / 480

/** Feedback / Loader — the gold spinner reads as the lamp warming up, on ink buttons and on the dark splash. */
export function Loader({ dark = false }: { dark?: boolean }) {
  return <img className="loader" data-on={dark ? 'dark' : 'light'} src={spinner} width={24} height={24} alt="Loading" />
}

/** Rule / Check — Met ("Done") and Unmet (muted, optional "Not yet") rows. */
export function RuleCheck({ label, met, pendingLabel }: { label: string; met: boolean; pendingLabel?: string }) {
  return (
    <div className="rule">
      <Icon name={met ? 'check' : 'clock'} size={18} color={met ? 'var(--ink)' : 'var(--faint)'} />
      <span className={`t-body-sm ${met ? '' : 'muted'}`}>{label}</span>
      {met ? (
        <span className="t-caption rule__done">Done</span>
      ) : (
        pendingLabel && <span className="t-caption muted">{pendingLabel}</span>
      )}
    </div>
  )
}

/** A real photograph of the cafe (`src`), cropped to the slot; without `src`, a flat concrete slot. */
export function Photo({
  height,
  width,
  radius = 0,
  className = '',
  src,
  alt = '',
  position = 'center',
}: {
  height: number | string
  width?: number | string
  radius?: number
  className?: string
  src?: string
  alt?: string
  /** object-position for the crop, e.g. "50% 70%" */
  position?: string
}) {
  const style = { height, width: width ?? '100%', borderRadius: radius }
  if (src)
    return (
      <img
        className={`photo photo--real ${className}`}
        src={src}
        alt={alt}
        style={{ ...style, objectFit: 'cover', objectPosition: position }}
      />
    )
  return <div className={`photo ${className}`} style={style} aria-hidden />
}
