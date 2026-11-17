import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Copy } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { AssessmentReports } from "@/pages/assessment-reports"
import type { AssessmentDetail, AssessmentStatus, Finding, Job, JobStatus, Target } from "@/lib/types"

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

/**
 * Horizontal timing bars for one run.
 *
 * Stacked cards answer "what ran"; a shared time axis answers "where did the
 * time go, and which tool stalled" - which is the question you actually ask
 * when a scan takes longer than expected. Plain divs, so both themes and print
 * behave without a chart library.
 */
function JobTimeline({
  jobs,
  runStartedAt,
  runFinishedAt,
  now,
}: {
  jobs: Job[]
  runStartedAt: string | null
  runFinishedAt: string | null
  /** Timestamp of the last successful fetch, so running bars grow as data refreshes. */
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
  // Only an ACTIVE run may extend its axis to the current poll time, so a
  // running job's bar keeps growing. Including `now` for a finished run would
  // stretch the axis from the run's end date to today and crush every bar into
  // a 1px sliver; ignoring it entirely freezes the axis at the first finished
  // job and clips the in-progress bar at 100%.
  const active = runFinishedAt === null
  const finish = Math.max(latest ?? 0, active ? (now ?? 0) : 0, origin + 1)
  const span = finish - origin

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {jobs.map((job) => {
          const start = parse(job.started_at)
          const end = parse(job.finished_at) ?? (job.status === "running" ? (now ?? start) : null)
          const queued = start === null
          const left = queued ? 0 : ((start - origin) / span) * 100
          const width = queued ? 100 : Math.max((((end ?? start) - start) / span) * 100, 1.5)
          return (
            <div key={job.id} className="flex items-center gap-2">
              <span className="w-16 shrink-0 truncate text-xs text-muted-foreground" title={job.tool}>
                {job.tool}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted/50">
                <div
                  className={`absolute inset-y-0 rounded ${queued ? "bg-muted-foreground/15" : (BAR_CLASS[job.status] ?? "bg-primary")}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={
                    queued
                      ? `${job.tool}: queued`
                      : `${job.tool}: ${formatDuration((end ?? start) - start)}`
                  }
                />
                {queued && (
                  <span className="absolute inset-0 flex items-center px-2 text-xs text-muted-foreground">
                    queued
                  </span>
                )}
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {queued ? "-" : formatDuration((end ?? start) - start)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between pl-18 text-xs tabular-nums text-muted-foreground">
        <span>{formatTime(origin)}</span>
        <span>{formatTime(finish)}</span>
      </div>
    </div>
  )
}

function JobRow({ job }: { job: Job }) {
  const percent = Math.round(job.progress * 100)
  return (
    <div className="space-y-1 py-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">{job.tool}</span>
        <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      {/* A finished job's full bar adds nothing the timeline above does not already show. */}
      {(job.status === "running" || job.status === "pending") && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatDate(job.started_at)}</span>
        <span>{formatDate(job.finished_at)}</span>
      </div>
      {job.command && <p className="break-all font-mono text-xs text-muted-foreground">{job.command}</p>}
    </div>
  )
}

export function AssessmentRunPage() {
  const { id } = useParams()
  const assessmentId = Number(id)
  const validId = Number.isInteger(assessmentId) && assessmentId > 0

  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)

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
  const targetName = targets.data?.find((target) => target.id === data?.target_id)?.name

  // Findings are created when the run finishes, so this card closes the
  // scan-to-triage loop without a manual trip through the findings filters.
  const runFindings = useQuery({
    queryKey: ["findings", "run", assessmentId],
    queryFn: () => apiWithMeta<Finding[]>(`/api/findings?assessment_id=${assessmentId}&limit=200`),
    enabled: validId,
  })

  // Any state-change event refreshes the progress cards immediately.
  const { lines, connected } = useScanEvents(validId ? assessmentId : null, (event) => {
    if (event.type !== "log") {
      queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] })
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
      queryClient.invalidateQueries({ queryKey: ["findings"] })
    }
  })

  const cancel = useMutation({
    mutationFn: () => api<{ status: string }>(`/api/assessments/${assessmentId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] })
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
      toast.success("Run cancelled")
    },
  })

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  const finishedJobs = data?.jobs.filter((j) => j.status === "completed" || j.status === "failed").length ?? 0
  const jobTool = new Map(data?.jobs.map((j) => [j.id, j.tool]))
  const canCancel = hasRole("admin", "assessor")
  const isFinished = data?.status === "completed" || data?.status === "failed" || data?.status === "cancelled"
  const [copiedLog, setCopiedLog] = useState(false)

  // Merge live lines with persisted job logs so historical runs display their outputs
  const displayLines = (() => {
    if (lines.length > 0) return lines
    const parsed: { id: string; jobId: number; text: string }[] = []
    if (data?.jobs) {
      for (const job of data.jobs) {
        if (!job.log) continue
        const rawLines = job.log.split("\n")
        for (let i = 0; i < rawLines.length; i++) {
          const text = rawLines[i].trim()
          if (text) {
            parsed.push({ id: `persisted-${job.id}-${i}`, jobId: job.id, text })
          }
        }
      }
    }
    return parsed
  })()

  function handleCopyLog() {
    const fullText = displayLines.map((l) => `[${jobTool.get(l.jobId) ?? `job ${l.jobId}`}] ${l.text}`).join("\n")
    navigator.clipboard.writeText(fullText)
    setCopiedLog(true)
    setTimeout(() => setCopiedLog(false), 2000)
  }

  const runFindingRows = runFindings.data?.data ?? []
  const runFindingTotal = runFindings.data?.totalCount ?? runFindingRows.length
  const rankedFindings = [...runFindingRows].sort(
    (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.score - a.score,
  )
  const topFindings = rankedFindings.slice(0, 5)
  const nextCandidate = rankedFindings.find(
    (finding) => finding.status === "ai_candidate" || finding.status === "needs_evidence",
  )
  const severityCounts = SEVERITIES.map((severity) => ({
    severity,
    count: runFindingRows.filter((finding) => finding.severity === severity).length,
  })).filter((entry) => entry.count > 0)
  const findingsHref = `/findings?assessment=${assessmentId}`

  if (!validId) {
    return (
      <div className="space-y-4">
        <Link
          to="/assessments"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Assessments
        </Link>
        <Alert variant="destructive">
          <AlertDescription>Assessment #{id} is not a valid run identifier.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Link
          to="/assessments"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Assessments
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Assessment #{assessmentId}</h1>
          {data && <Badge variant={STATUS_VARIANT[data.status]}>{data.status}</Badge>}
          {data && (
            <Badge variant={data.intensity === "full_intrusive" ? "destructive" : "secondary"}>
              {data.intensity === "full_intrusive" ? "full / intrusive" : "passive / safe"}
            </Badge>
          )}
          {data?.status === "running" && canCancel && (
            <Button
              variant="destructive"
              size="sm"
              className="ml-auto"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel run"}
            </Button>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          {targetName ?? (data ? `Target #${data.target_id}` : "Pipeline jobs, progress and live output for this run.")}
          {data && ` · ${finishedJobs} of ${data.jobs.length} jobs finished`}
          {data?.started_at && ` · started ${formatDate(data.started_at)}`}
          {data?.finished_at && ` · finished ${formatDate(data.finished_at)}`}
        </p>

        {data && data.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.categories.map((category) => (
              <Badge key={category} variant="outline" className="font-normal">
                {category}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {cancel.error && (
        <Alert variant="destructive">
          <AlertDescription>{cancel.error.message}</AlertDescription>
        </Alert>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Jobs</CardTitle>
                <CardDescription>Each tool runs in sequence and reports its own progress.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.jobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No jobs for this run.</p>
                ) : (
                  <>
                    <JobTimeline
                      jobs={data.jobs}
                      runStartedAt={data.started_at}
                      runFinishedAt={data.finished_at}
                      now={dataUpdatedAt || null}
                    />
                    <div className="divide-y border-t">
                      {data.jobs.map((job) => (
                        <JobRow key={job.id} job={job} />
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1.5">
                    <CardTitle className="text-base">
                      {isFinished ? "Execution output" : "Live output"}
                    </CardTitle>
                    <CardDescription>
                      {isFinished
                        ? "Preserved log output from all executed jobs."
                        : "Streamed straight from the running tools."}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {displayLines.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyLog}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {copiedLog ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                        <span className="ml-1 text-xs">{copiedLog ? "Copied" : "Copy"}</span>
                      </Button>
                    )}
                    {isFinished ? (
                      <Badge variant="outline" className="gap-1.5 py-0.5 text-xs font-normal">
                        <CheckCircle2 className="size-3 text-emerald-500" />
                        Completed
                      </Badge>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className={`size-1.5 rounded-full ${connected ? "animate-pulse bg-primary motion-reduce:animate-none" : "bg-muted-foreground/40"}`}
                          aria-hidden="true"
                        />
                        {connected ? "live" : "not connected"}
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  ref={logRef}
                  className="h-[26rem] overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-[13px] leading-relaxed"
                >
                  {displayLines.length === 0 ? (
                    <p className="text-muted-foreground">
                      {connected
                        ? "Waiting for output…"
                        : isFinished
                        ? "No output was recorded for this run."
                        : "No live output. Logs stream only while a run is active."}
                    </p>
                  ) : (
                    displayLines.map((line) => (
                      <div key={line.id} className="whitespace-pre-wrap break-all">
                        <span className="text-muted-foreground">[{jobTool.get(line.jobId) ?? `job ${line.jobId}`}]</span>{" "}
                        {line.text}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div className="min-w-0 space-y-1.5">
                <CardTitle className="text-base">Findings from this run</CardTitle>
                <CardDescription>
                  {runFindings.isLoading
                    ? "Loading findings…"
                    : runFindingTotal === 0
                      ? data.status === "running"
                        ? "Findings appear here when the run finishes and interpretation completes."
                        : "No findings were recorded for this run."
                      : `${runFindingTotal} ${runFindingTotal === 1 ? "finding" : "findings"} recorded by this run.`}
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {nextCandidate && (
                  <Button asChild size="sm">
                    <Link to={`/findings/${nextCandidate.id}`} state={{ from: findingsHref }}>
                      Review next
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline" size="sm">
                  <Link to={findingsHref}>View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {runFindings.error && (
                <Alert variant="destructive">
                  <AlertDescription>{runFindings.error.message}</AlertDescription>
                </Alert>
              )}

              {severityCounts.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
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

              {topFindings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {data.status === "running"
                    ? "Waiting for interpretation to finish."
                    : "No findings to review for this run."}
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {topFindings.map((finding) => (
                    <li key={finding.id}>
                      <Link
                        to={`/findings/${finding.id}`}
                        state={{ from: findingsHref }}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
                      >
                        <Badge className={SEVERITY_CLASS[finding.severity]}>
                          {capitalize(finding.severity)}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={finding.title}>
                          {finding.title}
                        </span>
                        <span className="hidden w-44 shrink-0 truncate text-xs text-muted-foreground lg:inline">
                          {finding.category}
                        </span>
                        <Badge
                          variant={FINDING_STATUS_VARIANT[finding.status]}
                          className={STATUS_CLASS[finding.status]}
                        >
                          {STATUS_SHORT_LABEL[finding.status]}
                        </Badge>
                        <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {displayScore(finding.score, finding.severity)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {runFindingTotal > topFindings.length && (
                <p className="text-xs text-muted-foreground">
                  Showing the {topFindings.length} most severe of {runFindingTotal}.{" "}
                  <Link to={findingsHref} className="font-medium text-primary underline-offset-4 hover:underline">
                    View all findings
                  </Link>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <AssessmentReports assessmentId={data.id} assessmentStatus={data.status} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
