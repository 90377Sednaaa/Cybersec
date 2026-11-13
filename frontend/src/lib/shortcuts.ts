import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

const DESTINATIONS: Record<string, string> = {
  d: "/",
  a: "/assessments",
  f: "/findings",
  t: "/targets",
  s: "/settings",
}

const CHORD_WINDOW_MS = 1200

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable
}

/**
 * Two-key navigation: press `g`, then a destination key within a second.
 *
 * Deliberately ignores modifier chords and any keystroke typed into a field, so
 * it can never fire while someone is writing assessor notes.
 */
export function useAppShortcuts() {
  const navigate = useNavigate()

  useEffect(() => {
    let pending = false
    let pendingAt = 0

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

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
  }, [navigate])
}
