import { useEffect, useRef } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useScanEvents } from "@/lib/scan-events"
import { AssessmentReports } from "@/pages/assessment-reports"
import type { AssessmentDetail, AssessmentStatus, Job, JobStatus, Target } from "@/lib/types"

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
  const finish = Math.max(latest ?? now ?? origin + 1, origin + 1)
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
                  <span className="absolute inset-0 flex items-center px-2 text-[10px] text-muted-foreground">
                    queued
                  </span>
                )}
              </div>
              <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {queued ? "-" : formatDuration((end ?? start) - start)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between pl-18 text-[10px] tabular-nums text-muted-foreground">
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
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{formatDate(job.started_at)}</span>
        <span>{formatDate(job.finished_at)}</span>
      </div>
      {job.command && <p className="break-all font-mono text-[11px] text-muted-foreground">{job.command}</p>}
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

  // Any state-change event refreshes the progress cards immediately.
  const { lines, connected } = useScanEvents(validId ? assessmentId : null, (event) => {
    if (event.type !== "log") {
      queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] })
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
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
                  <p className="text-sm text-muted-foreground">No jobs planned for this run.</p>
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
                    <CardTitle className="text-base">Live output</CardTitle>
                    <CardDescription>Streamed straight from the running tools.</CardDescription>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${connected ? "animate-pulse bg-primary motion-reduce:animate-none" : "bg-muted-foreground/40"}`}
                      aria-hidden="true"
                    />
                    {connected ? "live" : "not connected"}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  ref={logRef}
                  className="h-[26rem] overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs"
                >
                  {lines.length === 0 ? (
                    <p className="text-muted-foreground">
                      {connected
                        ? "Waiting for output…"
                        : "No live output. Logs stream only while a run is active."}
                    </p>
                  ) : (
                    lines.map((line) => (
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
            <CardContent>
              <AssessmentReports assessmentId={data.id} assessmentStatus={data.status} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
