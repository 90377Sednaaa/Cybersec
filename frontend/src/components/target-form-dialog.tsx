import { useRef, useState } from "react"
import type { FormEvent, ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Radar } from "lucide-react"
import { toast } from "sonner"

import { HelpHint } from "@/components/help-hint"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { ScanIntensity, Target, TargetCreate, TargetUpdate } from "@/lib/types"

function parseAssetList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
}

interface TargetFormDialogProps {
  /** When supplied, edits the existing target via PATCH /api/targets/{id}. */
  target?: Target | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
  /** Optional callback invoked when the user clicks "Register & scan". */
  onCreatedAndScan?: (created: Target) => void
}

export function TargetFormDialog({
  target = null,
  open: controlledOpen,
  onOpenChange,
  trigger,
  onCreatedAndScan,
}: TargetFormDialogProps) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const isEdit = Boolean(target)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(target?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(target?.base_url ?? "")
  const [authRef, setAuthRef] = useState(target?.authorization_ref ?? "")
  const [intensity, setIntensity] = useState<ScanIntensity>(target?.allowed_intensity ?? "passive_safe")
  const [inScope, setInScope] = useState((target?.in_scope_assets ?? []).join("\n"))
  const [outScope, setOutScope] = useState((target?.out_of_scope_assets ?? []).join("\n"))
  const [launchAfterSave, setLaunchAfterSave] = useState(false)

  const canManage = hasRole("admin", "assessor")
  const isAdmin = hasRole("admin")

  function hydrateFromTarget(source: Target | null) {
    setName(source?.name ?? "")
    setBaseUrl(source?.base_url ?? "")
    setAuthRef(source?.authorization_ref ?? "")
    setIntensity(source?.allowed_intensity ?? "passive_safe")
    setInScope((source?.in_scope_assets ?? []).join("\n"))
    setOutScope((source?.out_of_scope_assets ?? []).join("\n"))
    setError(null)
    setLaunchAfterSave(false)
  }

  const mutation = useMutation({
    mutationFn: (payload: TargetCreate | TargetUpdate) =>
      target
        ? api<Target>(`/api/targets/${target.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api<Target>("/api/targets", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["targets"] })
      setOpen(false)
      toast.success(isEdit ? "Target updated" : "Target registered")
      if (!isEdit && launchAfterSave && onCreatedAndScan) {
        onCreatedAndScan(saved)
      }
      if (!isEdit) hydrateFromTarget(null)
    },
    onError: (err) => {
      setLaunchAfterSave(false)
      setError(err instanceof Error ? err.message : isEdit ? "Failed to update target" : "Failed to register target")
    },
  })

  function submitTarget(andScan: boolean) {
    setError(null)
    setLaunchAfterSave(andScan)
    const payload: TargetCreate = {
      name: name.trim(),
      base_url: baseUrl.trim(),
      authorization_ref: authRef.trim(),
      allowed_intensity: intensity,
      in_scope_assets: parseAssetList(inScope),
      out_of_scope_assets: parseAssetList(outScope),
    }
    mutation.mutate(payload)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    submitTarget(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) hydrateFromTarget(target)
        setOpen(next)
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button disabled={!canManage}>
              <Plus data-icon="inline-start" />
              Register target
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameInputRef.current?.focus()
        }}
      >
        <DialogHeader className="gap-1.5 border-b px-6 py-5">
          <DialogTitle>{isEdit ? `Edit ${target?.name}` : "Register target"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update authorization details, allowed intensity, or scope boundaries."
              : "Register a web application you are authorized to assess. Allowed intensity gates which tools may run."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="target-name">Name</Label>
                <HelpHint label="Internal name">
                  A short label used across the platform, e.g. "OWASP Juice Shop" or "Team Portal".
                </HelpHint>
              </div>
              <Input
                id="target-name"
                ref={nameInputRef}
                required
                placeholder="OWASP Juice Shop"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="target-url">Base URL</Label>
                <HelpHint label="Where scanning starts">
                  The root address of the authorized application, e.g. http://localhost:3000.
                </HelpHint>
              </div>
              <Input
                id="target-url"
                type="url"
                required
                placeholder="http://localhost:3000"
                className="font-mono text-xs"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="target-authref">Authorization reference</Label>
                <HelpHint label="Proof you may test this">
                  Who authorized this assessment and how: instructor approval, ticket ID, or site ownership.
                </HelpHint>
              </div>
              <Input
                id="target-authref"
                required
                minLength={3}
                placeholder="e.g. instructor approval #42"
                value={authRef}
                onChange={(e) => setAuthRef(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="target-intensity">Allowed scan intensity</Label>
                <HelpHint label="How hard tools may hit">
                  Passive / safe runs non-destructive checks only. Full / intrusive adds active scanning and path
                  probing for dedicated test targets. Escalation is admin-only.
                </HelpHint>
              </div>
              <Select value={intensity} onValueChange={(value) => setIntensity(value as ScanIntensity)}>
                <SelectTrigger id="target-intensity" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="passive_safe">Passive / safe (production OK)</SelectItem>
                    <SelectItem value="full_intrusive" disabled={!isAdmin && target?.allowed_intensity !== "full_intrusive"}>
                      Full / intrusive (test targets only){!isAdmin ? " (admin only)" : ""}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="in-scope">In-scope assets</Label>
                <HelpHint label="What may be tested">
                  URLs or paths allowed for assessment, one per line.
                </HelpHint>
              </div>
              <Textarea
                id="in-scope"
                rows={3}
                className="font-mono text-xs"
                value={inScope}
                onChange={(e) => setInScope(e.target.value)}
                placeholder={"http://localhost:3000\nhttp://localhost:3000/api"}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="out-scope">Out-of-scope assets</Label>
                <HelpHint label="Never automated">
                  Paths excluded from automated probing and ZAP scanning, one per line (e.g. /logout).
                </HelpHint>
              </div>
              <Textarea
                id="out-scope"
                rows={3}
                className="font-mono text-xs"
                value={outScope}
                onChange={(e) => setOutScope(e.target.value)}
                placeholder={"/logout\n/checkout"}
              />
            </div>
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
            {!isEdit && onCreatedAndScan && (
              <Button
                type="button"
                variant="secondary"
                disabled={mutation.isPending || !name.trim() || !baseUrl.trim() || authRef.trim().length < 3}
                onClick={() => submitTarget(true)}
              >
                {mutation.isPending && launchAfterSave ? <Spinner data-icon="inline-start" /> : <Radar data-icon="inline-start" />}
                Register &amp; scan
              </Button>
            )}
            <Button
              type="submit"
              disabled={mutation.isPending || !name.trim() || !baseUrl.trim() || authRef.trim().length < 3}
            >
              {mutation.isPending && !launchAfterSave ? <Spinner data-icon="inline-start" /> : null}
              {isEdit ? "Save changes" : "Register target"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
