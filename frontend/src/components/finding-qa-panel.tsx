import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  AlertCircle,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownContent } from "@/components/markdown-content"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { FindingDetail, FindingQAMessage, FindingQAResponse } from "@/lib/types"

const SUGGESTED_PROMPTS = [
  "Is this exploitable without auth?",
  "What specific evidence proves this?",
  "Provide web server config remediation",
  "What false-positive conditions could apply?",
]

interface ThreadMessage extends FindingQAMessage {
  reasoning?: string | null
  model?: string
  grounded_evidence_ids?: number[]
  timestamp?: string
}

function timeNow(): string {
  return new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export function FindingQAPanel({
  finding,
  onEvidenceCited,
}: {
  finding: FindingDetail
  onEvidenceCited?: (evidenceId: number) => void
}) {
  const { hasRole } = useAuth()
  const canAsk = hasRole("admin", "assessor")
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [input, setInput] = useState("")
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [expandedReasoning, setExpandedReasoning] = useState<Record<number, boolean>>({})
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Grow the composer with its content, up to a readable cap.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [input])

  const qaMutation = useMutation({
    mutationFn: ({ question, history }: { question: string; history: FindingQAMessage[] }) =>
      api<FindingQAResponse>(`/api/findings/${finding.id}/qa`, {
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
      inputRef.current?.focus()
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to get AI answer")
    },
  })

  // Keep the newest turn in view without scrolling the page itself.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages.length, qaMutation.isPending])

  const ask = (raw: string) => {
    const question = raw.trim()
    if (!question || qaMutation.isPending || !canAsk) return
    const history: FindingQAMessage[] = messages.map(({ role, content }) => ({ role, content }))
    setMessages((prev) => [...prev, { role: "user", content: question, timestamp: timeNow() }])
    setInput("")
    qaMutation.mutate({ question, history })
  }

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    ask(input)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const retryLast = () => {
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user")
    if (lastUserIndex === -1) return
    const question = messages[lastUserIndex].content
    const history: FindingQAMessage[] = messages
      .slice(0, lastUserIndex)
      .map(({ role, content }) => ({ role, content }))
    qaMutation.mutate({ question, history })
  }

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
    toast.success("Answer copied to clipboard")
  }

  const toggleReasoning = (idx: number) => {
    setExpandedReasoning((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  const jumpToEvidence = (evidenceId: number) => {
    // Expand before scrolling so the cited evidence body is visible on arrival.
    onEvidenceCited?.(evidenceId)
    const el = document.getElementById(`evidence-${evidenceId}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.classList.add("ring-2", "ring-primary")
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2200)
    } else {
      toast.info(`Evidence #${evidenceId} is not attached to this finding`)
    }
  }

  const clearConversation = () => {
    setMessages([])
    setExpandedReasoning({})
    qaMutation.reset()
    inputRef.current?.focus()
  }

  const noProvider = Boolean(qaMutation.error?.message.includes("No AI provider"))

  return (
    <Card className="gap-0 overflow-hidden py-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/60">
          <Sparkles className="size-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Ask the Analyst</h2>
            <Badge
              variant="outline"
              className="h-5 border-border/70 px-1.5 text-[10px] font-normal text-muted-foreground"
            >
              Grounded
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            Answers cite this finding&apos;s evidence.
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={clearConversation}
            disabled={qaMutation.isPending}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title={qaMutation.isPending ? "Wait for the current answer" : "Clear conversation"}
            aria-label="Clear conversation"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Thread */}
      <div
        ref={listRef}
        className="min-h-[160px] max-h-[440px] overflow-y-auto px-4 py-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="space-y-3 py-1">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Ask about exploitability, the evidence behind this finding, or how to fix it.
            </p>
            {canAsk && (
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={qaMutation.isPending}
                    onClick={() => ask(prompt)}
                    className="inline-flex items-center rounded-full border border-border/80 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((msg, idx) =>
              msg.role === "user" ? (
                <div key={idx} className="flex justify-end pl-6" title={msg.timestamp}>
                  <div className="max-w-full whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-primary-foreground shadow-xs">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={idx} className="flex gap-2.5" title={msg.timestamp}>
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/60">
                    <Sparkles className="size-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-foreground">Analyst</span>
                      {msg.model && (
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {msg.model}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleCopy(msg.content, idx)}
                        className="ml-auto shrink-0 text-muted-foreground opacity-70 hover:opacity-100"
                        title="Copy answer"
                        aria-label="Copy answer"
                      >
                        {copiedIdx === idx ? (
                          <Check className="size-3 text-emerald-500" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </Button>
                    </div>

                    {/* Collapsible reasoning trace for thinking models */}
                    {msg.reasoning && (
                      <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20">
                        <button
                          type="button"
                          onClick={() => toggleReasoning(idx)}
                          aria-expanded={Boolean(expandedReasoning[idx])}
                          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Brain className="size-3" />
                          <span>Reasoning</span>
                          <ChevronDown
                            className={cn(
                              "ml-auto size-3 transition-transform",
                              expandedReasoning[idx] && "rotate-180",
                            )}
                          />
                        </button>
                        {expandedReasoning[idx] && (
                          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap border-t border-border/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                            {msg.reasoning}
                          </div>
                        )}
                      </div>
                    )}

                    <MarkdownContent
                      content={msg.content}
                      onCitationClick={jumpToEvidence}
                      className="text-foreground"
                    />

                    {msg.grounded_evidence_ids && msg.grounded_evidence_ids.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                        <ShieldCheck className="size-3.5 shrink-0 text-emerald-500" />
                        <span>Grounded in</span>
                        {msg.grounded_evidence_ids.map((evidenceId) => (
                          <button
                            key={evidenceId}
                            type="button"
                            onClick={() => jumpToEvidence(evidenceId)}
                            className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground transition-colors hover:bg-muted"
                            title={`Jump to Evidence #${evidenceId}`}
                          >
                            Evidence #{evidenceId}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}

            {qaMutation.isPending && (
              <div className="flex gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/60">
                  <Sparkles className="size-3.5 animate-pulse text-primary" />
                </div>
                <div className="flex items-center gap-2 pt-1.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-0.5" aria-hidden="true">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="size-1 animate-pulse rounded-full bg-muted-foreground/70"
                        style={{ animationDelay: `${dot * 150}ms` }}
                      />
                    ))}
                  </span>
                  <span>Reviewing the evidence</span>
                </div>
              </div>
            )}

            {qaMutation.isError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[11px]">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="font-medium text-foreground">The analyst could not answer</p>
                    <p className="leading-relaxed text-muted-foreground">
                      {noProvider ? (
                        <>
                          No provider or model is configured for Finding Q&amp;A.{" "}
                          <Link to="/settings" className="font-medium text-foreground underline">
                            Open LLM settings
                          </Link>
                        </>
                      ) : (
                        qaMutation.error.message
                      )}
                    </p>
                    {!noProvider && (
                      <Button size="xs" variant="outline" onClick={retryLast}>
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border/60 bg-muted/10 p-3">
        {!canAsk ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center text-[11px] text-muted-foreground">
            <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
            <span>Only assessors and admins can query the analyst.</span>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-border/80 bg-card p-2 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15"
          >
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about evidence, exploitability, or remediation"
              rows={1}
              aria-label="Ask the analyst a question"
              className="max-h-32 min-h-9 resize-none border-0 bg-transparent p-1.5 text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="hidden pl-1 text-[10px] text-muted-foreground sm:inline">
                Enter to send <span className="text-border">·</span> Shift+Enter for a new line
              </span>
              <Button
                type="submit"
                size="icon-sm"
                disabled={!input.trim() || qaMutation.isPending}
                className="ml-auto size-8 shrink-0 rounded-full shadow-xs"
                title="Send message"
                aria-label="Send message"
              >
                {qaMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}
