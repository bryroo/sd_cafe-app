// One outline icon set (24px grid, 1.75 stroke, currentColor). Replaces the Figma placeholder squares.
import type { CSSProperties } from 'react'

const paths = {
  back: <path d="M15 18l-6-6 6-6" />,
  chevron: <path d="M9 18l6-6-6-6" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9z" />
      <path d="M10.3 20.5a2 2 0 0 0 3.4 0" />
    </>
  ),
  home: <path d="M3.5 10.5L12 3.5l8.5 7V20.5H15v-6H9v6H3.5z" />,
  cup: (
    <>
      <path d="M4 8.5h13v5.5a5.5 5.5 0 0 1-5.5 5.5h-2A5.5 5.5 0 0 1 4 14z" />
      <path d="M17 10.5h1.25a2.5 2.5 0 0 1 0 5H17" />
      <path d="M8 3.5v2M12 3.5v2" />
    </>
  ),
  bread: (
    <>
      <path d="M5 11a7 4.5 0 0 1 14 0c0 1.2-.8 2-1.5 2.3V18a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 18v-4.7C5.8 13 5 12.2 5 11z" />
      <path d="M10 10.5v2M14 10.5v2" />
    </>
  ),
  receipt: (
    <>
      <path d="M5.5 3.5h13v17l-2.6-1.6-2.2 1.6-2.2-1.6-2.2 1.6-2.2-1.6-1.6 1.6z" />
      <path d="M9 8.5h6M9 12.5h6" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.8l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </>
  ),
  store: (
    <>
      <path d="M4.5 10.5v10h15v-10" />
      <path d="M3.5 10.5l1.8-6h13.4l1.8 6z" />
      <path d="M10 20.5v-5h4v5" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6.5h11v10H3z" />
      <path d="M14 10h3.8l3.2 3.4v3.1h-7" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12V3.5H12l8.5 8.5-8.5 8.5z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="6" width="18" height="12.5" rx="1.5" />
      <path d="M3 10h18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8v.2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16v.2" />
    </>
  ),
  note: (
    <>
      <path d="M5.5 3.5h13v17h-13z" />
      <path d="M8.5 8.5h7M8.5 12.5h7M8.5 16.5h4" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.5h4v15h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13h9l1-13" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.7M12 16.6v.2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" />
      <circle cx="15" cy="6.5" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  door: (
    <>
      <path d="M6 20.5v-16h12v16" />
      <path d="M4 20.5h16M14.5 12.5v.2" />
    </>
  ),
  minus: <path d="M6 12h12" />,
  plus: <path d="M12 6v12M6 12h12" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  offline: (
    <>
      <path d="M4 9a12 12 0 0 1 4.5-2.6M12 6a12 12 0 0 1 8 3M7 12.5a7 7 0 0 1 3-1.5M14.5 11.4A7 7 0 0 1 17 12.5" />
      <path d="M10.3 16a2.5 2.5 0 0 1 3.4 0M12 19.5v.1M4 4l16 16" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  repeat: (
    <>
      <path d="M4.5 11V9.5a3 3 0 0 1 3-3h12M16.5 3.5l3 3-3 3" />
      <path d="M19.5 13v1.5a3 3 0 0 1-3 3h-12M7.5 20.5l-3-3 3-3" />
    </>
  ),
  message: <path d="M4.5 5.5h15v10h-9l-4.5 3.5v-3.5H4.5z" />,
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  edit: (
    <>
      <path d="M14.5 5.5l4 4L9 19H5v-4z" />
      <path d="M12.5 7.5l4 4" />
    </>
  ),
}

export type IconName = keyof typeof paths

export function Icon({
  name,
  size = 24,
  color = 'currentColor',
  style,
  label,
}: {
  name: IconName
  size?: number
  color?: string
  style?: CSSProperties
  /** Accessible name; omit for decorative icons. */
  label?: string
}) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {paths[name]}
    </svg>
  )
}
