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
  Loader2,
  ExternalLink,
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
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { FindingDetail, FindingQAMessage, FindingQAResponse } from "@/lib/types"

const SUGGESTED_PROMPTS = [
  "Is this exploitable without auth?",
  "What specific evidence proves this?",
  "Provide web server config remediation",
  "What false-positive conditions could apply?",
]

function FormattedContent({
  content,
  onCitationClick,
}: {
  content: string
  onCitationClick?: (evidenceId: number) => void
}) {
  // Parse inline citations [Evidence #12] into interactive badges
  const parts = content.split(/(\[Evidence #\d+\])/g)

  return (
    <div className="space-y-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
      {parts.map((part, idx) => {
        const citationMatch = part.match(/^\[Evidence #(\d+)\]$/)
        if (citationMatch) {
          const evId = parseInt(citationMatch[1], 10)
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onCitationClick?.(evId)}
              className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
              title={`Jump to Evidence #${evId}`}
            >
              <ExternalLink className="size-2.5" />
              Evidence #{evId}
            </button>
          )
        }
        return <span key={idx}>{part}</span>
      })}
    </div>
  )
}

interface ThreadMessage extends FindingQAMessage {
  reasoning?: string | null
  model?: string
  grounded_evidence_ids?: number[]
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
      setMessages((prev) => [
        ...prev,
        { role: "user", content: question },
        {
          role: "assistant",
          content: data.answer,
          reasoning: data.reasoning,
          model: data.model,
          grounded_evidence_ids: data.grounded_evidence_ids,
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
      el.scrollIntoView({ behavior: "smooth" })
      el.classList.add("ring-2", "ring-primary")
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000)
    } else {
      toast.info(`Evidence #${evidenceId} is listed in the Evidence section`)
    }
  }

  return (
    <Card className="border-border shadow-sm flex flex-col">
      <CardHeader className="p-4 pb-3 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                Ask the Analyst
                <Badge variant="outline" className="text-[10px] font-mono py-0 text-muted-foreground">
                  Grounded Evidence Q&amp;A
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Query this finding with questions strictly grounded in attached evidence.
              </CardDescription>
            </div>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMessages([])}
              className="text-xs text-muted-foreground hover:text-foreground h-7 px-2"
              title="Clear session conversation"
            >
              <Trash2 className="size-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4 max-h-[480px] overflow-y-auto">
        {messages.length === 0 ? (
          <div className="py-6 flex flex-col items-center justify-center text-center">
            <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2.5">
              <Bot className="size-4.5" />
            </div>
            <p className="text-xs font-medium text-foreground">Interactive Finding Analysis</p>
            <p className="text-[11px] text-muted-foreground max-w-md mt-1 mb-4 leading-relaxed">
              Ask technical questions about headers, exploitability prerequisites, or remediation. Answers cite specific evidence and will not speculate.
            </p>

            {canAsk && (
              <div className="flex flex-wrap justify-center gap-1.5 max-w-lg">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt}
                    variant="outline"
                    size="xs"
                    disabled={qaMutation.isPending}
                    onClick={() => {
                      setInput(prompt)
                      qaMutation.mutate(prompt)
                    }}
                    className="text-[11px] h-7 font-normal text-muted-foreground hover:text-foreground"
                  >
                    <Sparkles className="size-3 mr-1 text-primary" />
                    {prompt}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3.5">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="size-4" />
                  </div>
                )}

                <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  {msg.role === "user" ? (
                    <div className="rounded-lg bg-primary text-primary-foreground px-3.5 py-2 text-xs leading-relaxed">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="rounded-lg border bg-card p-3.5 space-y-2.5 shadow-xs">
                      {/* Reasoning Collapsible for DeepSeek-R1 / Reasoning Models */}
                      {msg.reasoning && (
                        <div className="rounded border border-primary/20 bg-primary/5 p-2 text-xs">
                          <button
                            type="button"
                            onClick={() => toggleReasoning(idx)}
                            className="flex items-center justify-between w-full text-[11px] font-medium text-primary hover:underline"
                          >
                            <span className="flex items-center gap-1.5">
                              <Brain className="size-3.5" />
                              Reasoning Process
                            </span>
                            {expandedReasoning[idx] ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                          </button>
                          {expandedReasoning[idx] && (
                            <p className="mt-2 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed border-t border-primary/10 pt-2">
                              {msg.reasoning}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Main Answer */}
                      <FormattedContent
                        content={msg.content}
                        onCitationClick={handleCitationClick}
                      />

                      {/* Citations & Metadata Footer */}
                      <div className="flex items-center justify-between border-t pt-2 mt-2 text-[10px] text-muted-foreground">
                        <div className="flex items-center gap-2">
                          {msg.model && (
                            <span className="font-mono text-muted-foreground/80">{msg.model}</span>
                          )}
                          {msg.grounded_evidence_ids && msg.grounded_evidence_ids.length > 0 && (
                            <span className="text-emerald-500 font-medium flex items-center gap-1">
                              Grounded in {msg.grounded_evidence_ids.length} evidence item(s)
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopy(msg.content, idx)}
                          className="size-6 text-muted-foreground hover:text-foreground"
                          title="Copy answer"
                        >
                          {copiedIdx === idx ? (
                            <Check className="size-3 text-emerald-500" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="size-7 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                    <UserIcon className="size-4" />
                  </div>
                )}
              </div>
            ))}

            {qaMutation.isPending && (
              <div className="flex gap-2.5 items-start">
                <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bot className="size-4 animate-pulse" />
                </div>
                <div className="rounded-lg border bg-card p-3 space-y-1.5 shadow-xs">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span>Analyzing technical evidence...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {qaMutation.isError && (
          <Alert variant="destructive" className="py-2 px-3 text-xs">
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

      <CardFooter className="p-3 border-t bg-muted/10 flex flex-col gap-2">
        {!canAsk ? (
          <div className="w-full py-1 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            <ShieldAlert className="size-3.5" />
            <span>Sign in as an assessor or admin to submit AI queries.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this finding's evidence, exploitability, or remediation... (Enter to send)"
              rows={1}
              className="resize-none min-h-[38px] max-h-[120px] text-xs py-2 leading-relaxed"
              disabled={qaMutation.isPending}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || qaMutation.isPending}
              className="h-[38px] px-3 shrink-0"
            >
              {qaMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </Button>
          </form>
        )}
      </CardFooter>
    </Card>
  )
}
