import type { FindingQAMessage } from "@/lib/types"

/**
 * One analyst conversation turn. The backend only returns the answer payload,
 * so the client keeps the model, grounded evidence ids and reasoning trace for
 * display and for rebuilding the request history.
 */
export interface ThreadMessage extends FindingQAMessage {
  reasoning?: string | null
  model?: string
  grounded_evidence_ids?: number[]
  timestamp?: string
}

/**
 * Conversations are scoped to one finding and one browser tab. sessionStorage
 * keeps the thread through a reload and through the expanded dialog without
 * turning an ephemeral Q&A session into a shared, server-side transcript.
 */
const STORAGE_PREFIX = "aletheia-finding-qa:v1"
const SESSION_LIMIT = 40

export function threadStorageKey(findingId: number): string {
  return `${STORAGE_PREFIX}:${findingId}`
}

export function timeNow(): string {
  return new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function isThreadMessage(value: unknown): value is ThreadMessage {
  if (typeof value !== "object" || value === null) return false
  const message = value as Record<string, unknown>
  if (message.role !== "user" && message.role !== "assistant") return false
  if (typeof message.content !== "string") return false
  if (message.reasoning != null && typeof message.reasoning !== "string") return false
  if (message.model != null && typeof message.model !== "string") return false
  if (message.timestamp != null && typeof message.timestamp !== "string") return false
  if (message.grounded_evidence_ids != null) {
    if (
      !Array.isArray(message.grounded_evidence_ids) ||
      !message.grounded_evidence_ids.every((id) => typeof id === "number")
    ) {
      return false
    }
  }
  return true
}

/** Load and validate a stored thread. Malformed or stale entries are dropped. */
export function loadFindingQAThread(findingId: number): ThreadMessage[] {
  try {
    const raw = sessionStorage.getItem(threadStorageKey(findingId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isThreadMessage).slice(-SESSION_LIMIT)
  } catch {
    return []
  }
}

/** Persist at most the last 40 turns. Storage failures never block the chat. */
export function saveFindingQAThread(findingId: number, messages: ThreadMessage[]): void {
  try {
    if (messages.length === 0) {
      sessionStorage.removeItem(threadStorageKey(findingId))
      return
    }
    sessionStorage.setItem(threadStorageKey(findingId), JSON.stringify(messages.slice(-SESSION_LIMIT)))
  } catch {
    // Storage can be unavailable or full; the in-memory thread still works.
  }
}

/** Called on logout so one user's analyst thread cannot outlive the session. */
export function clearAllFindingQAThreads(): void {
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(`${STORAGE_PREFIX}:`)) keys.push(key)
    }
    for (const key of keys) sessionStorage.removeItem(key)
  } catch {
    // Non-fatal: the session is being torn down anyway.
  }
}
