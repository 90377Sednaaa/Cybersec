import { useCallback, useEffect, useSyncExternalStore } from "react"
import { useNavigate } from "react-router-dom"

/**
 * The sidebar destinations and their `g` chord keys.
 *
 * Single source of truth: the sidebar builds its items from this list, the
 * handler routes from it, and the shortcuts panel documents it. Adding a page
 * means adding one line here, not editing three files.
 */
export const NAV_SHORTCUTS = [
  { key: "d", to: "/", label: "Dashboard" },
  { key: "t", to: "/targets", label: "Targets" },
  { key: "a", to: "/assessments", label: "Assessments" },
  { key: "f", to: "/findings", label: "Findings" },
  { key: "s", to: "/settings", label: "Settings" },
] as const

const DESTINATIONS: Record<string, string> = Object.fromEntries(
  NAV_SHORTCUTS.map((item) => [item.key, item.to]),
)

const CHORD_WINDOW_MS = 1200

const HINTS_STORAGE_KEY = "aletheia-shortcut-hints"
const HINTS_CHANGE_EVENT = "aletheia:shortcut-hints"

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable
}

function readHintsPreference(): boolean {
  try {
    return localStorage.getItem(HINTS_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

function subscribeHints(onChange: () => void): () => void {
  window.addEventListener(HINTS_CHANGE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(HINTS_CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/**
 * Whether the sidebar should print `g d`, `g t`, ... next to each item.
 *
 * Default off. The chords work either way; the hints are reference material, so
 * they start hidden and the shortcuts panel is where you turn them on. Backed by
 * localStorage and read through useSyncExternalStore so the sidebar and the
 * toggle in the panel can never disagree.
 */
export function useShowShortcutHints(): [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeHints, readHintsPreference, () => false)

  const setEnabled = useCallback((next: boolean) => {
    try {
      localStorage.setItem(HINTS_STORAGE_KEY, String(next))
    } catch {
      // non-fatal: the preference just won't persist across reloads
    }
    window.dispatchEvent(new Event(HINTS_CHANGE_EVENT))
  }, [])

  return [enabled, setEnabled]
}

/**
 * Two-key navigation: press `g`, then a destination key within a second.
 * `?` toggles the shortcut panel.
 *
 * Deliberately ignores modifier chords and any keystroke typed into a field, so
 * it can never fire while someone is writing assessor notes.
 */
export function useAppShortcuts({ onToggleHelp }: { onToggleHelp?: () => void } = {}) {
  const navigate = useNavigate()

  useEffect(() => {
    let pending = false
    let pendingAt = 0

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      if (event.key === "?") {
        if (!onToggleHelp) return
        event.preventDefault()
        pending = false
        onToggleHelp()
        return
      }

      const key = event.key.toLowerCase()
      const withinWindow = pending && Date.now() - pendingAt < CHORD_WINDOW_MS

      if (withinWindow && DESTINATIONS[key]) {
        event.preventDefault()
        pending = false
        navigate(DESTINATIONS[key])
        return
      }

      pending = key === "g"
      pendingAt = Date.now()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [navigate, onToggleHelp])
}
