import { useState, useRef, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  Sparkles,
  Send,
  Bot,
  User as UserIcon,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  ChevronUp,
  Brain,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  Loader2,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

export function FindingQAPanel({ finding }: { finding: FindingDetail }) {
  const { hasRole } = useAuth()
  const canAsk = hasRole("admin", "assessor")
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [input, setInput] = useState("")
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [expandedReasoning, setExpandedReasoning] = useState<Record<number, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const qaMutation = useMutation({
    mutationFn: (question: string) => {
      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))
      return api<FindingQAResponse>(`/api/findings/${finding.id}/qa`, {
        method: "POST",
        body: JSON.stringify({ question, history: historyPayload }),
      })
    },
    onSuccess: (data, question) => {
      const now = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
      setMessages((prev) => [
        ...prev,
        { role: "user", content: question, timestamp: now },
        {
          role: "assistant",
          content: data.answer,
          reasoning: data.reasoning,
          model: data.model,
          grounded_evidence_ids: data.grounded_evidence_ids,
          timestamp: now,
        },
      ])
      setInput("")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to get AI answer")
    },
  })

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || qaMutation.isPending || !canAsk) return
    qaMutation.mutate(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
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

  const handleCitationClick = (evidenceId: number) => {
    const el = document.getElementById(`evidence-${evidenceId}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.classList.add("ring-2", "ring-primary", "transition-all")
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2500)
    } else {
      toast.info(`Evidence #${evidenceId} is attached in the Evidence section`)
    }
  }

  return (
    <Card className="border-border/60 bg-card shadow-xs flex flex-col overflow-hidden">
      {/* Header */}
      <CardHeader className="p-4 pb-3 border-b border-border/50 bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center border border-border/60 shadow-2xs">
              <Sparkles className="size-4 text-foreground/80" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                Ask the Analyst
                <Badge variant="outline" className="text-[10px] font-mono py-0 text-muted-foreground border-border/60">
                  Grounded Q&amp;A
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Examine technical evidence and exploitability with AI reasoning.
              </CardDescription>
            </div>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setMessages([])}
              className="text-xs text-muted-foreground hover:text-foreground h-7 px-2"
              title="Clear session messages"
            >
              <Trash2 className="size-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      {/* Messages Thread */}
      <CardContent className="p-4 space-y-4 max-h-[520px] overflow-y-auto">
        {messages.length === 0 ? (
          <div className="py-8 px-4 flex flex-col items-center justify-center text-center">
            <div className="size-10 rounded-xl bg-muted text-muted-foreground flex items-center justify-center mb-3 border border-border/60 shadow-2xs">
              <Bot className="size-5" />
            </div>
            <p className="text-xs font-semibold text-foreground tracking-tight">Interactive Evidence Investigation</p>
            <p className="text-[11px] text-muted-foreground max-w-md mt-1.5 mb-5 leading-relaxed">
              Ask questions about authentication requirements, proof in HTTP transcripts, or configuration fixes. Answers cite attached evidence strictly and will not speculate.
            </p>

            {canAsk && (
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={qaMutation.isPending}
                    onClick={() => {
                      setInput(prompt)
                      qaMutation.mutate(prompt)
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium bg-muted/50 text-foreground/85 border border-border/70 hover:border-foreground/30 hover:bg-muted transition-all cursor-pointer shadow-2xs"
                  >
                    <Sparkles className="size-3 text-muted-foreground shrink-0" />
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="size-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0 border border-border/60 shadow-2xs mt-0.5">
                    <Bot className="size-4.5" />
                  </div>
                )}

                <div className={`max-w-[88%] space-y-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  {/* User Bubble */}
                  {msg.role === "user" ? (
                    <div className="rounded-2xl rounded-tr-xs bg-primary text-primary-foreground px-4 py-2.5 text-xs leading-relaxed shadow-xs">
                      {msg.content}
                    </div>
                  ) : (
                    /* Assistant Surface */
                    <div className="rounded-2xl rounded-tl-xs border border-border/70 bg-card p-4 space-y-3 shadow-xs">
                      {/* Assistant Header */}
                      <div className="flex items-center justify-between border-b border-border/40 pb-2">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="font-semibold text-foreground">Analyst Assistant</span>
                          {msg.model && (
                            <Badge variant="outline" className="text-[10px] font-mono py-0 text-muted-foreground border-border/50">
                              {msg.model}
                            </Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopy(msg.content, idx)}
                          className="size-6 text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Copy answer"
                        >
                          {copiedIdx === idx ? (
                            <Check className="size-3 text-emerald-500" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </Button>
                      </div>

                      {/* Collapsible Reasoning Trace (DeepSeek-R1 / Thinking Models) */}
                      {msg.reasoning && (
                        <div className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden text-xs">
                          <button
                            type="button"
                            onClick={() => toggleReasoning(idx)}
                            className="flex items-center justify-between w-full px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5">
                              <Brain className="size-3.5 text-muted-foreground" />
                              <span>Reasoning Trace (Thinking Process)</span>
                            </span>
                            {expandedReasoning[idx] ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                          </button>
                          {expandedReasoning[idx] && (
                            <div className="px-3 py-2.5 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed border-t border-border/40 bg-muted/10 max-h-48 overflow-y-auto">
                              {msg.reasoning}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Rendered Markdown Body (Free of literal ## and **) */}
                      <MarkdownContent
                        content={msg.content}
                        onCitationClick={handleCitationClick}
                        className="text-foreground"
                      />

                      {/* Grounding & Evidence Footer */}
                      {msg.grounded_evidence_ids && msg.grounded_evidence_ids.length > 0 && (
                        <div className="flex items-center gap-1.5 border-t border-border/40 pt-2 text-[11px] text-muted-foreground font-medium">
                          <ShieldCheck className="size-3.5 text-emerald-500" />
                          <span>Grounded in {msg.grounded_evidence_ids.length} technical evidence item(s)</span>
                        </div>
                      )}
                    </div>
                  )}

                  {msg.timestamp && (
                    <p className={`text-[10px] text-muted-foreground/70 px-1 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                      {msg.timestamp}
                    </p>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="size-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0 border border-border/50 shadow-2xs mt-0.5">
                    <UserIcon className="size-4" />
                  </div>
                )}
              </div>
            ))}

            {/* Analyzing Indicator with Smooth Shimmer */}
            {qaMutation.isPending && (
              <div className="flex gap-3 items-start">
                <div className="size-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0 border border-border/60 shadow-2xs">
                  <Bot className="size-4.5 animate-pulse" />
                </div>
                <div className="rounded-2xl rounded-tl-xs border border-border/60 bg-card p-3.5 space-y-2 shadow-2xs">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    <span className="font-medium text-foreground">Evaluating evidence against finding context...</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/80">
                    Cross-checking HTTP response headers, sockets, and ports.
                  </p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {qaMutation.isError && (
          <Alert variant="destructive" className="py-2.5 px-3 text-xs">
            <AlertCircle className="size-4" />
            <AlertTitle className="text-xs font-semibold">AI Request Error</AlertTitle>
            <AlertDescription className="text-xs mt-1">
              {qaMutation.error.message.includes("No AI provider") ? (
                <span>
                  No provider or model is configured for Finding Q&amp;A.{" "}
                  <Link to="/settings" className="underline font-medium text-foreground">
                    Configure one in Settings &rarr;
                  </Link>
                </span>
              ) : (
                qaMutation.error.message
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      {/* Input Group with AI Elements Ergonomics */}
      <CardFooter className="p-3 border-t border-border/50 bg-muted/10 flex flex-col gap-2">
        {!canAsk ? (
          <div className="w-full py-2 px-3 rounded-lg border border-border/60 bg-muted/30 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <ShieldAlert className="size-4 text-amber-500" />
            <span>Sign in as an assessor or admin to submit AI queries for this finding.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-1.5">
            <div className="relative rounded-lg border border-border/70 bg-card focus-within:border-muted-foreground/40 focus-within:ring-1 focus-within:ring-border transition-colors p-2.5 flex flex-col gap-1.5">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about this finding's evidence, exploitability, or remediation..."
                rows={2}
                className="resize-none border-0 shadow-none focus-visible:ring-0 p-0 text-xs leading-relaxed bg-transparent min-h-[44px] text-foreground placeholder:text-muted-foreground"
                disabled={qaMutation.isPending}
              />
              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                <span className="hidden sm:inline">Press <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[9px] border border-border">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[9px] border border-border">Shift+Enter</kbd> for newline</span>
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim() || qaMutation.isPending}
                  className="size-7 rounded-md ml-auto shrink-0"
                  title="Send query"
                  aria-label="Send query"
                >
                  {qaMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </form>
        )}
      </CardFooter>
    </Card>
  )
}
