import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
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
  Maximize2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownContent } from "@/components/markdown-content"
import { useFindingQASession, type FindingQASession } from "@/hooks/use-finding-qa"
import { useAuth } from "@/lib/auth"
import {
  SEVERITY_CLASS,
  STATUS_CLASS,
  STATUS_LABEL,
  STATUS_VARIANT,
  capitalize,
  displayScore,
} from "@/lib/finding-style"
import type { ThreadMessage } from "@/lib/finding-qa"
import type { FindingDetail } from "@/lib/types"

const SUGGESTED_PROMPTS = [
  "Is this exploitable without auth?",
  "What specific evidence proves this?",
  "Provide web server config remediation",
  "What false-positive conditions could apply?",
]

type Variant = "inline" | "expanded"

function MessageTurn({
  message,
  index,
  copied,
  reasoningOpen,
  onCopy,
  onToggleReasoning,
  onCitation,
}: {
  message: ThreadMessage
  index: number
  copied: boolean
  reasoningOpen: boolean
  onCopy: (text: string, index: number) => void
  onToggleReasoning: (index: number) => void
  onCitation: (evidenceId: number) => void
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end pl-6" title={message.timestamp}>
        <div className="max-w-full whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-primary-foreground shadow-xs">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2.5" title={message.timestamp}>
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/60">
        <Sparkles className="size-3.5 text-primary" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">Analyst</span>
          {message.model && (
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {message.model}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onCopy(message.content, index)}
            className="ml-auto shrink-0 text-muted-foreground opacity-70 hover:opacity-100"
            title="Copy answer"
            aria-label="Copy answer"
          >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          </Button>
        </div>

        {/* Collapsible reasoning trace for thinking models */}
        {message.reasoning && (
          <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20">
            <button
              type="button"
              onClick={() => onToggleReasoning(index)}
              aria-expanded={reasoningOpen}
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Brain className="size-3" />
              <span>Reasoning</span>
              <ChevronDown
                className={cn("ml-auto size-3 transition-transform", reasoningOpen && "rotate-180")}
              />
            </button>
            {reasoningOpen && (
              <div className="max-h-52 overflow-y-auto whitespace-pre-wrap border-t border-border/40 px-2.5 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        <MarkdownContent
          content={message.content}
          onCitationClick={onCitation}
          className="text-foreground"
        />

        {message.grounded_evidence_ids && message.grounded_evidence_ids.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-500" />
            <span>Grounded in</span>
            {message.grounded_evidence_ids.map((evidenceId) => (
              <button
                key={evidenceId}
                type="button"
                onClick={() => onCitation(evidenceId)}
                className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:bg-muted"
                title={`Jump to Evidence #${evidenceId}`}
              >
                Evidence #{evidenceId}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyThread({
  expanded,
  canAsk,
  pending,
  onAsk,
}: {
  expanded: boolean
  canAsk: boolean
  pending: boolean
  onAsk: (question: string) => void
}) {
  if (!expanded) {
    return (
      <div className="space-y-3 py-1">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ask about exploitability, the evidence behind this finding, or how to fix it.
        </p>
        {canAsk && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={pending}
                onClick={() => onAsk(prompt)}
                className="inline-flex items-center rounded-full border border-border/80 bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-muted/40">
        <Sparkles className="size-5 text-primary" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-foreground">
        Investigate this finding
      </h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        Ask about exploitability, the evidence behind it, or how to fix it. Answers cite the
        evidence attached to this finding.
      </p>
      {canAsk && (
        <div className="mt-5 grid w-full max-w-xl gap-2 sm:grid-cols-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={pending}
              onClick={() => onAsk(prompt)}
              className="rounded-xl border border-border/80 bg-card px-3 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function QAThread({
  session,
  canAsk,
  variant,
  onAsk,
  onCitation,
}: {
  session: FindingQASession
  canAsk: boolean
  variant: Variant
  onAsk: (question: string) => void
  onCitation: (evidenceId: number) => void
}) {
  const expanded = variant === "expanded"
  const listRef = useRef<HTMLDivElement>(null)
  const { messages, pending, error, noProvider, retryLast, copy, copiedIdx } = session
  const { expandedReasoning, toggleReasoning } = session

  // Keep the newest turn in view without scrolling the page itself. The inline
  // and expanded threads keep independent scroll positions.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages.length, pending])

  return (
    <div
      ref={listRef}
      aria-live="polite"
      className={cn(
        "overflow-y-auto",
        expanded ? "min-h-0 flex-1 px-6 py-5" : "min-h-[160px] max-h-[440px] px-4 py-4",
      )}
    >
      <div
        className={cn(
          "mx-auto w-full",
          expanded
            ? "flex min-h-full max-w-3xl flex-col"
            : "",
          expanded && messages.length === 0 && "justify-center",
        )}
      >
        {messages.length === 0 ? (
          <EmptyThread expanded={expanded} canAsk={canAsk} pending={pending} onAsk={onAsk} />
        ) : (
          <div className="space-y-5">
            {messages.map((message, index) => (
              <MessageTurn
                key={index}
                message={message}
                index={index}
                copied={copiedIdx === index}
                reasoningOpen={Boolean(expandedReasoning[index])}
                onCopy={copy}
                onToggleReasoning={toggleReasoning}
                onCitation={onCitation}
              />
            ))}

            {pending && (
              <div className="flex gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/60">
                  <Sparkles className="size-3.5 animate-pulse text-primary" />
                </div>
                <div className="flex items-center gap-2 pt-1.5 text-xs text-muted-foreground">
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

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs">
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
                        error.message
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
    </div>
  )
}

function QAComposer({
  session,
  canAsk,
  variant,
  onSubmit,
  inputRef,
}: {
  session: FindingQASession
  canAsk: boolean
  variant: Variant
  onSubmit: (question: string) => void
  inputRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const { input, setInput, pending } = session
  const localRef = useRef<HTMLTextAreaElement>(null)
  const resolvedRef = inputRef ?? localRef

  // Grow the composer with its content, up to a readable cap.
  useEffect(() => {
    const el = resolvedRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [input, resolvedRef])

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault()
    onSubmit(input)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div
      className={cn(
        "border-t border-border/60 bg-muted/10",
        variant === "expanded" ? "px-6 py-4" : "p-3",
      )}
    >
      {!canAsk ? (
        <div
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center text-xs text-muted-foreground",
            variant === "expanded" && "mx-auto w-full max-w-3xl",
          )}
        >
          <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
          <span>Only assessors and admins can query the analyst.</span>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className={cn(
            "rounded-2xl border border-border/80 bg-card p-2 transition-colors focus-within:border-foreground/25",
            variant === "expanded" && "mx-auto w-full max-w-3xl",
          )}
        >
          <Textarea
            ref={resolvedRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about evidence, exploitability, or remediation"
            rows={1}
            aria-label="Ask the analyst a question"
            className={cn(
              "max-h-32 min-h-9 resize-none border-0 bg-transparent p-1.5 text-[13px] leading-relaxed shadow-none focus-visible:ring-0",
              variant === "expanded" && "min-h-10 py-2 sm:text-sm",
            )}
          />
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="hidden pl-1 text-xs text-muted-foreground sm:inline">
              Enter to send <span className="text-border">·</span> Shift+Enter for a new line
            </span>
            <Button
              type="submit"
              size="icon-sm"
              disabled={!input.trim() || pending}
              className="ml-auto size-8 shrink-0 rounded-full shadow-xs"
              title="Send message"
              aria-label="Send message"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
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
  const session = useFindingQASession(finding.id)
  const [expanded, setExpanded] = useState(false)
  const expandedInputRef = useRef<HTMLTextAreaElement>(null)
  const { messages, pending, clear } = session

  const ask = (question: string) => {
    if (canAsk) session.ask(question)
  }

  const jumpToEvidence = (evidenceId: number) => {
    const wasExpanded = expanded
    if (wasExpanded) setExpanded(false)
    onEvidenceCited?.(evidenceId)

    const reveal = () => {
      const el = document.getElementById(`evidence-${evidenceId}`)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        el.classList.add("ring-2", "ring-primary")
        window.setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2200)
      } else {
        toast.info(`Evidence #${evidenceId} is not attached to this finding`)
      }
    }

    // Let the dialog finish closing before moving the page behind it.
    if (wasExpanded) window.setTimeout(reveal, 220)
    else reveal()
  }

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/60">
            <Sparkles className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Ask the Analyst
              </h2>
              <Badge
                variant="outline"
                className="h-5 border-border/70 px-1.5 text-[10px] font-normal text-muted-foreground"
              >
                Grounded
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Answers cite this finding&apos;s evidence.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={clear}
                disabled={pending}
                className="text-muted-foreground hover:text-foreground"
                title={pending ? "Wait for the current answer" : "Clear conversation"}
                aria-label="Clear conversation"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground hover:text-foreground"
              title="Expand analyst"
              aria-label="Expand analyst"
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </div>
        </div>

        <QAThread
          session={session}
          canAsk={canAsk}
          variant="inline"
          onAsk={ask}
          onCitation={jumpToEvidence}
        />

        <QAComposer
          session={session}
          canAsk={canAsk}
          variant="inline"
          onSubmit={ask}
        />
      </Card>

      {/* Expanded workspace: same session, same thread, more room to read. */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="flex h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:h-[min(88vh,900px)] sm:max-w-5xl"
          onOpenAutoFocus={(event) => {
            // Focus the composer on pointer devices; on touch, let Radix keep
            // the keyboard closed until the user taps the input.
            if (window.matchMedia("(pointer: fine)").matches) {
              event.preventDefault()
              expandedInputRef.current?.focus()
            }
          }}
        >
          <DialogHeader className="gap-0 border-b border-border/60 px-5 pb-4 pt-5 pr-14 text-left sm:px-6 sm:pr-14">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/60">
                <Sparkles className="size-4 text-primary" />
              </div>
              <DialogTitle className="text-sm font-semibold tracking-tight">
                Ask the Analyst
              </DialogTitle>
              <Badge
                variant="outline"
                className="h-5 border-border/70 px-1.5 text-[10px] font-normal text-muted-foreground"
              >
                Grounded
              </Badge>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                Finding #{finding.id}
              </span>
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={clear}
                  disabled={pending}
                  className="text-muted-foreground hover:text-foreground"
                  title={pending ? "Wait for the current answer" : "Clear conversation"}
                  aria-label="Clear conversation"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>

            <DialogDescription className="sr-only">
              Ask questions grounded in this finding&apos;s evidence.
            </DialogDescription>

            <p className="mt-2 line-clamp-2 text-pretty text-base font-semibold leading-snug text-foreground">
              {finding.title}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className={SEVERITY_CLASS[finding.severity]}>
                {capitalize(finding.severity)}
              </Badge>
              <Badge
                variant={STATUS_VARIANT[finding.status]}
                className={STATUS_CLASS[finding.status]}
              >
                {STATUS_LABEL[finding.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">{finding.category}</span>
              <span className="text-xs text-muted-foreground/60" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-muted-foreground">
                {finding.evidence.length} evidence
              </span>
              <span
                className="ml-auto font-mono text-xs text-muted-foreground"
                title="Risk score"
              >
                {displayScore(finding.score, finding.severity)}/10
              </span>
            </div>
          </DialogHeader>

          <QAThread
            session={session}
            canAsk={canAsk}
            variant="expanded"
            onAsk={ask}
            onCitation={jumpToEvidence}
          />

          <div className="shrink-0">
            <QAComposer
              session={session}
              canAsk={canAsk}
              variant="expanded"
              onSubmit={ask}
              inputRef={expandedInputRef}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
