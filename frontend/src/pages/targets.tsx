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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { HelpHint } from "@/components/help-hint"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { ScanIntensity, Target, TargetCreate } from "@/lib/types"

function parseAssetList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function RegisterTargetDialog() {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [authRef, setAuthRef] = useState("")
  const [intensity, setIntensity] = useState<ScanIntensity>("passive_safe")
  const [inScope, setInScope] = useState("")
  const [outScope, setOutScope] = useState("")

  const canManage = hasRole("admin", "assessor")

  const mutation = useMutation({
    mutationFn: (payload: TargetCreate) =>
      api<Target>("/api/targets", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["targets"] })
      setOpen(false)
      setName("")
      setBaseUrl("")
      setAuthRef("")
      setIntensity("passive_safe")
      setInScope("")
      setOutScope("")
      setError(null)
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to register target"),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    mutation.mutate({
      name,
      base_url: baseUrl,
      authorization_ref: authRef,
      allowed_intensity: intensity,
      in_scope_assets: parseAssetList(inScope),
      out_of_scope_assets: parseAssetList(outScope),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!canManage}>
          <Plus className="size-4" />
          Register target
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register target</DialogTitle>
          <DialogDescription>
            Register a web application you are authorized to assess. The allowed intensity gates which tools the
            orchestrator may run against it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="target-name">Name</Label>
              <HelpHint label="Internal name">
                A short label used across the platform to identify this application, e.g. "OWASP Juice Shop"
                or "Team Portal".
              </HelpHint>
            </div>
            <Input id="target-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="target-url">Base URL</Label>
              <HelpHint label="Where scanning starts">
                The root address of the application you are authorized to assess, e.g. http://localhost:3000.
                All discovery and scanning starts from this origin.
              </HelpHint>
            </div>
            <Input
              id="target-url"
              type="url"
              required
              placeholder="http://localhost:3000"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="target-authref">Authorization reference</Label>
              <HelpHint label="Proof you may test this">
                Who authorized this assessment and how: instructor approval, system-owner consent, or site
                ownership. Kept as an audit record; scanning without authorization violates the assessment
                rules.
              </HelpHint>
            </div>
            <Input
              id="target-authref"
              placeholder="e.g. instructor approval #42 / ownership"
              value={authRef}
              onChange={(e) => setAuthRef(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label>Allowed scan intensity</Label>
              <HelpHint label="How hard tools may hit">
                Passive / safe: non-destructive checks only (headers, TLS, spider, DNS) and is safe for
                production sites. Full / intrusive: adds active scanning and wordlist brute forcing, use only
                for dedicated test targets. The orchestrator refuses intrusive tools beyond this gate.
              </HelpHint>
            </div>
            <Select value={intensity} onValueChange={(value) => setIntensity(value as ScanIntensity)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="passive_safe">Passive / safe (headers, spider, DNS, production OK)</SelectItem>
                <SelectItem value="full_intrusive">Full / intrusive (active scan, brute force, test targets only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="in-scope">In-scope assets (one per line)</Label>
              <HelpHint label="What may be tested">
                URLs or paths the assessment is allowed to touch, one per line. Anything not listed here is
                treated as out of scope by the orchestrator.
              </HelpHint>
            </div>
            <Textarea
              id="in-scope"
              rows={3}
              value={inScope}
              onChange={(e) => setInScope(e.target.value)}
              placeholder={"http://localhost:3000\nhttp://localhost:3000/api"}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="out-scope">Out-of-scope assets (one per line)</Label>
              <HelpHint label="What must never be automated">
                Paths to exclude from all automation, one per line, e.g. /logout or payment actions. Manual
                testing may still cover them.
              </HelpHint>
            </div>
            <Textarea
              id="out-scope"
              rows={2}
              value={outScope}
              onChange={(e) => setOutScope(e.target.value)}
              placeholder="/logout, never automated"
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Registering…" : "Register target"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TargetsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["targets"],
    queryFn: () => api<Target[]>("/api/targets"),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Targets</h1>
            <HelpHint label="Why register targets" className="mt-1.5">
              Only targets listed here may ever be scanned by the platform. Registering records what you are
              authorized to test and sets the boundaries the scan engine must respect.
            </HelpHint>
          </div>
          <p className="text-sm text-muted-foreground">Authorized targets and testing boundaries (feature 01).</p>
        </div>
        <RegisterTargetDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registered targets</CardTitle>
          <CardDescription>Only targets listed here may be scanned by the platform.</CardDescription>
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
                <TableHead>Name</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>Intensity</TableHead>
                <TableHead>In scope</TableHead>
                <TableHead>Out of scope</TableHead>
                <TableHead>Authorization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-sm font-medium">No targets registered yet</p>
                      <p className="text-xs text-muted-foreground">
                        Register the web application you are authorized to assess to begin.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {data?.map((target) => (
                <TableRow key={target.id}>
                  <TableCell className="font-medium">{target.name}</TableCell>
                  <TableCell className="font-mono text-xs">{target.base_url}</TableCell>
                  <TableCell>
                    <Badge variant={target.allowed_intensity === "full_intrusive" ? "destructive" : "secondary"}>
                      {target.allowed_intensity === "full_intrusive" ? "full / intrusive" : "passive / safe"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {target.in_scope_assets.length > 0 ? target.in_scope_assets.join(", ") : "None"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {target.out_of_scope_assets.length > 0 ? target.out_of_scope_assets.join(", ") : "None"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{target.authorization_ref || "None"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
