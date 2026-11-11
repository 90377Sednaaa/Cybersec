import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

  const reports = useQuery({
    queryKey: ["reports", assessmentId],
    queryFn: () => api<Report[]>(`/api/assessments/${assessmentId}/reports`),
    // Poll while a PDF is still being generated.
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === "pending") ? 2000 : false),
  })

  const generate = useMutation({
    mutationFn: () => api<Report>(`/api/assessments/${assessmentId}/report`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", assessmentId] }),
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
          </div>
          <p className="text-xs text-muted-foreground">
            Created {formatDate(report.created_at)}
            {report.finished_at ? ` · finished ${formatDate(report.finished_at)}` : ""}
          </p>
          {report.status === "failed" && report.error && (
            <p className="break-words text-xs text-destructive">{report.error}</p>
          )}
        </div>
      ))}
    </div>
  )
}