import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HelpHint } from "@/components/help-hint"
import { api, getToken } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { AssessmentStatus, Report, ReportStatus } from "@/lib/types"

const STATUS_VARIANT: Record<ReportStatus, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  ready: "default",
  failed: "destructive",
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-"
}

// The download endpoint needs the Authorization header, so a plain <a href> cannot be used.
async function downloadReport(report: Report) {
  const token = getToken()
  const res = await fetch(`/api/reports/${report.id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    let message = `Download failed (HTTP ${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === "string") message = body.detail
    } catch {
      // keep the default message
    }
    throw new Error(message)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `security-report-assessment-${report.assessment_id}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function AssessmentReports({
  assessmentId,
  assessmentStatus,
}: {
  assessmentId: number
  assessmentStatus: AssessmentStatus
}) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<Report | null>(null)

  const reports = useQuery({
    queryKey: ["reports", assessmentId],
    queryFn: () => api<Report[]>(`/api/assessments/${assessmentId}/reports`),
    // Poll while a PDF is still being generated.
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === "pending") ? 2000 : false),
  })

  const generate = useMutation({
    mutationFn: () => api<Report>(`/api/assessments/${assessmentId}/report`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", assessmentId] })
      toast.success("Report generation started")
    },
  })

  const remove = useMutation({
    mutationFn: (reportId: number) => api<void>(`/api/reports/${reportId}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ["reports", assessmentId] })
      toast.success("Report deleted")
    },
  })

  async function handleDownload(report: Report) {
    setDownloadError(null)
    setDownloadingId(report.id)
    try {
      await downloadReport(report)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed")
    } finally {
      setDownloadingId(null)
    }
  }

  const canGenerate = hasRole("admin", "assessor")
  const hasPending = reports.data?.some((r) => r.status === "pending") ?? false
  const running = assessmentStatus === "running"

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium">Report</p>
          <HelpHint label="Security report">
            Generates a PDF security assessment report for this run. Verify your findings before generating the final
            report.
          </HelpHint>
        </div>
        {canGenerate && (
          <Button
            size="sm"
            disabled={running || hasPending || generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending || hasPending ? "Generating…" : "Generate report"}
          </Button>
        )}
      </div>

      {running && canGenerate && (
        <p className="text-xs text-muted-foreground">Wait for the run to finish before generating a report.</p>
      )}

      {generate.error && (
        <Alert variant="destructive">
          <AlertDescription>{generate.error.message}</AlertDescription>
        </Alert>
      )}
      {downloadError && (
        <Alert variant="destructive">
          <AlertDescription>{downloadError}</AlertDescription>
        </Alert>
      )}
      {reports.error && (
        <Alert variant="destructive">
          <AlertDescription>{reports.error.message}</AlertDescription>
        </Alert>
      )}

      {!reports.isLoading && reports.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No reports yet for this assessment.</p>
      )}

      {reports.data?.map((report) => (
        <div key={report.id} className="space-y-1 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Report #{report.id}</span>
              <Badge variant={STATUS_VARIANT[report.status]}>{report.status}</Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {report.status === "ready" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadingId === report.id}
                  onClick={() => handleDownload(report)}
                >
                  {downloadingId === report.id ? "Downloading…" : "Download PDF"}
                </Button>
              )}
              {canGenerate && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={report.status === "pending"}
                  onClick={() => setDeleting(report)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Created {formatDate(report.created_at)}
            {report.finished_at ? ` · finished ${formatDate(report.finished_at)}` : ""}
          </p>
          {report.status === "failed" && report.error && (
            <details className="text-xs">
              <summary className="cursor-pointer text-destructive">
                Report generation failed. Show details
              </summary>
              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
                {report.error}
              </pre>
            </details>
          )}
        </div>
      ))}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete report?</DialogTitle>
            <DialogDescription>
              Report #{deleting?.id} and its generated PDF will be removed. Findings and the run itself are not
              affected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {remove.error && (
            <Alert variant="destructive">
              <AlertDescription>{remove.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              {remove.isPending ? "Deleting…" : "Delete report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}