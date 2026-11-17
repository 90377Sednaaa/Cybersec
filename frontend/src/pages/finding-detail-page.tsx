import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams, Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Download,
  FileText,
  ShieldAlert,
  ShieldCheck,
  Upload,
  ExternalLink,
  Terminal,
  Activity,
  Trash2,
  Server,
  Wrench,
} from "lucide-react"
import { cn } from "cn"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { FindingReview } from "@/pages/finding-review"
import { FindingQAPanel } from "@/components/finding-qa-panel"
import { api, apiBlob, getToken } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useShowShortcutHints } from "@/lib/shortcuts"
import {
  SEVERITY_CLASS,
  STATUS_CLASS,
  STATUS_LABEL,
  STATUS_VARIANT,
  capitalize,
  displayScore,
} from "@/lib/finding-style"
import type { Assessment, Evidence, EvidenceKind, Finding, FindingDetail, Target } from "@/lib/types"

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
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-"
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success("Copied to clipboard")
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-7 text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
      title="Copy raw text"
      aria-label="Copy raw text"
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

function EvidenceBlock({
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
  const [downloading, setDownloading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const Icon = KIND_ICON[item.kind] ?? FileText
  const lineCount = item.content ? item.content.split("\n").length : 0
  const collapsible = item.kind !== "upload" && (item.content.length > 900 || lineCount > 14)
  const label = item.label || KIND_LABEL[item.kind]

  const handleDownload = async () => {
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

  return (
    <div
      id={`evidence-${item.id}`}
      className="scroll-mt-24 overflow-hidden rounded-xl border bg-card transition-shadow"
    >
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground" title={label}>
            {label}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            <span>{KIND_LABEL[item.kind]}</span>
            {item.tool && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[10px]">{item.tool}</span>
              </>
            )}
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <span className="hidden sm:inline">{formatDate(item.captured_at)}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {item.content && item.kind !== "upload" && <CopyButton text={item.content} />}

          {canDelete &&
            (confirmDelete ? (
              <div className="ml-1 flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting}
                  className="h-6 px-2 text-[10px]"
                  onClick={() => {
                    onDelete(item.id)
                    setConfirmDelete(false)
                  }}
                >
                  Delete?
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground transition-colors hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                title="Delete this evidence item"
                aria-label="Delete this evidence item"
              >
                <Trash2 className="size-3.5" />
              </Button>
            ))}
        </div>
      </div>

      <div className="border-t bg-muted/15 p-3">
        {item.kind === "upload" ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-muted/30 p-3">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <FileText className="size-4 shrink-0 text-primary" />
              <span className="truncate">{item.label || "Uploaded file artifact"}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={downloading}
              onClick={handleDownload}
              className="shrink-0 text-xs"
            >
              <Download className="size-3.5" />
              {downloading ? "Downloading" : "Download"}
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <pre
                className={cn(
                  "overflow-auto whitespace-pre-wrap break-all rounded-md border border-zinc-800 bg-zinc-950 p-3.5 font-mono text-[11px] leading-relaxed text-zinc-100 selection:bg-primary/30",
                  collapsible && !expanded
                    ? "max-h-48"
                    : collapsible
                      ? "max-h-[70vh]"
                      : "max-h-96",
                )}
              >
                {item.content || "(No transcript content recorded)"}
              </pre>
              {collapsible && !expanded && (
                <div className="pointer-events-none absolute inset-x-px bottom-px h-14 rounded-b-md bg-gradient-to-t from-zinc-950 to-transparent" />
              )}
            </div>
            {collapsible && (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border bg-background py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {expanded ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                {expanded ? "Collapse output" : "Show full output"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MetaItem({
  label,
  value,
  mono,
  wrap,
}: {
  label: string
  value: string
  mono?: boolean
  wrap?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-xs font-medium text-foreground",
          mono && "font-mono",
          wrap ? "break-words" : "truncate",
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

export function FindingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const findingId = id ? parseInt(id, 10) : null
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [showHints] = useShowShortcutHints()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [expandedEvidence, setExpandedEvidence] = useState<Record<number, boolean>>({})

  // Query this specific finding
  const { data, isLoading, error } = useQuery({
    queryKey: ["finding", findingId],
    queryFn: () => api<FindingDetail>(`/api/findings/${findingId}`),
    enabled: findingId !== null && !isNaN(findingId),
  })

  // Query all findings to build Previous / Next stepping buttons
  const findingsQuery = useQuery({
    queryKey: ["findings", "all", "all", "all"],
    queryFn: () => api<Finding[]>("/api/findings"),
  })

  // Query assessments and targets for context attribution
  const assessmentsQuery = useQuery({
    queryKey: ["assessments"],
    queryFn: () => api<Assessment[]>("/api/assessments"),
  })

  const targetsQuery = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
  })

  const assessment = assessmentsQuery.data?.find((a) => a.id === data?.assessment_id)
  const target = targetsQuery.data?.find((t) => t.id === assessment?.target_id)

  // Mutation for uploading evidence
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      const token = getToken()
      const res = await fetch(`/api/findings/${findingId}/evidence`, {
        method: "POST",
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || "Failed to upload evidence file")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finding", findingId] })
      toast.success("Evidence file attached successfully")
      if (fileInputRef.current) fileInputRef.current.value = ""
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  // Mutation for deleting evidence
  const deleteEvidenceMutation = useMutation({
    mutationFn: async (evidenceId: number) => {
      await api(`/api/evidence/${evidenceId}`, { method: "DELETE" })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finding", findingId] })
      toast.success("Evidence item removed")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete evidence")
    },
  })

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File exceeds the 5 MB limit")
      return
    }
    uploadMutation.mutate(file)
  }

  // Calculate Prev / Next IDs
  const allFindings = findingsQuery.data ?? []
  const currentIndex = allFindings.findIndex((f) => f.id === findingId)
  const prevFinding = currentIndex > 0 ? allFindings[currentIndex - 1] : null
  const nextFinding = currentIndex !== -1 && currentIndex < allFindings.length - 1 ? allFindings[currentIndex + 1] : null

  // Keyboard navigation for ArrowLeft (Previous) and ArrowRight (Next)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (
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

      if (e.key === "ArrowLeft" && prevFinding) {
        e.preventDefault()
        navigate(`/findings/${prevFinding.id}`)
      } else if (e.key === "ArrowRight" && nextFinding) {
        e.preventDefault()
        navigate(`/findings/${nextFinding.id}`)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [prevFinding, nextFinding, navigate])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-10 w-2/3" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="lg:col-span-7 space-y-4">
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link to="/findings">
            <ArrowLeft className="size-4" /> Back to Findings
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Finding Not Found</AlertTitle>
          <AlertDescription>{error?.message || "Could not retrieve finding details."}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Top Navigation & Stepper Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-8">
            <Link to="/findings">
              <ArrowLeft className="size-4" />
              <span>Findings</span>
            </Link>
          </Button>
          <span className="h-3.5 w-px bg-border" aria-hidden="true" />
          <span className="font-mono font-semibold text-foreground">#{data.id}</span>
          {data.assessment_id && (
            <>
              <span className="text-muted-foreground/50" aria-hidden="true">
                /
              </span>
              <Link
                to={`/assessments/${data.assessment_id}`}
                className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                Assessment #{data.assessment_id}
                <ExternalLink className="size-3" />
              </Link>
            </>
          )}
          {target && (
            <>
              <span className="text-muted-foreground/50" aria-hidden="true">
                /
              </span>
              <Link
                to="/targets"
                className="flex min-w-0 items-center gap-1 font-medium text-foreground transition-colors hover:text-primary"
                title={target.base_url}
              >
                <Server className="size-3 shrink-0 text-primary" />
                <span className="truncate">{target.name}</span>
              </Link>
            </>
          )}
        </div>

        {/* Previous / Next Stepper */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={!prevFinding}
            onClick={() => prevFinding && navigate(`/findings/${prevFinding.id}`)}
            title={prevFinding ? `Previous: ${prevFinding.title} (←)` : "First finding"}
            className="text-xs"
          >
            <ChevronLeft className="size-4" />
            <span>Previous</span>
            {showHints && (
              <kbd className="ml-0.5 hidden rounded border bg-muted px-1 text-[9px] font-mono text-muted-foreground sm:inline-block">
                ←
              </kbd>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={!nextFinding}
            onClick={() => nextFinding && navigate(`/findings/${nextFinding.id}`)}
            title={nextFinding ? `Next: ${nextFinding.title} (→)` : "Last finding"}
            className="text-xs"
          >
            <span>Next</span>
            {showHints && (
              <kbd className="ml-0.5 hidden rounded border bg-muted px-1 text-[9px] font-mono text-muted-foreground sm:inline-block">
                →
              </kbd>
            )}
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Unconfirmed Candidate Alert */}
      {data.status === "ai_candidate" && (
        <Alert className="border-amber-500/30 bg-amber-500/5 text-foreground">
          <ShieldAlert className="size-4 text-amber-500" />
          <AlertTitle className="text-xs font-semibold text-amber-500">Unconfirmed AI Candidate</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed text-muted-foreground">
            Drafted from tool output and AI interpretation. It stays an unconfirmed candidate until an
            assessor verifies it.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        {/* Left Column: Finding Overview & Decision (5 cols on lg) */}
        <div className="space-y-4 lg:col-span-5">
          {/* Overview Card */}
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="gap-3 px-5 pb-4 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={SEVERITY_CLASS[data.severity]}>{capitalize(data.severity)}</Badge>
                <Badge variant={STATUS_VARIANT[data.status]} className={STATUS_CLASS[data.status]}>
                  {STATUS_LABEL[data.status]}
                </Badge>
                <span
                  className="ml-auto font-mono text-xs text-muted-foreground"
                  title="Risk score"
                  aria-label={`Risk score ${displayScore(data.score, data.severity)} out of 10`}
                >
                  {displayScore(data.score, data.severity)}
                  <span className="text-muted-foreground/70">/10</span>
                </span>
              </div>
              <CardTitle className="text-pretty text-xl font-semibold leading-snug tracking-tight text-foreground">
                {data.title}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4 px-5 pb-5">
              <p className="text-pretty text-[13px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {data.description || "No description provided."}
              </p>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border/70 bg-muted/20 p-3.5">
                <MetaItem
                  label="Target"
                  value={target?.name || (assessment ? `Target #${assessment.target_id}` : "-")}
                  wrap
                />
                <MetaItem label="Category" value={data.category || "-"} wrap />
                <MetaItem label="AI confidence" value={`${Math.round(data.ai_confidence * 100)}%`} />
                <MetaItem
                  label="Assessment"
                  value={data.assessment_id ? `#${data.assessment_id}` : "-"}
                  mono
                />
              </dl>

              {data.verified_by && (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0 text-emerald-500" />
                  <span>
                    {data.status === "false_positive" ? "Reviewed by" : "Verified by"}{" "}
                    <strong className="font-medium text-foreground">{data.verified_by}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDate(data.verified_at)}</span>
                </div>
              )}

              <div className="space-y-1.5 border-t pt-3.5">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Wrench className="size-3.5 text-primary" />
                  Remediation
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {data.remediation || "No remediation guidance available."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Review Decision Workflow */}
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="px-5 pb-3 pt-5">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck className="size-4 text-primary" />
                Assessor review
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <FindingReview key={data.id} finding={data} />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Evidence & Analyst (7 cols on lg) */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Evidence</h2>
              <span className="font-mono text-xs text-muted-foreground">{data.evidence.length}</span>
            </div>

            {/* Evidence Upload for Assessors */}
            {hasRole("admin", "assessor") && (
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileUpload}
                  accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.json,.xml,.zip"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs"
                >
                  <Upload className="size-3.5" />
                  {uploadMutation.isPending ? "Uploading" : "Attach evidence"}
                </Button>
              </div>
            )}
          </div>

          {data.evidence.length === 0 ? (
            <Card className="border-dashed bg-transparent py-0 shadow-none">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Terminal className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">No evidence attached yet</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Scans attach HTTP transcripts and tool output automatically. Assessors can also upload files.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {data.evidence.map((item) => (
                <EvidenceBlock
                  key={item.id}
                  item={item}
                  canDelete={hasRole("admin", "assessor")}
                  onDelete={(evidenceId) => deleteEvidenceMutation.mutate(evidenceId)}
                  isDeleting={deleteEvidenceMutation.isPending}
                  expanded={Boolean(expandedEvidence[item.id])}
                  onToggle={() =>
                    setExpandedEvidence((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                  }
                />
              ))}
            </div>
          )}

          <FindingQAPanel
            key={data.id}
            finding={data}
            onEvidenceCited={(evidenceId) =>
              setExpandedEvidence((prev) => ({ ...prev, [evidenceId]: true }))
            }
          />
        </div>
      </div>
    </div>
  )
}
