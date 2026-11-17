import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import { api } from "@/lib/api"
import {
  loadFindingQAThread,
  saveFindingQAThread,
  timeNow,
  type ThreadMessage,
} from "@/lib/finding-qa"
import type { FindingQAMessage, FindingQAResponse } from "@/lib/types"

/**
 * Owns the analyst conversation for one finding: history, draft, request
 * lifecycle and per-message UI state. Both the inline panel and the expanded
 * dialog render from this single session, so expanding cannot fork a thread or
 * fire a duplicate request.
 */
export function useFindingQASession(findingId: number) {
  const [messages, setMessages] = useState<ThreadMessage[]>(() => loadFindingQAThread(findingId))
  const [input, setInput] = useState("")
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [expandedReasoning, setExpandedReasoning] = useState<Record<number, boolean>>({})

  const mutation = useMutation({
    mutationFn: ({ question, history }: { question: string; history: FindingQAMessage[] }) =>
      api<FindingQAResponse>(`/api/findings/${findingId}/qa`, {
        method: "POST",
        body: JSON.stringify({ question, history }),
      }),
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          reasoning: data.reasoning,
          model: data.model,
          grounded_evidence_ids: data.grounded_evidence_ids,
          timestamp: timeNow(),
        },
      ])
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to get AI answer")
    },
  })

  // The effect also removes the stored thread when the last message is cleared.
  useEffect(() => {
    saveFindingQAThread(findingId, messages)
  }, [findingId, messages])

  const ask = (raw: string) => {
    const question = raw.trim()
    if (!question || mutation.isPending) return
    const history: FindingQAMessage[] = messages.map(({ role, content }) => ({ role, content }))
    // Add the user turn before the request so the thread reacts immediately.
    setMessages((prev) => [...prev, { role: "user", content: question, timestamp: timeNow() }])
    setInput("")
    mutation.mutate({ question, history })
  }

  const retryLast = () => {
    if (mutation.isPending) return
    const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user")
    if (lastUserIndex === -1) return
    const question = messages[lastUserIndex].content
    const history: FindingQAMessage[] = messages
      .slice(0, lastUserIndex)
      .map(({ role, content }) => ({ role, content }))
    mutation.mutate({ question, history })
  }

  const clear = () => {
    setMessages([])
    setInput("")
    setExpandedReasoning({})
    setCopiedIdx(null)
    mutation.reset()
  }

  const copy = (text: string, index: number) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedIdx(index)
        window.setTimeout(() => setCopiedIdx(null), 2000)
        toast.success("Answer copied to clipboard")
      })
      .catch(() => toast.error("Could not copy the answer"))
  }

  const toggleReasoning = (index: number) => {
    setExpandedReasoning((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  return {
    messages,
    input,
    setInput,
    ask,
    retryLast,
    clear,
    copy,
    copiedIdx,
    expandedReasoning,
    toggleReasoning,
    pending: mutation.isPending,
    error: mutation.error,
    noProvider: Boolean(mutation.error?.message.includes("No AI provider")),
  }
}

export type FindingQASession = ReturnType<typeof useFindingQASession>
