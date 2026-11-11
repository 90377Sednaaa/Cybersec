import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FindingReview } from "@/pages/finding-review"
import { api } from "@/lib/api"
import {
  SEVERITY_CLASS,
  STATUS_CLASS,
  STATUS_LABEL,
  STATUS_VARIANT,
  capitalize,
  displayScore,
} from "@/lib/finding-style"
import type { Evidence, EvidenceKind, FindingDetail } from "@/lib/types"

const KIND_LABEL: Record<EvidenceKind, string> = {
  http_transcript: "HTTP transcript",
  tool_output: "Tool output",
  upload: "Uploaded file",
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-"
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function EvidenceItem({ item }: { item: Evidence }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{item.label || KIND_LABEL[item.kind]}</p>
        <Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {item.tool ? `${item.tool} · ` : ""}
        {formatDate(item.captured_at)}
      </p>
      {item.kind === "upload" ? (
        <p className="text-sm text-muted-foreground">Uploaded file. Downloading is added with the verification workflow.</p>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {item.content || "(empty)"}
        </pre>
      )}
    </div>
  )
}

export function FindingDetailSheet({
  findingId,
  onClose,
}: {
  findingId: number | null
  onClose: () => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["finding", findingId],
    queryFn: () => api<FindingDetail>(`/api/findings/${findingId}`),
    enabled: findingId !== null,
  })

  return (
    <Sheet
      open={findingId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data?.title ?? `Finding #${findingId}`}</SheetTitle>
          <SheetDescription>Details, evidence and recommended fix for this finding.</SheetDescription>
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
                <Badge className={SEVERITY_CLASS[data.severity]}>{capitalize(data.severity)}</Badge>
                <Badge variant={STATUS_VARIANT[data.status]} className={STATUS_CLASS[data.status]}>
                  {STATUS_LABEL[data.status]}
                </Badge>
              </div>

              {data.status === "ai_candidate" && (
                <Alert>
                  <AlertDescription>
                    This finding was produced by the AI and is not confirmed. An assessor must verify it before it
                    counts as a vulnerability.
                  </AlertDescription>
                </Alert>
              )}

              <Tabs key={data.id} defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="evidence">Evidence ({data.evidence.length})</TabsTrigger>
                  <TabsTrigger value="remediation">Remediation</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 pt-2">
                  <Field label="Description">{data.description || "No description."}</Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Category">{data.category || "-"}</Field>
                    <Field label="Assessment">{data.assessment_id ? `#${data.assessment_id}` : "-"}</Field>
                    <Field label="Risk score">{displayScore(data.score, data.severity)} / 10</Field>
                    <Field label="Confidence">{Math.round(data.ai_confidence * 100)}%</Field>
                  </div>
                  <Field label="Assessor notes">{data.assessor_notes || "No notes yet."}</Field>
                  <Field label="Verification">
                    {data.verified_by
                      ? `Verified by ${data.verified_by} on ${formatDate(data.verified_at)}`
                      : "Not verified yet. Only an assessor can verify a finding."}
                  </Field>
                </TabsContent>

                <TabsContent value="evidence" className="space-y-3 pt-2">
                  {data.evidence.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No evidence attached yet. Evidence is captured by the scan tools or uploaded by an assessor.
                    </p>
                  )}
                  {data.evidence.map((item) => (
                    <EvidenceItem key={item.id} item={item} />
                  ))}
                </TabsContent>

                <TabsContent value="remediation" className="pt-2">
                  <Field label="Recommended fix">{data.remediation || "No remediation guidance yet."}</Field>
                </TabsContent>
                           </Tabs>

              <FindingReview key={data.id} finding={data} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}