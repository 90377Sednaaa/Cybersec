import { useQuery } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { api } from "@/lib/api"
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
  const { data, isLoading, error } = useQuery({
    queryKey: ["assessment", assessmentId],
    queryFn: () => api<AssessmentDetail>(`/api/assessments/${assessmentId}`),
    enabled: assessmentId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  })

  const finishedJobs = data?.jobs.filter((j) => j.status === "completed" || j.status === "failed").length ?? 0

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
          <SheetDescription>Pipeline jobs for this run and their progress.</SheetDescription>
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
              </div>

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
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}