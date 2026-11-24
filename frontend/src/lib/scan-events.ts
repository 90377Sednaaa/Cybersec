import { useEffect, useRef, useState } from "react"

import { clearToken, getToken } from "@/lib/api"
import type { ScanEvent } from "@/lib/types"

export interface LogLine {
  id: number
  jobId: number | null
  text: string
}

const MAX_LINES = 500
const MAX_BACKOFF_MS = 15_000

/**
 * Subscribes to GET /api/assessments/{id}/events (Server-Sent Events).
 * Uses fetch instead of EventSource because the endpoint needs the
 * Authorization header, which EventSource cannot send.
 *
 * Reconnects with capped exponential backoff when the stream drops mid-run
 * (dev-server restart, proxy idle timeout, laptop sleep). A terminal
 * `assessment` event or `enabled = false` stops the loop cleanly; a 401
 * clears the expired session instead of retrying forever.
 */
export function useScanEvents(
  assessmentId: number | null,
  onEvent?: (event: ScanEvent) => void,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true
  const [logState, setLogState] = useState<{ id: number | null; lines: LogLine[] }>({
    id: assessmentId,
    lines: [],
  })
  const [connected, setConnected] = useState(false)
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  })

  const lines = logState.id === assessmentId ? logState.lines : []

  useEffect(() => {
    if (assessmentId === null || !enabled) return
    const controller = new AbortController()
    let counter = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function appendLine(text: string, jobId: number | null) {
      setLogState((prev) => ({
        id: assessmentId,
        lines: [
          ...(prev.id === assessmentId ? prev.lines : []).slice(-(MAX_LINES - 1)),
          { id: counter++, jobId, text },
        ],
      }))
    }

    /** One SSE connection. Returns true when the run reached a terminal state. */
    async function connect(): Promise<boolean> {
      const token = getToken()
      const res = await fetch(`/api/assessments/${assessmentId}/events`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      })
      if (res.status === 401 && token) {
        clearToken()
        sessionStorage.setItem("aletheia-return-to", window.location.pathname)
        window.location.href = "/login"
        return true
      }
      if (res.status === 404) return true
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      setConnected(true)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let terminal = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split("\n\n")
        buffer = blocks.pop() ?? ""
        for (const block of blocks) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "))
          if (!dataLine) continue
          let event: ScanEvent
          try {
            event = JSON.parse(dataLine.slice(6)) as ScanEvent
          } catch {
            continue
          }
          if (event.type === "log") appendLine(event.line, event.job_id ?? null)
          if (event.type === "assessment") terminal = true
          onEventRef.current?.(event)
        }
      }
      return terminal
    }

    async function run(): Promise<void> {
      let attempt = 0
      for (;;) {
        if (controller.signal.aborted) return
        let terminal = false
        try {
          terminal = await connect()
        } catch {
          // Aborted or network error: fall through to the backoff below.
        }
        if (controller.signal.aborted || terminal) return
        setConnected(false)
        attempt += 1
        const delay = Math.min(1_000 * 2 ** Math.min(attempt - 1, 4), MAX_BACKOFF_MS)
        await new Promise<void>((resolve) => {
          retryTimer = setTimeout(resolve, delay)
        })
        retryTimer = null
      }
    }

    void run()
    return () => {
      controller.abort()
      if (retryTimer) clearTimeout(retryTimer)
      setConnected(false)
    }
  }, [assessmentId, enabled])

  return { lines, connected: enabled && connected }
}
