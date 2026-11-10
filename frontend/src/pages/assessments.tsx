import { useState } from "react"
import type { FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HelpHint } from "@/components/help-hint"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { ASSESSMENT_CATEGORIES } from "@/lib/types"
import type {
  Assessment,
  AssessmentCreate,
  AssessmentDetail,
  AssessmentStatus,
  ScanIntensity,
  Target,
} from "@/lib/types"

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

function NewAssessmentDialog({ targets }: { targets: Target[] }) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [targetId, setTargetId] = useState("")
  const [intensity, setIntensity] = useState<ScanIntensity>("passive_safe")
  const [categories, setCategories] = useState<string[]>([...ASSESSMENT_CATEGORIES])

  const canRun = hasRole("admin", "assessor")
  const target = targets.find((t) => String(t.id) === targetId)
  const intrusiveAllowed = target?.allowed_intensity === "full_intrusive"

  function reset() {
    setTargetId("")
    setIntensity("passive_safe")
    setCategories([...ASSESSMENT_CATEGORIES])
    setError(null)
  }

  const mutation = useMutation({
    mutationFn: (payload: AssessmentCreate) =>
      api<AssessmentDetail>("/api/assessments", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
      setOpen(false)
      reset()
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to start assessment"),
  })

  function handleTargetChange(value: string) {
    setTargetId(value)
    const next = targets.find((t) => String(t.id) === value)
    // Never leave an intensity selected that the new target does not allow.
    if (next?.allowed_intensity !== "full_intrusive") setIntensity("passive_safe")
  }

  function toggleCategory(category: string, checked: boolean) {
    setCategories((prev) => (checked ? [...prev, category] : prev.filter((c) => c !== category)))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    mutation.mutate({ target_id: Number(targetId), intensity, categories })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={!canRun || targets.length === 0}>
          <Plus className="size-4" />
          New assessment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New assessment</DialogTitle>
          <DialogDescription>
            Starting an assessment immediately launches the scan pipeline against the target. Only assess
            applications you are authorized to test.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label>Target</Label>
              <HelpHint label="Which application">
                Only registered targets can be assessed. Register new ones on the Targets page.
              </HelpHint>
            </div>
            <Select value={targetId} onValueChange={handleTargetChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a target" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name} ({t.base_url})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label>Scan intensity</Label>
              <HelpHint label="How hard tools may hit">
                Passive / safe runs non-destructive checks only. Full / intrusive adds active scanning and
                is only available when the target allows it. The server rejects anything above the
                target&apos;s allowed intensity.
              </HelpHint>
            </div>
            <Select value={intensity} onValueChange={(value) => setIntensity(value as ScanIntensity)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="passive_safe">Passive / safe</SelectItem>
                <SelectItem value="full_intrusive" disabled={!intrusiveAllowed}>
                  Full / intrusive{!intrusiveAllowed ? " (not allowed for this target)" : ""}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label>Assessment categories</Label>
              <HelpHint label="What to check">
                The kinds of weaknesses this run looks for. At least one category is required.
              </HelpHint>
            </div>
            <div className="grid gap-2 rounded-md border p-3">
              {ASSESSMENT_CATEGORIES.map((category) => (
                <label key={category} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={categories.includes(category)}
                    onChange={(e) => toggleCategory(category, e.target.checked)}
                  />
                  {category}
                </label>
              ))}
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !targetId || categories.length === 0}>
              {mutation.isPending ? "Starting…" : "Start assessment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
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
      <div className="flex items-center justify-between">
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
        <NewAssessmentDialog targets={targets.data ?? []} />
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