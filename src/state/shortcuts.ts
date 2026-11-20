// Keyboard shortcuts for frequent actions (desktop and tablets with keyboards):
//   Alt+1…5   switch between the main sections (the order shown in the navigation)
//   /         jump to search
//   ?         show the list of shortcuts
// They never fire while typing in a field, so "/" and digits still type normally there.
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** Focuses a search box on the current page; returns false when there isn't one */
function focusPageSearch() {
  const box = document.querySelector<HTMLInputElement>('input[type="search"], input[aria-label^="Search"], input[placeholder^="Search"]')
  if (!box) return false
  box.focus()
  box.select()
  return true
}

export function useShortcuts(sections: string[], searchPath?: string, onHelp?: () => void) {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e.target)) return
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
        const to = sections[Number(e.code.slice(5)) - 1]
        if (to) {
          e.preventDefault()
          navigate(to)
        }
        return
      }
      if (e.key === '?' && onHelp && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        onHelp()
        return
      }
      if (e.key === '/' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (focusPageSearch()) e.preventDefault()
        else if (searchPath) {
          e.preventDefault()
          navigate(searchPath)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, sections, searchPath, onHelp])
}
