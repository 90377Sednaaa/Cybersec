import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  FileUp,
  ListOrdered,
  RotateCw,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/empty-state"
import { FindingTriageSheet } from "@/components/finding-triage-sheet"
import { ImportScanDialog } from "@/components/import-scan-dialog"
import { QuickAssessmentDialog } from "@/components/quick-assessment-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, apiWithMeta } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import {
  SEVERITIES,
  SEVERITY_CLASS,
  SEVERITY_WEIGHT,
  STATUS_CLASS,
  STATUS_SHORT_LABEL,
  STATUS_VARIANT as FINDING_STATUS_VARIANT,
  capitalize,
  displayScore,
} from "@/lib/finding-style"
import { useScanEvents } from "@/lib/scan-events"
import type {
  AssessmentDetail,
  AssessmentStatus,
  Finding,
  InterpretResult,
  Job,
  JobStatus,
  PrioritizationResult,
  PriorityEntry,
  Target,
} from "@/lib/types"
import { AssessmentReports } from "@/pages/assessment-reports"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

const STATUS_VARIANT: Record<AssessmentStatus | JobStatus, BadgeVariant> = {
  draft: "outline",
  pending: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-"
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

const BAR_CLASS: Record<string, string> = {
  completed: "bg-primary",
  running: "bg-primary animate-pulse motion-reduce:animate-none",
  failed: "bg-destructive",
  pending: "bg-muted-foreground/30",
  cancelled: "bg-muted-foreground/40",
  draft: "bg-muted-foreground/30",
}

function JobTimeline({
  jobs,
  runStartedAt,
  runFinishedAt,
  now,
}: {
  jobs: Job[]
  runStartedAt: string | null
  runFinishedAt: string | null
  now: number | null
}) {
  const parse = (iso: string | null) => (iso ? new Date(iso).getTime() : null)
  const starts = jobs.map((job) => parse(job.started_at)).filter((t): t is number => t !== null)
  const ends = jobs.map((job) => parse(job.finished_at)).filter((t): t is number => t !== null)

  const origin = parse(runStartedAt) ?? (starts.length > 0 ? Math.min(...starts) : null)
  if (origin === null) {
    return <p className="text-sm text-muted-foreground">No timing recorded yet.</p>
  }
  const latest = parse(runFinishedAt) ?? (ends.length > 0 ? Math.max(...ends) : null)
  const active = runFinishedAt === null
  const finish = Math.max(latest ?? 0, active ? (now ?? 0) : 0, origin + 1)
  const span = finish - origin

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2">
        {jobs.map((job) => {
          const start = parse(job.started_at)
          const end = parse(job.finished_at) ?? (job.status === "running" ? (now ?? start) : null)
          const queued = start === null
          const left = queued ? 0 : ((start - origin) / span) * 100
          const width = queued ? 100 : Math.max((((end ?? start) - start) / span) * 100, 1.5)
          return (
            <div key={job.id} className="flex items-center gap-3">
              <span className="w-16 shrink-0 truncate font-mono text-xs text-muted-foreground" title={job.tool}>
                {job.tool}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted/50">
                <div
                  className={`absolute inset-y-0 rounded ${queued ? "bg-muted-foreground/15" : (BAR_CLASS[job.status] ?? "bg-primary")}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={queued ? `${job.tool}: queued` : `${job.tool}: ${formatDuration((end ?? start) - start)}`}
                />
                {queued && (
                  <span className="absolute inset-0 flex items-center px-2 text-xs text-muted-foreground">
                    queued
                  </span>
                )}
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {queued ? "-" : formatDuration((end ?? start) - start)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between pl-19 font-mono text-xs tabular-nums text-muted-foreground">
        <span>{formatTime(origin)}</span>
        <span>{formatTime(finish)}</span>
      </div>
    </div>
  )
}

function JobRow({
  job,
  canRetry,
  isRetrying,
  disabled,
  onRetry,
}: {
  job: Job
  canRetry: boolean
  isRetrying: boolean
  disabled: boolean
  onRetry: () => void
}) {
  const percent = Math.round(job.progress * 100)
  const failedOrCancelled = job.status === "failed" || job.status === "cancelled"
  return (
    <div className="flex flex-col gap-2 py-3.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{job.tool}</span>
        <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{percent}%</span>
        {canRetry && (
          <Button
            type="button"
            size="xs"
            variant={failedOrCancelled ? "outline" : "ghost"}
            disabled={disabled}
            onClick={onRetry}
            title={failedOrCancelled ? `Retry ${job.tool} only` : `Re-run ${job.tool} only`}
          >
            {isRetrying ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCw data-icon="inline-start" />
            )}
            {isRetrying ? "Starting..." : failedOrCancelled ? "Retry" : "Re-run"}
          </Button>
        )}
      </div>
      {(job.status === "running" || job.status === "pending") && (
        <Progress value={percent} aria-label={`${job.tool} progress`} className="h-1.5" />
      )}
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>Started {formatDate(job.started_at)}</span>
        <span>Finished {formatDate(job.finished_at)}</span>
      </div>
      {job.command && <p className="break-all font-mono text-xs text-muted-foreground">{job.command}</p>}
    </div>
  )
}

function TerminalStatusBadge({ status }: { status: AssessmentStatus }) {
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <AlertCircle className="size-3" />
        Failed
      </Badge>
    )
  }
  if (status === "cancelled") {
    return (
      <Badge variant="outline" className="gap-1.5">
        <Ban className="size-3" />
        Cancelled
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1.5">
      <CheckCircle2 className="size-3 text-primary" />
      Completed
    </Badge>
  )
}

type RunTab = "pipeline" | "findings" | "report"
type QueueFilter = "needs_review" | "verified" | "all"

export function AssessmentRunPage() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const assessmentId = Number(id)
  const validId = Number.isInteger(assessmentId) && assessmentId > 0

  const tabParam = searchParams.get("tab")
  const activeTab: RunTab =
    tabParam === "findings" || tabParam === "report" || tabParam === "pipeline" ? tabParam : "pipeline"

  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)

  const [logToolFilter, setLogToolFilter] = useState("all")
  const [copiedLog, setCopiedLog] = useState(false)
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("needs_review")
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null)
  const [rerunOpen, setRerunOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["assessment", assessmentId],
    queryFn: () => api<AssessmentDetail>(`/api/assessments/${assessmentId}`),
    enabled: validId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  })

  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
    enabled: validId,
  })
  const target = targets.data?.find((item) => item.id === data?.target_id)

  const runFindings = useQuery({
    queryKey: ["findings", "run", assessmentId],
    queryFn: () => apiWithMeta<Finding[]>(`/api/findings?assessment_id=${assessmentId}&limit=200`),
    enabled: validId,
  })

  const prioritizationQuery = useQuery({
    queryKey: ["prioritization", assessmentId],
    queryFn: () => api<PrioritizationResult>(`/api/assessments/${assessmentId}/prioritization`),
    enabled: validId,
  })

  const prioritize = useMutation({
    mutationFn: () => api<PrioritizationResult>(`/api/assessments/${assessmentId}/prioritize`, { method: "POST" }),
    onSuccess: (res) => {
      queryClient.setQueryData(["prioritization", assessmentId], res)
      toast.success(`AI ranked ${res.rankings.length} active findings by exploitability and impact`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "AI prioritization failed"),
  })

  const isFinished = data?.status === "completed" || data?.status === "failed" || data?.status === "cancelled"
  const shouldStream = validId && data !== undefined && !isFinished

  const { lines, connected } = useScanEvents(
    validId ? assessmentId : null,
    (event) => {
      if (event.type !== "log") {
        queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] })
        queryClient.invalidateQueries({ queryKey: ["assessments"] })
        queryClient.invalidateQueries({ queryKey: ["findings"] })
      }
    },
    { enabled: shouldStream },
  )

  const cancel = useMutation({
    mutationFn: () => api<{ status: string }>(`/api/assessments/${assessmentId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] })
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
      toast.success("Run cancellation requested")
    },
  })

  const rerunAI = useMutation({
    mutationFn: () => api<InterpretResult>(`/api/assessments/${assessmentId}/interpret`, { method: "POST" }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] })
      queryClient.invalidateQueries({ queryKey: ["findings"] })
      toast.success(
        res.created > 0
          ? `AI added ${res.created} new candidate ${res.created === 1 ? "finding" : "findings"}`
          : "AI interpretation finished with no additional findings",
      )
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "AI interpretation failed"),
  })

  const retryJob = useMutation({
    mutationFn: (job: Job) =>
      api<AssessmentDetail>(`/api/assessments/${assessmentId}/jobs/${job.id}/retry`, { method: "POST" }),
    onSuccess: (updated, job) => {
      queryClient.setQueryData(["assessment", assessmentId], updated)
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
      toast.success(`Retrying ${job.tool}...`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to retry tool"),
  })

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  const finishedJobs =
    data?.jobs.filter((j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled").length ?? 0
  const jobTool = useMemo(() => new Map(data?.jobs.map((j) => [j.id, j.tool])), [data?.jobs])
  const canManage = hasRole("admin", "assessor")

  const jobs = data?.jobs
  const displayLines = useMemo(() => {
    if (lines.length > 0) {
      return lines.map((line) => ({
        id: String(line.id),
        tool: line.jobId === null ? "ai" : (jobTool.get(line.jobId) ?? `job ${line.jobId}`),
        text: line.text,
      }))
    }
    const parsed: { id: string; tool: string; text: string }[] = []
    if (jobs) {
      for (const job of jobs) {
        if (!job.log) continue
        const rawLines = job.log.split("\n")
        for (let i = 0; i < rawLines.length; i++) {
          const text = rawLines[i].trim()
          if (text) {
            parsed.push({ id: `persisted-${job.id}-${i}`, tool: job.tool, text })
          }
        }
      }
    }
    return parsed
  }, [lines, jobs, jobTool])

  const logTools = useMemo(() => {
    const seen = new Set<string>()
    for (const line of displayLines) seen.add(line.tool)
    return Array.from(seen)
  }, [displayLines])

  const visibleLines = useMemo(() => {
    if (logToolFilter === "all") return displayLines
    return displayLines.filter((line) => line.tool === logToolFilter)
  }, [displayLines, logToolFilter])

  function handleCopyLog() {
    const fullText = visibleLines.map((l) => `[${l.tool}] ${l.text}`).join("\n")
    navigator.clipboard.writeText(fullText)
    setCopiedLog(true)
    setTimeout(() => setCopiedLog(false), 2000)
  }

  function setTab(next: RunTab) {
    setSearchParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === "pipeline") updated.delete("tab")
        else updated.set("tab", next)
        return updated
      },
      { replace: true },
    )
  }

  const priorityByFindingId = useMemo(() => {
    const map = new Map<number, PriorityEntry>()
    for (const entry of prioritizationQuery.data?.rankings ?? []) {
      map.set(entry.finding_id, entry)
    }
    return map
  }, [prioritizationQuery.data])

  const runFindingRows = useMemo(() => runFindings.data?.data ?? [], [runFindings.data?.data])
  const runFindingTotal = runFindings.data?.totalCount ?? runFindingRows.length
  const rankedFindings = useMemo(
    () =>
      [...runFindingRows].sort((a, b) => {
        const rankA = priorityByFindingId.get(a.id)?.rank
        const rankB = priorityByFindingId.get(b.id)?.rank
        if (rankA !== undefined && rankB !== undefined) return rankA - rankB
        if (rankA !== undefined) return -1
        if (rankB !== undefined) return 1
        return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.score - a.score
      }),
    [runFindingRows, priorityByFindingId],
  )

  const needsReviewRows = useMemo(
    () => rankedFindings.filter((f) => f.status === "ai_candidate" || f.status === "needs_evidence"),
    [rankedFindings],
  )
  const verifiedRows = useMemo(() => rankedFindings.filter((f) => f.status === "verified"), [rankedFindings])

  const filteredRunFindings = useMemo(() => {
    if (queueFilter === "needs_review") return needsReviewRows
    if (queueFilter === "verified") return verifiedRows
    return rankedFindings
  }, [queueFilter, needsReviewRows, verifiedRows, rankedFindings])

  const triageQueueIds = useMemo(() => filteredRunFindings.map((f) => f.id), [filteredRunFindings])
  const nextCandidate = needsReviewRows[0] ?? null
  const severityCounts = SEVERITIES.map((severity) => ({
    severity,
    count: runFindingRows.filter((finding) => finding.severity === severity).length,
  })).filter((entry) => entry.count > 0)

  const hasCompletedJob = data?.jobs.some((j) => j.status === "completed") ?? false
  const findingsHref = `/findings?assessment=${assessmentId}`

  if (!validId) {
    return (
      <div className="flex flex-col gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link to="/assessments">
            <ArrowLeft data-icon="inline-start" />
            Assessments
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>Assessment #{id} is not a valid run identifier.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Workstation Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">Assessment #{assessmentId}</h1>
              {data && <Badge variant={STATUS_VARIANT[data.status]}>{data.status}</Badge>}
              {data && (
                <Badge variant={data.intensity === "full_intrusive" ? "destructive" : "secondary"}>
                  {data.intensity === "full_intrusive" ? "Full / intrusive" : "Passive / safe"}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {target ? `${target.name} (${target.base_url})` : data ? `Target #${data.target_id}` : "Loading run details..."}
              {data && ` · ${finishedJobs} of ${data.jobs.length} jobs finished`}
              {data?.started_at && ` · started ${formatDate(data.started_at)}`}
            </p>
          </div>

          {data && canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {data.status === "running" ? (
                <Button variant="destructive" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  {cancel.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {cancel.isPending ? "Cancelling..." : "Cancel run"}
                </Button>
              ) : (
                <>
                  {hasCompletedJob && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rerunAI.isPending}
                      onClick={() => rerunAI.mutate()}
                    >
                      {rerunAI.isPending ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
                      {rerunAI.isPending ? "Analyzing..." : "Re-run AI"}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                    <FileUp data-icon="inline-start" />
                    Import scan
                  </Button>
                  <Button size="sm" onClick={() => setRerunOpen(true)}>
                    <RotateCw data-icon="inline-start" />
                    Re-run scan
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {data?.notes && (
          <p className="rounded-lg border bg-muted/25 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {data.notes}
          </p>
        )}
      </div>

      {cancel.error && (
        <Alert variant="destructive">
          <AlertDescription>{cancel.error.message}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-80" />
          <div className="grid gap-6 xl:grid-cols-2">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {data && (
        <Tabs value={activeTab} onValueChange={(v) => setTab(v as RunTab)} className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b">
            <TabsList variant="line" className="h-auto pb-0">
              <TabsTrigger value="pipeline" className="flex-none gap-2 px-4 pb-3">
                <Terminal className="size-4" />
                Pipeline &amp; Output
              </TabsTrigger>
              <TabsTrigger value="findings" className="flex-none gap-2 px-4 pb-3">
                <ShieldAlert className="size-4" />
                Findings Triage
                <Badge variant="secondary" className="font-mono text-xs">
                  {runFindingTotal}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="report" className="flex-none gap-2 px-4 pb-3">
                <FileText className="size-4" />
                Report &amp; Export
                {verifiedRows.length > 0 && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {verifiedRows.length} verified
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {activeTab !== "findings" && nextCandidate && (
              <Button
                size="sm"
                variant="outline"
                className="mb-2"
                onClick={() => {
                  setTab("findings")
                  setQueueFilter("needs_review")
                  setSelectedFindingId(nextCandidate.id)
                }}
              >
                Triage next ({needsReviewRows.length} open)
                <ArrowRight data-icon="inline-end" />
              </Button>
            )}
          </div>

          {/* TAB 1: Pipeline & Output */}
          <TabsContent value="pipeline" className="flex flex-col gap-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Jobs timeline</CardTitle>
                  <CardDescription>
                    Reconnaissance tools run in parallel; intrusive tools follow once recon finishes.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  {data.jobs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No jobs recorded for this run.</p>
                  ) : (
                    <>
                      <JobTimeline
                        jobs={data.jobs}
                        runStartedAt={data.started_at}
                        runFinishedAt={data.finished_at}
                        now={dataUpdatedAt || null}
                      />
                      <Separator />
                      <div className="divide-y">
                        {data.jobs.map((job) => (
                          <JobRow
                            key={job.id}
                            job={job}
                            canRetry={canManage && isFinished && job.status !== "running" && job.status !== "pending"}
                            isRetrying={retryJob.isPending && retryJob.variables?.id === job.id}
                            disabled={retryJob.isPending}
                            onRetry={() => retryJob.mutate(job)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base">
                    {isFinished ? "Execution output" : "Live output"}
                  </CardTitle>
                  <CardDescription>
                    {isFinished
                      ? "Preserved log output from all executed tools."
                      : "Streamed directly from the running tools."}
                  </CardDescription>
                  <CardAction>
                    {isFinished ? (
                      <TerminalStatusBadge status={data.status} />
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className={`size-2 rounded-full ${connected ? "animate-pulse bg-primary motion-reduce:animate-none" : "bg-muted-foreground/40"}`}
                          aria-hidden="true"
                        />
                        {connected ? "Live" : "Connecting..."}
                      </span>
                    )}
                  </CardAction>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-3">
                  {(logTools.length > 1 || visibleLines.length > 0) && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {logTools.length > 1 ? (
                        <ToggleGroup
                          type="single"
                          value={logToolFilter}
                          onValueChange={(val) => val && setLogToolFilter(val)}
                          variant="outline"
                          size="sm"
                          className="flex-wrap justify-start"
                        >
                          <ToggleGroupItem value="all" className="h-7 px-2.5 text-xs">
                            All
                          </ToggleGroupItem>
                          {logTools.map((tool) => (
                            <ToggleGroupItem key={tool} value={tool} className="h-7 px-2.5 font-mono text-xs">
                              {tool}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {visibleLines.length} {visibleLines.length === 1 ? "line" : "lines"}
                        </span>
                      )}
                      {visibleLines.length > 0 && (
                        <Button type="button" variant="outline" size="xs" onClick={handleCopyLog}>
                          {copiedLog ? <Check className="text-primary" data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                          {copiedLog ? "Copied" : "Copy log"}
                        </Button>
                      )}
                    </div>
                  )}

                  <div
                    ref={logRef}
                    className="h-[26rem] overflow-y-auto rounded-lg border bg-muted/40 p-3.5 font-mono text-xs leading-relaxed"
                  >
                    {visibleLines.length === 0 ? (
                      <p className="text-muted-foreground">
                        {connected
                          ? "Waiting for tool output..."
                          : isFinished
                            ? "No output was recorded for this filter."
                            : "Logs stream automatically while the pipeline is active."}
                      </p>
                    ) : (
                      visibleLines.map((line) => (
                        <div key={line.id} className="whitespace-pre-wrap break-all py-0.5">
                          <span className="text-muted-foreground">[{line.tool}]</span> {line.text}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {data.categories.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Selected assessment categories</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {data.categories.map((category) => (
                    <Badge key={category} variant="outline" className="font-normal">
                      {category}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* TAB 2: Findings Triage (Full list + slide-over triage drawer) */}
          <TabsContent value="findings" className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Run findings</CardTitle>
                <CardDescription>
                  Click any row to inspect evidence, ask the analyst, and verify in the slide-over drawer without
                  leaving this run.
                </CardDescription>
                <CardAction className="flex flex-wrap items-center gap-2">
                  {canManage && runFindingTotal > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={prioritize.isPending}
                      onClick={() => prioritize.mutate()}
                    >
                      {prioritize.isPending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <ListOrdered data-icon="inline-start" />
                      )}
                      {prioritize.isPending
                        ? "Prioritizing..."
                        : priorityByFindingId.size > 0
                          ? "Re-rank with AI"
                          : "AI Prioritize"}
                    </Button>
                  )}

                  <ToggleGroup
                    type="single"
                    value={queueFilter}
                    onValueChange={(val) => val && setQueueFilter(val as QueueFilter)}
                    variant="outline"
                    size="sm"
                  >
                    <ToggleGroupItem value="needs_review" className="text-xs">
                      Needs review ({needsReviewRows.length})
                    </ToggleGroupItem>
                    <ToggleGroupItem value="verified" className="text-xs">
                      Verified ({verifiedRows.length})
                    </ToggleGroupItem>
                    <ToggleGroupItem value="all" className="text-xs">
                      All ({runFindingTotal})
                    </ToggleGroupItem>
                  </ToggleGroup>

                  <Button asChild variant="ghost" size="sm">
                    <Link to={findingsHref}>Open in Findings</Link>
                  </Button>
                </CardAction>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                {runFindings.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{runFindings.error.message}</AlertDescription>
                  </Alert>
                )}

                {severityCounts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/25 px-4 py-2.5">
                    {severityCounts.map(({ severity, count }) => (
                      <span key={severity} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: `var(--severity-${severity})` }}
                          aria-hidden="true"
                        />
                        <span className="font-medium text-foreground">{capitalize(severity)}</span>
                        <span className="font-mono tabular-nums">{count}</span>
                      </span>
                    ))}
                  </div>
                )}

                {runFindings.isLoading ? (
                  <div className="flex flex-col gap-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : filteredRunFindings.length === 0 ? (
                  <EmptyState
                    icon={ShieldAlert}
                    title={
                      data.status === "running"
                        ? "Waiting for scan interpretation"
                        : queueFilter === "needs_review" && runFindingTotal > 0
                          ? "All findings in this run have been reviewed"
                          : "No findings in this view"
                    }
                    description={
                      data.status === "running"
                        ? "Candidate findings will appear automatically once tools and AI interpretation complete."
                        : queueFilter === "needs_review" && runFindingTotal > 0
                          ? "Switch to Verified or All above, or head to the Report & Export tab."
                          : "No findings match the current filter."
                    }
                    className="py-8"
                    action={
                      queueFilter === "needs_review" && verifiedRows.length > 0 ? (
                        <Button size="sm" onClick={() => setTab("report")}>
                          Review report
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {filteredRunFindings.map((finding) => {
                      const prio = priorityByFindingId.get(finding.id)
                      return (
                        <li key={finding.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedFindingId(finding.id)}
                            className="flex w-full items-center gap-3.5 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {prio && (
                              <Badge variant="outline" className="w-8 shrink-0 justify-center font-mono text-xs">
                                #{prio.rank}
                              </Badge>
                            )}
                            <Badge className={SEVERITY_CLASS[finding.severity]}>{capitalize(finding.severity)}</Badge>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-foreground" title={finding.title}>
                                {finding.title}
                              </p>
                              {prio && (
                                <p className="truncate text-xs text-muted-foreground" title={prio.rationale}>
                                  {prio.rationale}
                                </p>
                              )}
                            </div>
                            <span className="hidden w-44 shrink-0 truncate text-xs text-muted-foreground lg:inline">
                              {finding.category}
                            </span>
                            <Badge
                              variant={FINDING_STATUS_VARIANT[finding.status]}
                              className={STATUS_CLASS[finding.status]}
                            >
                              {STATUS_SHORT_LABEL[finding.status]}
                            </Badge>
                            <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                              {displayScore(finding.score, finding.severity)}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: Report & Export (lazy-mounted so iframe only loads when requested) */}
          <TabsContent value="report" className="flex flex-col gap-4">
            <Card>
              <CardContent>
                {activeTab === "report" && (
                  <AssessmentReports assessmentId={data.id} assessmentStatus={data.status} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Slide-over Triage Sheet */}
      <FindingTriageSheet
        findingId={selectedFindingId}
        queueIds={triageQueueIds}
        fromHref={`/assessments/${assessmentId}?tab=findings`}
        onSelectFinding={setSelectedFindingId}
      />

      {/* Re-run Scan Dialog */}
      {data && (
        <QuickAssessmentDialog
          key={`rerun-${data.id}`}
          open={rerunOpen}
          onOpenChange={setRerunOpen}
          defaultTargetId={data.target_id}
          defaultIntensity={data.intensity}
          defaultCategories={data.categories}
        />
      )}

      {/* Append External Scan Dialog */}
      {data && (
        <ImportScanDialog
          key={`import-run-${data.id}`}
          targets={targets.data ?? []}
          defaultTargetId={data.target_id}
          assessmentId={data.id}
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      )}
    </div>
  )
}
