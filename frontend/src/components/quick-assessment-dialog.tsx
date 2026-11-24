import { useState } from "react"
import type { FormEvent, ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronUp, Plus, Radar } from "lucide-react"
import { toast } from "sonner"

import { HelpHint } from "@/components/help-hint"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { ASSESSMENT_CATEGORIES } from "@/lib/types"
import type {
  AssessmentCreate,
  AssessmentDetail,
  ScanIntensity,
  ScanTool,
  Target,
  TargetCreate,
} from "@/lib/types"

const TOOL_OPTIONS: { id: ScanTool; label: string; hint: string; intrusive?: boolean }[] = [
  { id: "dns", label: "DNS", hint: "A/AAAA, MX, NS, TXT records" },
  { id: "nmap", label: "Nmap", hint: "Open ports & service versions" },
  { id: "prober", label: "HTTP Prober", hint: "Headers, TLS, cookies, paths" },
  { id: "zap", label: "OWASP ZAP", hint: "Spider & active scanner", intrusive: true },
]

function defaultToolsFor(intensity: ScanIntensity): ScanTool[] {
  return intensity === "full_intrusive" ? ["dns", "nmap", "prober", "zap"] : ["dns", "nmap", "prober"]
}

export interface QuickAssessmentDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultTargetId?: number | null
  defaultIntensity?: ScanIntensity
  defaultCategories?: string[]
  trigger?: ReactNode
}

