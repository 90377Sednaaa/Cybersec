import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileText,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"

import { FindingQAPanel } from "@/components/finding-qa-panel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, apiBlob } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import {
  SEVERITY_CLASS,
  STATUS_CLASS,
  STATUS_LABEL,
  STATUS_VARIANT,
  capitalize,
  displayScore,
} from "@/lib/finding-style"
import type { Evidence, EvidenceKind, FindingDetail } from "@/lib/types"
import { FindingReview } from "@/pages/finding-review"

const KIND_LABEL: Record<EvidenceKind, string> = {
  http_transcript: "HTTP transcript",
  tool_output: "Tool output",
  upload: "Uploaded file",
}

const KIND_ICON: Record<EvidenceKind, typeof Terminal> = {
  http_transcript: Terminal,
  tool_output: Activity,
  upload: FileText,
}

function formatDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "-"
}

function EvidenceCard({
  item,
  canDelete,
  onDelete,
  isDeleting,
  expanded,
  onToggle,
}: {
  item: Evidence
  canDelete: boolean
  onDelete: (id: number) => void
  isDeleting: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const Icon = KIND_ICON[item.kind] ?? FileText
  const lineCount = item.content ? item.content.split("\n").length : 0
  const collapsible = item.kind !== "upload" && (item.content.length > 700 || lineCount > 12)
  const label = item.label || KIND_LABEL[item.kind]

  async function handleDownload() {
    try {
      setDownloading(true)
      const blob = await apiBlob(`/api/evidence/${item.id}/download`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = item.label || `evidence-${item.id}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Failed to download evidence file")
    } finally {
      setDownloading(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(item.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
    toast.success("Copied to clipboard")
  }

  return (
    <div id={`evidence-${item.id}`} className="scroll-mt-16 overflow-hidden rounded-lg border bg-card">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground" title={label}>
            {label}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{KIND_LABEL[item.kind]}</span>
            {item.tool && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{item.tool}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{formatDate(item.captured_at)}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {item.content && item.kind !== "upload" && (
            <Button variant="ghost" size="icon-xs" onClick={handleCopy} aria-label="Copy evidence">
              {copied ? <Check className="text-primary" /> : <Copy />}
            </Button>
          )}
          {canDelete &&
            (confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="xs"
                  disabled={isDeleting}
                  onClick={() => {
                    onDelete(item.id)
                    setConfirmDelete(false)
                  }}
                >
                  Delete?
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete evidence"
              >
                <Trash2 />
              </Button>
            ))}
        </div>
      </div>

      <Separator />

      <div className="bg-muted/20 p-3.5">
        {item.kind === "upload" ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-background p-3">
            <span className="truncate text-xs text-muted-foreground">{item.label || "Uploaded artifact"}</span>
            <Button size="xs" variant="outline" disabled={downloading} onClick={handleDownload}>
              <Download data-icon="inline-start" />
              {downloading ? "Downloading..." : "Download"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <pre
              className={cn(
                "overflow-auto whitespace-pre-wrap break-all rounded-md border bg-background p-3 font-mono text-xs leading-relaxed text-foreground",
                collapsible && !expanded ? "max-h-44" : "max-h-[55vh]",
              )}
            >
              {item.content || "(empty)"}
            </pre>
            {collapsible && (
              <Button variant="ghost" size="xs" onClick={onToggle} className="w-full text-muted-foreground">
                {expanded ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
                {expanded ? "Collapse output" : "Show full output"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export interface FindingTriageSheetProps {
  findingId: number | null
  queueIds: number[]
  fromHref: string
  onSelectFinding: (nextId: number | null) => void
}

export function FindingTriageSheet({
  findingId,
  queueIds,
  fromHref,
  onSelectFinding,
}: FindingTriageSheetProps) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState("overview")
  const [expandedEvidence, setExpandedEvidence] = useState<Record<number, boolean>>({})
  const [autoAdvance, setAutoAdvance] = useState(true)

  const { data, isLoading, error } = useQuery({
    queryKey: ["finding", findingId],
    queryFn: () => api<FindingDetail>(`/api/findings/${findingId}`),
    enabled: findingId !== null,
  })

  const currentIdx = findingId !== null ? queueIds.indexOf(findingId) : -1
  const prevId = currentIdx > 0 ? queueIds[currentIdx - 1] : null
  const nextId = currentIdx !== -1 && currentIdx < queueIds.length - 1 ? queueIds[currentIdx + 1] : null

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      return api<Evidence>(`/api/findings/${findingId}/evidence`, {
        method: "POST",
        body: formData,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finding", findingId] })
      toast.success("Evidence attached")
      if (fileInputRef.current) fileInputRef.current.value = ""
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteEvidenceMutation = useMutation({
    mutationFn: (evidenceId: number) => api<void>(`/api/evidence/${evidenceId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finding", findingId] })
      toast.success("Evidence removed")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // Keyboard stepping inside the open triage sheet when not typing.
  useEffect(() => {
    if (findingId === null) return
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (
        !el ||
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return
      }
      if (e.key === "ArrowLeft" && prevId !== null) {
        e.preventDefault()
        onSelectFinding(prevId)
      } else if (e.key === "ArrowRight" && nextId !== null) {
        e.preventDefault()
        onSelectFinding(nextId)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [findingId, prevId, nextId, onSelectFinding])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File exceeds the 5 MB limit")
      return
    }
    uploadMutation.mutate(file)
  }

  return (
    <Sheet
      open={findingId !== null}
      onOpenChange={(open) => {
        if (!open) onSelectFinding(null)
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl lg:max-w-3xl"
      >
        {/* Top bar */}
        <SheetHeader className="gap-3 border-b px-6 py-5 pr-12">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-muted-foreground">
                {findingId ? `#${findingId}` : ""}
              </span>
              {currentIdx !== -1 && (
                <Badge variant="outline" className="font-mono text-xs font-normal tabular-nums">
                  {currentIdx + 1} / {queueIds.length}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                disabled={prevId === null}
                onClick={() => prevId !== null && onSelectFinding(prevId)}
                aria-label="Previous finding"
              >
                <ChevronLeft data-icon="inline-start" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={nextId === null}
                onClick={() => nextId !== null && onSelectFinding(nextId)}
                aria-label="Next finding"
              >
                Next
                <ChevronRight data-icon="inline-end" />
              </Button>
              {findingId !== null && (
                <Button variant="ghost" size="xs" asChild>
                  <Link
                    to={`/findings/${findingId}`}
                    state={{ from: fromHref, queueIds }}
                    onClick={() => onSelectFinding(null)}
                  >
                    Full view
                    <ExternalLink data-icon="inline-end" />
                  </Link>
                </Button>
              )}
            </div>
          </div>

          <SheetTitle className="text-pretty text-lg font-semibold leading-snug tracking-tight">
            {data?.title ?? (isLoading ? "Loading finding..." : `Finding #${findingId}`)}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Inspect finding evidence, consult the analyst, and record your verification decision.
          </SheetDescription>

          {data && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={SEVERITY_CLASS[data.severity]}>{capitalize(data.severity)}</Badge>
              <Badge variant={STATUS_VARIANT[data.status]} className={STATUS_CLASS[data.status]}>
                {STATUS_LABEL[data.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">{data.category}</span>
              <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                Score {displayScore(data.score, data.severity)}/10
              </span>
            </div>
          )}
        </SheetHeader>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isLoading && (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-9 w-72" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-44 w-full" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          {data && (
            <Tabs
              key={data.id}
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex flex-col gap-5"
            >
              <TabsList variant="line" className="w-full justify-start border-b pb-0">
                <TabsTrigger value="overview" className="flex-none px-3 pb-2.5">
                  Overview &amp; Review
                </TabsTrigger>
                <TabsTrigger value="evidence" className="flex-none px-3 pb-2.5">
                  Evidence
                  <Badge variant="secondary" className="ml-1 font-mono text-xs">
                    {data.evidence.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="qa" className="flex-none px-3 pb-2.5">
                  Ask the Analyst
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="flex flex-col gap-5 pt-1">
                {data.status === "ai_candidate" && (
                  <Alert>
                    <ShieldAlert />
                    <AlertDescription>
                      Unconfirmed candidate. Only an assessor verifying this finding marks it as confirmed.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Description
                  </h3>
                  <p className="max-w-[70ch] whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {data.description || "No description provided."}
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Category</dt>
                    <dd className="text-xs font-medium text-foreground">{data.category || "-"}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">AI confidence</dt>
                    <dd className="font-mono text-xs font-medium tabular-nums text-foreground">
                      {Math.round(data.ai_confidence * 100)}%
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Assessment</dt>
                    <dd className="font-mono text-xs font-medium text-foreground">
                      {data.assessment_id ? `#${data.assessment_id}` : "-"}
                    </dd>
                  </div>
                </dl>

                {data.verified_by && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5 text-primary" />
                    <span>
                      {data.status === "false_positive" ? "Reviewed by" : "Verified by"}{" "}
                      <strong className="font-medium text-foreground">{data.verified_by}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(data.verified_at)}</span>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Wrench className="size-3.5 text-primary" />
                    Remediation
                  </h3>
                  <p className="max-w-[70ch] whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {data.remediation || "No remediation guidance available."}
                  </p>
                </div>

                <Separator />

                <div className="flex flex-col gap-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <ShieldCheck className="size-4 text-primary" />
                    Assessor review
                  </h3>
                  <FindingReview
                    key={`sheet-review-${data.id}`}
                    finding={data}
                    hasNext={nextId !== null}
                    onAdvance={() => nextId !== null && onSelectFinding(nextId)}
                    autoAdvance={autoAdvance}
                    onAutoAdvanceChange={setAutoAdvance}
                  />
                </div>
              </TabsContent>

              <TabsContent value="evidence" className="flex flex-col gap-4 pt-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Auto-captured tool outputs, HTTP transcripts, and assessor uploads.
                  </p>
                  {hasRole("admin", "assessor") && (
                    <>
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={handleFileChange}
                        accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.json,.xml,.zip"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={uploadMutation.isPending}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload data-icon="inline-start" />
                        {uploadMutation.isPending ? "Uploading..." : "Attach file"}
                      </Button>
                    </>
                  )}
                </div>

                {data.evidence.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
                    <Terminal className="size-6 text-muted-foreground" />
                    <p className="text-sm font-medium">No evidence attached yet</p>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      Scan tools attach transcripts automatically, or you can upload supporting files above.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {data.evidence.map((item) => (
                      <EvidenceCard
                        key={item.id}
                        item={item}
                        canDelete={hasRole("admin", "assessor")}
                        onDelete={(id) => deleteEvidenceMutation.mutate(id)}
                        isDeleting={deleteEvidenceMutation.isPending}
                        expanded={Boolean(expandedEvidence[item.id])}
                        onToggle={() =>
                          setExpandedEvidence((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                        }
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="qa" className="pt-1">
                <FindingQAPanel
                  key={`sheet-qa-${data.id}`}
                  finding={data}
                  onEvidenceCited={(evidenceId) => {
                    setActiveTab("evidence")
                    setExpandedEvidence((prev) => ({ ...prev, [evidenceId]: true }))
                  }}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
