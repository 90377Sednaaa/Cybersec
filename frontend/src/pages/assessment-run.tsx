import { useEffect, useRef } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useScanEvents } from "@/lib/scan-events"
import { AssessmentReports } from "@/pages/assessment-reports"
import type { AssessmentDetail, AssessmentStatus, Job, JobStatus } from "@/lib/types"

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
  return iso ? new Date(iso).toLocaleString() : "—"
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

export function AssessmentRunSheet({
  assessmentId,
  onClose,
}: {
  assessmentId: number | null
  onClose: () => void
}) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ["assessment", assessmentId],
    queryFn: () => api<AssessmentDetail>(`/api/assessments/${assessmentId}`),
    enabled: assessmentId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  })

  // Any state-change event refreshes the progress cards immediately.
  const { lines, connected } = useScanEvents(assessmentId, (event) => {
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

  return (
    <Sheet
      open={assessmentId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Assessment #{assessmentId}</SheetTitle>
          <SheetDescription>Pipeline jobs, progress and live output for this run.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[data.status]}>{data.status}</Badge>
                <Badge variant={data.intensity === "full_intrusive" ? "destructive" : "secondary"}>
                  {data.intensity === "full_intrusive" ? "full / intrusive" : "passive / safe"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {finishedJobs} of {data.jobs.length} jobs finished
                </span>
                {data.status === "running" && canCancel && (
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

              {cancel.error && (
                <Alert variant="destructive">
                  <AlertDescription>{cancel.error.message}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1">
                <p className="text-sm font-medium">Categories</p>
                <ul className="list-inside list-disc text-sm text-muted-foreground">
                  {data.categories.map((category) => (
                    <li key={category}>{category}</li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Jobs</p>
                {data.jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs planned for this run.</p>}
                {data.jobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Live log</p>
                  <span className="text-xs text-muted-foreground">{connected ? "● live" : "○ not connected"}</span>
                </div>
                <div ref={logRef} className="h-64 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
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
              </div>

              <AssessmentReports assessmentId={data.id} assessmentStatus={data.status} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}