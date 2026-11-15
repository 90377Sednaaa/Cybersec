import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, Trash2 } from "lucide-react"
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
import { api, apiBlob } from "@/lib/api"
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

// The download endpoint needs the Authorization header, so a plain <a href>
// cannot be used; apiBlob also keeps the shared 401 session handling (F-27).
async function downloadReport(report: Report) {
  const blob = await apiBlob(`/api/reports/${report.id}`)
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `security-report-assessment-${report.assessment_id}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// An iframe src cannot carry the Authorization header, so the HTML is fetched
// through the shared authenticated helper and injected with srcDoc instead.
// This avoids the browser's built-in PDF viewer, which is unavailable in some
// embedded browsers, and needs no report to have been generated first.
async function loadReportHtml(assessmentId: number): Promise<string> {
  const blob = await apiBlob(`/api/assessments/${assessmentId}/report/preview`)
  return blob.text()
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
  const [preview, setPreview] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

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
      closeDeleteDialog()
      queryClient.invalidateQueries({ queryKey: ["reports", assessmentId] })
      toast.success("Report deleted")
    },
  })

  // Reset the mutation so a previous 409/404 is not shown again the next time
  // the dialog is opened for a different report.
  function closeDeleteDialog() {
    setDeleting(null)
    remove.reset()
  }

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

  async function openPreview() {
    setPreviewError(null)
    setPreviewing(true)
    try {
      setPreview(await loadReportHtml(assessmentId))
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed")
    } finally {
      setPreviewing(false)
    }
  }

  const canGenerate = hasRole("admin", "assessor")
  const readyReports = reports.data?.filter((row) => row.status === "ready") ?? []
  const latestReady = readyReports.length > 0 ? readyReports[readyReports.length - 1] : null
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
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={previewing} onClick={() => void openPreview()}>
            <Eye className="size-3.5" />
            {previewing ? "Loading…" : "Preview report"}
          </Button>
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
      {previewError && (
        <Alert variant="destructive">
          <AlertDescription>{previewError}</AlertDescription>
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
                  onClick={() => {
                    remove.reset()
                    setDeleting(report)
                  }}
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

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && closeDeleteDialog()}>
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
            <Button type="button" variant="outline" onClick={closeDeleteDialog}>
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

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-5xl sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Report preview - assessment #{assessmentId}</DialogTitle>
            <DialogDescription>
              Rendered live from the current findings. No download or PDF generation is needed to read it.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <iframe
              title={`Security report preview for assessment ${assessmentId}`}
              srcDoc={preview}
              sandbox=""
              className="h-[65vh] w-full rounded-md border bg-white"
            />
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!latestReady}
              onClick={() => latestReady && void handleDownload(latestReady)}
            >
              Download PDF
            </Button>
            <Button type="button" onClick={() => setPreview(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}