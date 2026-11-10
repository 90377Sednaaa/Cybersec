import { useEffect, useRef, useState } from "react"

import { getToken } from "@/lib/api"
import type { ScanEvent } from "@/lib/types"

export interface LogLine {
  id: number
  jobId: number
  text: string
}

const MAX_LINES = 500

/**
 * Subscribes to GET /api/assessments/{id}/events (Server-Sent Events).
 * Uses fetch instead of EventSource because the endpoint needs the
 * Authorization header, which EventSource cannot send.
 * Only live log lines are kept (capped); other events go to `onEvent`.
 */
export function useScanEvents(assessmentId: number | null, onEvent?: (event: ScanEvent) => void) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [connected, setConnected] = useState(false)
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    if (assessmentId === null) return
    const controller = new AbortController()
    let counter = 0
    setLines([])

    async function run() {
      try {
        const token = getToken()
        const res = await fetch(`/api/assessments/${assessmentId}/events`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        setConnected(true)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split("\n\n")
          buffer = blocks.pop() ?? ""
          for (const block of blocks) {
            // Keep-alive heartbeats are comment lines without a "data:" field.
            const dataLine = block.split("\n").find((l) => l.startsWith("data: "))
            if (!dataLine) continue
            let event: ScanEvent
            try {
              event = JSON.parse(dataLine.slice(6)) as ScanEvent
            } catch {
              continue
            }
            if (event.type === "log") {
              const line: LogLine = { id: counter++, jobId: event.job_id, text: event.line }
              setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), line])
            }
            onEventRef.current?.(event)
          }
        }
      } catch {
        // Aborted (panel closed) or network error: the UI just shows "not connected".
      } finally {
        if (!controller.signal.aborted) setConnected(false)
      }
    }

    void run()
    return () => {
      controller.abort()
      setConnected(false)
    }
  }, [assessmentId])

  return { lines, connected }
}