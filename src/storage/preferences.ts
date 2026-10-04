export type Preferences = {
  animationEnabled: boolean
  appearEffect: boolean
  edgeEffect: boolean
  dimExistingEdges: boolean
  flipEnabled: boolean
  focusPulse: boolean
  subnodeBorders: boolean
  autoSave: boolean
  editable: boolean
  dragEnabled: boolean
  shortcutsEnabled: boolean
  contextMenuEnabled: boolean
  toolbarVisible: boolean
}

export const DEFAULT_PREFS: Preferences = {
  animationEnabled: true,
  appearEffect: true,
  edgeEffect: true,
  dimExistingEdges: true,
  flipEnabled: true,
  focusPulse: true,
  subnodeBorders: true,
  autoSave: true,
  editable: true,
  dragEnabled: true,
  shortcutsEnabled: true,
  contextMenuEnabled: true,
  toolbarVisible: true,
}

const KEY = 'my-mindmap:prefs:v1'

function sanitize(v: unknown): Preferences {
  const out = { ...DEFAULT_PREFS }
  if (typeof v !== 'object' || v === null) return out
  const rec = v as Record<string, unknown>
  for (const k of Object.keys(DEFAULT_PREFS) as Array<keyof Preferences>) {
    if (typeof rec[k] === 'boolean') out[k] = rec[k] as boolean
  }
  return out
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    return sanitize(JSON.parse(raw) as unknown)
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePreferences(p: Preferences): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
    return true
  } catch {
    return false
  }
}

export function resetPreferences(): Preferences {
  const next = { ...DEFAULT_PREFS }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore: caller shows the failure
  }
  return next
}