export function QuickAssessmentDialog({
  open: controlledOpen,
  onOpenChange,
  defaultTargetId = null,
  defaultIntensity,
  defaultCategories,
  trigger,
}: QuickAssessmentDialogProps) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const targetsQuery = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
    enabled: open || !isControlled,
  })
  const targets = targetsQuery.data ?? []

  const canRun = hasRole("admin", "assessor")
  const isAdmin = hasRole("admin")

  const [error, setError] = useState<string | null>(null)
  const [targetId, setTargetId] = useState(defaultTargetId ? String(defaultTargetId) : "")
  const [creatingTarget, setCreatingTarget] = useState(false)

  // Inline quick-target fields (eliminates leaving the flow when target is new)
  const [newName, setNewName] = useState("")
  const [newUrl, setNewUrl] = useState("")
  const [newAuthRef, setNewAuthRef] = useState("")
  const [newAllowedIntensity, setNewAllowedIntensity] = useState<ScanIntensity>("passive_safe")

  const [intensity, setIntensity] = useState<ScanIntensity>(defaultIntensity ?? "passive_safe")
  const [tools, setTools] = useState<ScanTool[]>(defaultToolsFor(defaultIntensity ?? "passive_safe"))
  const [categories, setCategories] = useState<string[]>(
    defaultCategories && defaultCategories.length > 0 ? [...defaultCategories] : [...ASSESSMENT_CATEGORIES],
  )
  const [showCategories, setShowCategories] = useState(false)

  function syncDefaults() {
    const resolvedTarget =
      defaultTargetId != null ? targets.find((t) => t.id === defaultTargetId) : targets.length === 1 ? targets[0] : undefined
    const nextTargetId = defaultTargetId != null ? String(defaultTargetId) : resolvedTarget ? String(resolvedTarget.id) : ""
    const nextIntensity: ScanIntensity =
      defaultIntensity && resolvedTarget?.allowed_intensity === "full_intrusive"
        ? defaultIntensity
        : defaultIntensity === "passive_safe"
          ? "passive_safe"
          : resolvedTarget?.allowed_intensity ?? "passive_safe"

    setTargetId(nextTargetId)
    setCreatingTarget(targets.length === 0 && defaultTargetId == null)
    setNewName("")
    setNewUrl("")
    setNewAuthRef("")
    setNewAllowedIntensity("passive_safe")
    setIntensity(nextIntensity)
    setTools(defaultToolsFor(nextIntensity))
    setCategories(
      defaultCategories && defaultCategories.length > 0 ? [...defaultCategories] : [...ASSESSMENT_CATEGORIES],
    )
    setShowCategories(false)
    setError(null)
  }

  const selectedTarget = targets.find((t) => String(t.id) === targetId)
  const effectiveAllowedIntensity: ScanIntensity = creatingTarget
    ? newAllowedIntensity
    : (selectedTarget?.allowed_intensity ?? "passive_safe")
  const intrusiveAllowed = effectiveAllowedIntensity === "full_intrusive"

  function handleTargetChange(value: string) {
    setTargetId(value)
    setCreatingTarget(false)
    const next = targets.find((t) => String(t.id) === value)
    if (next?.allowed_intensity !== "full_intrusive") {
      setIntensity("passive_safe")
      setTools((prev) => prev.filter((t) => t !== "zap"))
    }
  }

  function handleIntensityChange(next: ScanIntensity) {
    setIntensity(next)
    if (next === "passive_safe") {
      setTools((prev) => {
        const filtered = prev.filter((t) => t !== "zap")
        return filtered.length > 0 ? filtered : ["dns", "nmap", "prober"]
      })
    } else if (!tools.includes("zap")) {
      setTools((prev) => [...prev, "zap"])
    }
  }

  function toggleTool(tool: ScanTool, checked: boolean) {
    setTools((prev) => {
      if (checked) return prev.includes(tool) ? prev : [...prev, tool]
      return prev.filter((item) => item !== tool)
    })
  }

  function toggleCategory(category: string, checked: boolean) {
    setCategories((prev) => (checked ? [...prev, category] : prev.filter((c) => c !== category)))
  }

  const launchMutation = useMutation({
    mutationFn: async () => {
      let resolvedTargetId = Number(targetId)
      if (creatingTarget) {
        const created = await api<Target>("/api/targets", {
          method: "POST",
          body: JSON.stringify({
            name: newName.trim(),
            base_url: newUrl.trim(),
            authorization_ref: newAuthRef.trim(),
            allowed_intensity: newAllowedIntensity,
            in_scope_assets: [newUrl.trim()],
            out_of_scope_assets: [],
          } satisfies TargetCreate),
        })
        queryClient.invalidateQueries({ queryKey: ["targets"] })
        resolvedTargetId = created.id
      }

      const payload: AssessmentCreate = {
        target_id: resolvedTargetId,
        intensity,
        categories,
        tools,
      }
      return api<AssessmentDetail>("/api/assessments", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    },
    onSuccess: (assessment) => {
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
      queryClient.invalidateQueries({ queryKey: ["targets"] })
      setOpen(false)
      toast.success(`Assessment #${assessment.id} started`)
      navigate(`/assessments/${assessment.id}`)
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to start assessment"),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    launchMutation.mutate()
  }

  const targetReady = creatingTarget
    ? Boolean(newName.trim() && newUrl.trim() && newAuthRef.trim().length >= 3)
    : Boolean(targetId)
  const canSubmit = targetReady && tools.length > 0 && categories.length > 0 && !launchMutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) syncDefaults()
        setOpen(next)
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button disabled={!canRun}>
              <Plus data-icon="inline-start" />
              New assessment
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="gap-1.5 border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <Radar className="size-4 text-primary" />
            Launch security assessment
          </DialogTitle>
          <DialogDescription>
            Choose an authorized target (or register one inline), pick the scan tools, and launch the live pipeline.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {/* Target selection or inline target creation */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="quick-target">Target</Label>
                <HelpHint label="Authorized target">
                  Only registered, authorized applications may be scanned. Register a new target inline or pick an
                  existing one.
                </HelpHint>
              </div>
              {targets.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setCreatingTarget((prev) => !prev)
                    setError(null)
                  }}
                >
                  {creatingTarget ? "Choose existing target" : "+ Register new target"}
                </Button>
              )}
            </div>

            {!creatingTarget ? (
              <Select value={targetId} onValueChange={handleTargetChange}>
                <SelectTrigger id="quick-target" className="w-full">
                  <SelectValue placeholder="Choose a registered target" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {targets.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        <span className="font-medium">{t.name}</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">({t.base_url})</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/25 p-4">
                <p className="text-xs font-medium text-muted-foreground">New authorized target</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="inline-target-name" className="text-xs">
                      Name
                    </Label>
                    <Input
                      id="inline-target-name"
                      required
                      placeholder="OWASP Juice Shop"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="inline-target-url" className="text-xs">
                      Base URL
                    </Label>
                    <Input
                      id="inline-target-url"
                      type="url"
                      required
                      placeholder="http://localhost:3000"
                      className="font-mono text-xs"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="inline-target-auth" className="text-xs">
                      Authorization reference
                    </Label>
                    <Input
                      id="inline-target-auth"
                      required
                      minLength={3}
                      placeholder="e.g. instructor approval #42"
                      value={newAuthRef}
                      onChange={(e) => setNewAuthRef(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="inline-target-intensity" className="text-xs">
                      Allowed intensity
                    </Label>
                    <Select
                      value={newAllowedIntensity}
                      onValueChange={(val) => {
                        const next = val as ScanIntensity
                        setNewAllowedIntensity(next)
                        handleIntensityChange(next)
                      }}
                    >
                      <SelectTrigger id="inline-target-intensity" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="passive_safe">Passive / safe</SelectItem>
                          <SelectItem value="full_intrusive" disabled={!isAdmin}>
                            Full / intrusive{!isAdmin ? " (admin only)" : ""}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Intensity */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="quick-intensity">Scan intensity</Label>
                <HelpHint label="Intensity gate">
                  Passive / safe runs non-destructive recon and header/TLS checks. Full / intrusive adds path probing
                  and OWASP ZAP active scanning when allowed by the target.
                </HelpHint>
              </div>
              {selectedTarget && !creatingTarget && (
                <Badge variant="outline" className="text-xs font-normal">
                  Target cap: {selectedTarget.allowed_intensity === "full_intrusive" ? "Full / intrusive" : "Passive / safe"}
                </Badge>
              )}
            </div>
            <Select value={intensity} onValueChange={(value) => handleIntensityChange(value as ScanIntensity)}>
              <SelectTrigger id="quick-intensity" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="passive_safe">Passive / safe (non-destructive)</SelectItem>
                  <SelectItem value="full_intrusive" disabled={!intrusiveAllowed}>
                    Full / intrusive{!intrusiveAllowed ? " (not allowed for this target)" : ""}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Scan tools selection */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Tools to run</Label>
              <span className="text-xs text-muted-foreground">
                Recon tools run in parallel; {tools.length} selected
              </span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {TOOL_OPTIONS.map((tool) => {
                const blocked = Boolean(tool.intrusive && intensity !== "full_intrusive")
                const checked = tools.includes(tool.id) && !blocked
                return (
                  <label
                    key={tool.id}
                    htmlFor={`tool-${tool.id}`}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                      blocked
                        ? "cursor-not-allowed bg-muted/20 opacity-55"
                        : checked
                          ? "cursor-pointer border-primary/40 bg-primary/5"
                          : "cursor-pointer hover:bg-muted/40"
                    }`}
                  >
                    <Checkbox
                      id={`tool-${tool.id}`}
                      checked={checked}
                      disabled={blocked}
                      onCheckedChange={(val) => toggleTool(tool.id, val === true)}
                      className="mt-0.5"
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium leading-none">{tool.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {blocked ? "Requires full / intrusive intensity" : tool.hint}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <Separator />

          {/* Collapsible categories (defaults to all 5 so common launches stay uncluttered) */}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => setShowCategories((prev) => !prev)}
              className="flex items-center justify-between rounded-md text-left text-sm font-medium text-foreground transition-colors hover:text-primary"
              aria-expanded={showCategories}
            >
              <span className="flex items-center gap-2">
                Assessment categories
                <Badge variant="secondary" className="font-mono text-xs font-normal">
                  {categories.length}/{ASSESSMENT_CATEGORIES.length}
                </Badge>
              </span>
              {showCategories ? (
                <ChevronUp className="size-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" />
              )}
            </button>

            {showCategories && (
              <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/20 p-3.5">
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setCategories([...ASSESSMENT_CATEGORIES])}
                  >
                    Select all
                  </Button>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setCategories([])}>
                    Clear
                  </Button>
                </div>
                {ASSESSMENT_CATEGORIES.map((category) => (
                  <label key={category} htmlFor={`cat-${category}`} className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <Checkbox
                      id={`cat-${category}`}
                      checked={categories.includes(category)}
                      onCheckedChange={(checked) => toggleCategory(category, checked === true)}
                    />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {launchMutation.isPending ? <Spinner data-icon="inline-start" /> : <Radar data-icon="inline-start" />}
              {launchMutation.isPending ? "Starting..." : "Start assessment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
