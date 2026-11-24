import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Crosshair, FileUp, Pencil, Play } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { HelpHint } from "@/components/help-hint"
import { ImportScanDialog } from "@/components/import-scan-dialog"
import { QuickAssessmentDialog } from "@/components/quick-assessment-dialog"
import { TargetFormDialog } from "@/components/target-form-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { Assessment, AssessmentStatus, Target } from "@/lib/types"

const STATUS_VARIANT: Record<AssessmentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
}

export function TargetsPage() {
  const { hasRole } = useAuth()
  const canManage = hasRole("admin", "assessor")

  const [editingTarget, setEditingTarget] = useState<Target | null>(null)
  const [scanTarget, setScanTarget] = useState<Target | null>(null)
  const [importTarget, setImportTarget] = useState<Target | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
  })

  const assessmentsQuery = useQuery({
    queryKey: ["assessments"],
    queryFn: () => api<Assessment[]>("/api/assessments"),
  })

  const latestByTarget = useMemo(() => {
    const map = new Map<number, Assessment>()
    for (const run of assessmentsQuery.data ?? []) {
      const existing = map.get(run.target_id)
      if (!existing || run.id > existing.id) map.set(run.target_id, run)
    }
    return map
  }, [assessmentsQuery.data])

  const targets = data ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Targets</h1>
            <HelpHint label="Why register targets" className="mt-1">
              Only targets listed here may ever be scanned by the platform. Registering records what you are
              authorized to test and sets the boundaries the scan engine must respect.
            </HelpHint>
          </div>
          <p className="text-sm text-muted-foreground">
            Authorized applications, intensity boundaries, and 1-click scan triggers.
          </p>
        </div>

        <TargetFormDialog onCreatedAndScan={(created) => setScanTarget(created)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registered targets</CardTitle>
          <CardDescription>
            Launch a live assessment, import offline Nmap/ZAP files, or update scope boundaries directly from each row.
          </CardDescription>
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
                <TableHead>Target</TableHead>
                <TableHead>Intensity</TableHead>
                <TableHead className="hidden lg:table-cell">Scope</TableHead>
                <TableHead className="hidden xl:table-cell">Authorization</TableHead>
                <TableHead className="hidden md:table-cell">Latest run</TableHead>
                {canManage && <TableHead className="w-40 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                [0, 1, 2].map((index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={canManage ? 6 : 5}>
                      <Skeleton className="h-9 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {!isLoading && targets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="h-40 text-center">
                    <EmptyState
                      icon={Crosshair}
                      title="No targets registered yet"
                      description="Register an authorized web application to launch scans or import external tool reports."
                      className="py-4"
                      action={
                        canManage ? (
                          <TargetFormDialog onCreatedAndScan={(created) => setScanTarget(created)} />
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
              {targets.map((target) => {
                const latest = latestByTarget.get(target.id)
                return (
                  <TableRow key={target.id}>
                    <TableCell className="py-3.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">{target.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{target.base_url}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={target.allowed_intensity === "full_intrusive" ? "destructive" : "secondary"}>
                        {target.allowed_intensity === "full_intrusive" ? "Full / intrusive" : "Passive / safe"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      <div className="flex flex-col gap-0.5">
                        <span>{target.in_scope_assets.length} in-scope</span>
                        <span>{target.out_of_scope_assets.length} excluded</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate text-xs text-muted-foreground xl:table-cell">
                      {target.authorization_ref || "None"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {latest ? (
                        <Link
                          to={`/assessments/${latest.id}`}
                          className="inline-flex items-center gap-1.5 text-xs hover:underline"
                        >
                          <span className="font-mono text-muted-foreground">#{latest.id}</span>
                          <Badge variant={STATUS_VARIANT[latest.status]}>{latest.status}</Badge>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not scanned</span>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button size="xs" variant="default" onClick={() => setScanTarget(target)}>
                            <Play data-icon="inline-start" />
                            Scan
                          </Button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Import scan for ${target.name}`}
                                onClick={() => setImportTarget(target)}
                              >
                                <FileUp />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Import Nmap / ZAP scan</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Edit ${target.name}`}
                                onClick={() => setEditingTarget(target)}
                              >
                                <Pencil />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit target &amp; scope</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit target modal */}
      <TargetFormDialog
        key={editingTarget?.id ?? "none"}
        target={editingTarget}
        open={editingTarget !== null}
        onOpenChange={(open) => !open && setEditingTarget(null)}
      />

      {/* Pre-bound Quick Assessment modal */}
      <QuickAssessmentDialog
        key={`scan-${scanTarget?.id ?? "none"}`}
        open={scanTarget !== null}
        onOpenChange={(open) => !open && setScanTarget(null)}
        defaultTargetId={scanTarget?.id ?? null}
        defaultIntensity={scanTarget?.allowed_intensity}
      />

      {/* Pre-bound Import Scan modal */}
      <ImportScanDialog
        key={`import-${importTarget?.id ?? "none"}`}
        targets={targets}
        defaultTargetId={importTarget?.id ?? null}
        open={importTarget !== null}
        onOpenChange={(open) => !open && setImportTarget(null)}
      />
    </div>
  )
}
