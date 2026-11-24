import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, FileText, Maximize2, Minimize2, RefreshCw, Trash2 } from "lucide-react"
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
import { Spinner } from "@/components/ui/spinner"
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
  const [isFullscreen, setIsFullscreen] = useState(false)

  const reports = useQuery({
    queryKey: ["reports", assessmentId],
    queryFn: () => api<Report[]>(`/api/assessments/${assessmentId}/reports`),
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === "pending") ? 2000 : false),
  })

  // Load live HTML report directly into the card
  const reportHtml = useQuery({
    queryKey: ["report-preview-html", assessmentId],
    queryFn: () => loadReportHtml(assessmentId),
    enabled: assessmentStatus !== "running",
  })

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isFullscreen])

  const generate = useMutation({
    mutationFn: () => api<Report>(`/api/assessments/${assessmentId}/report`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", assessmentId] })
      queryClient.invalidateQueries({ queryKey: ["report-preview-html", assessmentId] })
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

  const canGenerate = hasRole("admin", "assessor")
  const readyReports = reports.data?.filter((row) => row.status === "ready") ?? []
  const latestReady = readyReports.length > 0 ? readyReports[readyReports.length - 1] : null
  const hasPending = reports.data?.some((r) => r.status === "pending") ?? false
  const running = assessmentStatus === "running"

  return (
    <div className="space-y-4">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <h2 className="text-base font-semibold tracking-tight">Security Assessment Report</h2>
          <HelpHint label="Security report">
            Rendered live from verified findings. You can review the report directly, view in full screen, or download a compiled PDF.
          </HelpHint>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={reportHtml.isFetching || running}
            onClick={() => void reportHtml.refetch()}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${reportHtml.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={!reportHtml.data}
            onClick={() => setIsFullscreen(true)}
            className="gap-1.5"
          >
            <Maximize2 className="size-3.5" />
            Full screen
          </Button>

          {latestReady && (
            <Button
              size="sm"
              variant="outline"
              disabled={downloadingId === latestReady.id}
              onClick={() => void handleDownload(latestReady)}
              className="gap-1.5"
            >
              <Download className="size-3.5" />
              {downloadingId === latestReady.id ? "Downloading…" : "Download PDF"}
            </Button>
          )}

          {canGenerate && (
            <Button
              size="sm"
              disabled={running || hasPending || generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending || hasPending ? "Generating PDF…" : "Generate PDF"}
            </Button>
          )}
        </div>
      </div>

      {running && canGenerate && (
        <p className="text-xs text-muted-foreground">Wait for the run to finish before generating the final PDF report.</p>
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

      {/* Embedded Live Report Preview */}
      {running ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border bg-muted/20 p-6 text-center">
          <p className="text-sm font-medium">Scan in progress</p>
          <p className="text-xs text-muted-foreground">The report preview will become available once the scan finishes.</p>
        </div>
      ) : reportHtml.isLoading ? (
        <div className="flex h-96 flex-col items-center justify-center gap-2 rounded-lg border bg-muted/20 p-6 text-center">
          <Spinner className="size-5" />
          <p className="text-xs text-muted-foreground">Loading report preview…</p>
        </div>
      ) : reportHtml.isError ? (
        <Alert variant="destructive">
          <AlertDescription>Failed to load report: {reportHtml.error.message}</AlertDescription>
        </Alert>
      ) : reportHtml.data ? (
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <iframe
            title={`Security report preview for assessment ${assessmentId}`}
            srcDoc={reportHtml.data}
            sandbox=""
            className="h-[650px] w-full border-0"
          />
        </div>
      ) : (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border bg-muted/20 p-6 text-center">
          <p className="text-sm font-medium">No report preview available</p>
          <p className="text-xs text-muted-foreground">Verify candidate findings or click Refresh to regenerate the preview.</p>
        </div>
      )}

      {/* Fullscreen Overlay */}
      {isFullscreen && reportHtml.data && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background/95 p-4 backdrop-blur-md sm:p-6">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              <span className="text-lg font-semibold tracking-tight">Security Assessment Report</span>
              <Badge variant="outline">Assessment #{assessmentId}</Badge>
            </div>
            <div className="flex items-center gap-2">
              {latestReady && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadingId === latestReady.id}
                  onClick={() => void handleDownload(latestReady)}
                  className="gap-1.5"
                >
                  <Download className="size-3.5" />
                  {downloadingId === latestReady.id ? "Downloading…" : "Download PDF"}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setIsFullscreen(false)} className="gap-1.5">
                <Minimize2 className="size-4" />
                Exit fullscreen
              </Button>
            </div>
          </div>
          <iframe
            title={`Security report preview for assessment ${assessmentId}`}
            srcDoc={reportHtml.data}
            sandbox=""
            className="mt-3 flex-1 w-full rounded-md border bg-white shadow-2xl"
          />
        </div>
      )}

      {/* Generated PDF history */}
      {reports.data && reports.data.length > 0 && (
        <div className="space-y-2 pt-2 border-t">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            PDF Exports ({reports.data.length})
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {reports.data.map((report) => (
              <div key={report.id} className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">Report #{report.id}</span>
                      <Badge variant={STATUS_VARIANT[report.status]} className="px-1.5 py-0 text-[10px]">
                        {report.status}
                      </Badge>
                    </div>
                    <p className="truncate pt-0.5 text-xs text-muted-foreground">
                      {formatDate(report.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {report.status === "ready" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={downloadingId === report.id}
                        onClick={() => void handleDownload(report)}
                      >
                        <Download className="size-3" />
                        <span className="sr-only">Download PDF</span>
                      </Button>
                    )}
                    {canGenerate && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        disabled={report.status === "pending"}
                        onClick={() => {
                          remove.reset()
                          setDeleting(report)
                        }}
                      >
                        <Trash2 className="size-3" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    )}
                  </div>
                </div>
                {report.status === "failed" && report.error && (
                  <p className="line-clamp-3 text-xs leading-snug text-destructive" title={report.error}>
                    {report.error}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
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
    </div>
  )
}
