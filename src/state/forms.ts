// Inline form validation: each field's message shows once the field has been left, or when the form
// is submitted; submitting with problems moves focus to the first one. The rules stay in the screen.
import { useState } from 'react'

export function useValidation<K extends string>(problems: Record<K, string | undefined>, idOf: (k: K) => string) {
  const [shown, setShown] = useState<Partial<Record<K, boolean>>>({})
  const keys = Object.keys(problems) as K[]
  return {
    /** The message to show under field `k`, if any */
    err: (k: K) => (shown[k] ? problems[k] : undefined),
    /** Call from the field's onBlur */
    touch: (k: K) => setShown((v) => ({ ...v, [k]: true })),
    /** Call on submit: true when everything is fine, otherwise shows all messages and focuses the first */
    check: () => {
      setShown(Object.fromEntries(keys.map((k) => [k, true])) as Record<K, boolean>)
      const first = keys.find((k) => problems[k])
      if (first) document.getElementById(idOf(first))?.focus()
      return !first
    },
  }
}
