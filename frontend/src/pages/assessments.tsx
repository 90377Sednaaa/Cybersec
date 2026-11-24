import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Radar, RotateCcw } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { HelpHint } from "@/components/help-hint"
import { ImportScanDialog } from "@/components/import-scan-dialog"
import { QuickAssessmentDialog } from "@/components/quick-assessment-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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

const ALL = "all"

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-"
}

export function AssessmentsPage() {
  const navigate = useNavigate()
  const [targetFilter, setTargetFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState(ALL)

  const assessments = useQuery({
    queryKey: ["assessments"],
    queryFn: () => api<Assessment[]>("/api/assessments"),
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.status === "running") ? 3000 : false,
  })

  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
  })

  const targetNames = useMemo(() => new Map(targets.data?.map((t) => [t.id, t.name])), [targets.data])

  const filtered = useMemo(() => {
    return (assessments.data ?? []).filter((run) => {
      if (targetFilter !== ALL && String(run.target_id) !== targetFilter) return false
      if (statusFilter !== ALL && run.status !== statusFilter) return false
      return true
    })
  }, [assessments.data, targetFilter, statusFilter])

  const hasFilters = targetFilter !== ALL || statusFilter !== ALL
  const { isLoading, error } = assessments

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Assessments</h1>
            <HelpHint label="What is an assessment" className="mt-1">
              One run of the scan pipeline against an authorized target: recon, scanning, normalization, and AI
              interpretation. Open any run to watch live logs, triage findings, and export reports in one workspace.
            </HelpHint>
          </div>
          <p className="text-sm text-muted-foreground">
            Launch live scan runs, import external tool reports, or open any run workstation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportScanDialog targets={targets.data ?? []} />
          <QuickAssessmentDialog />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1">
            <CardTitle>Assessment runs</CardTitle>
            <CardDescription>
              {isLoading ? "Loading runs..." : `${filtered.length} ${filtered.length === 1 ? "run" : "runs"} shown`}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={targetFilter} onValueChange={setTargetFilter}>
              <SelectTrigger className="h-9 w-44 text-sm" aria-label="Filter by target">
                <SelectValue placeholder="All targets" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL}>All targets</SelectItem>
                  {(targets.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-36 text-sm" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTargetFilter(ALL)
                  setStatusFilter(ALL)
                }}
              >
                <RotateCcw data-icon="inline-start" />
                Reset
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Intensity</TableHead>
                <TableHead className="hidden md:table-cell">Categories</TableHead>
                <TableHead className="hidden lg:table-cell">Started</TableHead>
                <TableHead className="hidden xl:table-cell">Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                [0, 1, 2, 3].map((index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-40 text-center">
                    <EmptyState
                      icon={Radar}
                      title={hasFilters ? "No assessments match your filters" : "No assessments yet"}
                      description={
                        hasFilters
                          ? "Clear the target or status filter to see all runs."
                          : "Launch an assessment directly, or register a new target inline."
                      }
                      className="py-4"
                      action={!hasFilters ? <QuickAssessmentDialog /> : undefined}
                    />
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((assessment) => (
                <TableRow
                  key={assessment.id}
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  tabIndex={0}
                  onClick={() => navigate(`/assessments/${assessment.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") navigate(`/assessments/${assessment.id}`)
                  }}
                >
                  <TableCell className="py-3.5 font-mono text-xs font-semibold">#{assessment.id}</TableCell>
                  <TableCell className="font-medium">
                    {targetNames.get(assessment.target_id) ?? `Target #${assessment.target_id}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[assessment.status]}>{assessment.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={assessment.intensity === "full_intrusive" ? "destructive" : "secondary"}>
                      {assessment.intensity === "full_intrusive" ? "Full / intrusive" : "Passive / safe"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {assessment.categories.length} selected
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {formatDate(assessment.started_at)}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                    {formatDate(assessment.finished_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
