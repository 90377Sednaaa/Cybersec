import { useState, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams, Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Download,
  FileText,
  Lock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Upload,
  ExternalLink,
  Terminal,
  Activity,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { FindingReview } from "@/pages/finding-review"
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
import type { Evidence, EvidenceKind, Finding, FindingDetail } from "@/lib/types"

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
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
      title="Copy raw text"
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

function EvidenceBlock({ item }: { item: Evidence }) {
  const [downloading, setDownloading] = useState(false)
  const Icon = KIND_ICON[item.kind] ?? FileText

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
    <div className="rounded-lg border bg-card/60 transition-colors">
      <div className="flex items-center justify-between border-b px-4 py-2.5 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 text-primary shrink-0" />
          <span className="font-medium text-xs truncate text-foreground">
            {item.label || KIND_LABEL[item.kind]}
          </span>
          {item.tool && (
            <Badge variant="outline" className="text-[10px] font-mono py-0 shrink-0">
              {item.tool}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            {formatDate(item.captured_at)}
          </span>
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {KIND_LABEL[item.kind]}
          </Badge>
          {item.content && <CopyButton text={item.content} />}
        </div>
      </div>

      <div className="p-3">
        {item.kind === "upload" ? (
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-dashed">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="size-4 text-primary" />
              <span>{item.label || "Uploaded file artifact"}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={downloading}
              onClick={handleDownload}
              className="text-xs"
            >
              <Download className="size-3.5 mr-1.5" />
              {downloading ? "Downloading…" : "Download file"}
            </Button>
          </div>
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-zinc-950 p-3.5 font-mono text-xs text-zinc-100 border border-zinc-800 leading-relaxed selection:bg-primary/30">
            {item.content || "(No transcript content recorded)"}
          </pre>
        )}
      </div>
    </div>
  )
}

export function FindingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const findingId = id ? parseInt(id, 10) : null
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Mutation for uploading evidence
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch(`/api/findings/${findingId}/evidence`, {
        method: "POST",
        body: formData,
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
        },
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-10 w-2/3" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="lg:col-span-6 space-y-4">
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
            <ArrowLeft className="size-4 mr-1.5" /> Back to Findings
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
    <div className="space-y-6">
      {/* Top Navigation & Stepper Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/findings">
              <ArrowLeft className="size-4 mr-1.5" />
              <span>Findings</span>
            </Link>
          </Button>
          <Separator orientation="vertical" className="!h-4" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Finding</span>
            <span className="font-mono font-semibold text-foreground">#{data.id}</span>
            {data.assessment_id && (
              <>
                <span>•</span>
                <Link
                  to={`/assessments/${data.assessment_id}`}
                  className="hover:text-primary transition-colors hover:underline flex items-center gap-1"
                >
                  Assessment #{data.assessment_id}
                  <ExternalLink className="size-3" />
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Previous / Next Stepper */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={!prevFinding}
            onClick={() => prevFinding && navigate(`/findings/${prevFinding.id}`)}
            title={prevFinding ? `Previous: ${prevFinding.title}` : "First finding"}
          >
            <ChevronLeft className="size-4 mr-1" />
            <span>Previous</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={!nextFinding}
            onClick={() => nextFinding && navigate(`/findings/${nextFinding.id}`)}
            title={nextFinding ? `Next: ${nextFinding.title}` : "Last finding"}
          >
            <span>Next</span>
            <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </div>

      {/* Unconfirmed Candidate Alert */}
      {data.status === "ai_candidate" && (
        <Alert className="border-amber-500/30 bg-amber-500/5 text-foreground">
          <ShieldAlert className="size-4 text-amber-500" />
          <AlertTitle className="text-amber-500 font-semibold text-xs">
            Unconfirmed AI Candidate
          </AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
            This finding was drafted automatically by security tooling and AI interpretation. It remains strictly an unconfirmed candidate until verified by an assessor.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Finding Overview & Decision (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Header Card */}
          <Card>
            <CardHeader className="space-y-3 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={SEVERITY_CLASS[data.severity]}>{capitalize(data.severity)}</Badge>
                <Badge variant={STATUS_VARIANT[data.status]} className={STATUS_CLASS[data.status]}>
                  {STATUS_LABEL[data.status]}
                </Badge>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  Score: <strong className="text-foreground">{displayScore(data.score, data.severity)}</strong>/10
                </span>
              </div>
              <CardTitle className="text-xl font-bold tracking-tight text-foreground leading-snug">
                {data.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Description
                </p>
                <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {data.description || "No description provided."}
                </p>
              </div>

              <Separator />

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Category
                  </p>
                  <p className="font-medium text-foreground">{data.category || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    AI Confidence
                  </p>
                  <p className="font-medium text-foreground">{Math.round(data.ai_confidence * 100)}%</p>
                </div>
              </div>

              <Separator />

              {/* Assessor Attribution */}
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Verification Status
                </p>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  {data.verified_by ? (
                    <>
                      <ShieldCheck className="size-3.5 text-emerald-500" />
                      <span>
                        Verified by <strong className="text-foreground">{data.verified_by}</strong> on {formatDate(data.verified_at)}
                      </span>
                    </>
                  ) : (
                    <>
                      <Shield className="size-3.5 text-muted-foreground/70" />
                      <span>Awaiting assessor decision</span>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Remediation Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Remediation Guidance</CardTitle>
              <CardDescription className="text-xs">Recommended fix for development team</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {data.remediation || "No remediation guidance available."}
            </CardContent>
          </Card>

          {/* Review Decision Workflow */}
          <Card className="border-primary/20 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Lock className="size-3.5 text-primary" />
                Assessor Verification Workflow
              </CardTitle>
              <CardDescription className="text-xs">
                Submit finding confirmation, reject false positive, or request additional proof.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FindingReview finding={data} />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Evidence & Transcripts (7 cols on lg) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Evidence &amp; Transcripts
              </h2>
              <Badge variant="outline" className="font-mono text-xs">
                {data.evidence.length}
              </Badge>
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
                  <Upload className="size-3.5 mr-1.5" />
                  {uploadMutation.isPending ? "Uploading…" : "Attach Evidence"}
                </Button>
              </div>
            )}
          </div>

          {data.evidence.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 flex flex-col items-center justify-center text-center">
                <div className="size-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
                  <Terminal className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">No evidence attached yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  Evidence is automatically collected during security scans (HTTP transcripts, port maps) or manually uploaded by assessors.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {data.evidence.map((item) => (
                <EvidenceBlock key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
