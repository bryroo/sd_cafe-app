// First-run hints kept on this device only (the Home "Get started" card). Not account data.
const KEY = 'megs.first-run'

type Flags = { seenRewards?: boolean; dismissed?: boolean }

export function readFirstRun(): Flags {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Flags
  } catch {
    return {}
  }
}

export function setFirstRun(patch: Flags) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readFirstRun(), ...patch }))
  } catch {
    /* storage blocked: the card just shows again, which is harmless */
  }
}
