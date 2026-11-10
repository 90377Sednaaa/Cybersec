import { useQuery } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HelpHint } from "@/components/help-hint"
import { api } from "@/lib/api"
import type { Assessment, AssessmentStatus, Target } from "@/lib/types"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

const STATUS_VARIANT: Record<AssessmentStatus, BadgeVariant> = {
  draft: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—"
}

export function AssessmentsPage() {
  const assessments = useQuery({
    queryKey: ["assessments"],
    queryFn: () => api<Assessment[]>("/api/assessments"),
    // Keep the list fresh while anything is still running.
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.status === "running") ? 3000 : false,
  })

  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
  })

  const targetNames = new Map(targets.data?.map((t) => [t.id, t.name]))
  const { data, isLoading, error } = assessments

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Assessments</h1>
          <HelpHint label="What is an assessment" className="mt-1.5">
            One run of the scan pipeline against a registered target: reconnaissance, scanning, then AI
            interpretation. Findings from a run stay unconfirmed until an assessor verifies them.
          </HelpHint>
        </div>
        <p className="text-sm text-muted-foreground">
          Reconnaissance, scanning and assessment runs (features 02 and 03).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assessment runs</CardTitle>
          <CardDescription>Every run is tied to a registered, authorized target.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Intensity</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-sm font-medium">No assessments yet</p>
                      <p className="text-xs text-muted-foreground">
                        Start an assessment against a registered target to begin.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {data?.map((assessment) => (
                <TableRow key={assessment.id}>
                  <TableCell className="font-mono text-xs">#{assessment.id}</TableCell>
                  <TableCell className="font-medium">
                    {targetNames.get(assessment.target_id) ?? `Target #${assessment.target_id}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[assessment.status]}>{assessment.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={assessment.intensity === "full_intrusive" ? "destructive" : "secondary"}>
                      {assessment.intensity === "full_intrusive" ? "full / intrusive" : "passive / safe"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {assessment.categories.length} selected
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(assessment.started_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(assessment.finished_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}