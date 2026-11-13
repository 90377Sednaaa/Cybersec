import { useEffect, useRef } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"

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

function JobCard({ job }: { job: Job }) {
  const percent = Math.round(job.progress * 100)
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{job.tool}</p>
        <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{percent}%</span>
        <span>
          {formatDate(job.started_at)} → {formatDate(job.finished_at)}
        </span>
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

  const { data, isLoading, error } = useQuery({
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
              <CardContent className="space-y-2">
                {data.jobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No jobs planned for this run.</p>
                ) : (
                  data.jobs.map((job) => <JobCard key={job.id} job={job} />)
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
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {connected ? "● live" : "○ not connected"}
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
