import { useRef, useState } from "react"
import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, FileCode, FileUp, Terminal, UploadCloud, X } from "lucide-react"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { AssessmentDetail, Target } from "@/lib/types"

type ToolChoice = "nmap" | "zap"

function safeHostname(url: string | undefined): string {
  if (!url) return "target-host"
  try {
    return new URL(url).hostname || "target-host"
  } catch {
    return "target-host"
  }
}

interface ImportScanDialogProps {
  targets: Target[]
  defaultTargetId?: number | null
  assessmentId?: number | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
}

export function ImportScanDialog({
  targets,
  defaultTargetId = null,
  assessmentId = null,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: ImportScanDialogProps) {
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

  const [targetId, setTargetId] = useState(defaultTargetId ? String(defaultTargetId) : "")
  const [tool, setTool] = useState<ToolChoice>("nmap")
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const canImport = hasRole("admin", "assessor")
  const effectiveTargetId = defaultTargetId != null ? String(defaultTargetId) : targetId
  const selectedTarget = targets.find((t) => String(t.id) === effectiveTargetId)

  const targetHost = safeHostname(selectedTarget?.base_url)
  const cliSnippet =
    tool === "nmap"
      ? `nmap -sV -oX scan.xml ${targetHost}`
      : `zap-cli quick-scan --spider -r -o zap.json ${selectedTarget?.base_url ?? "https://target-url"}`

  function reset() {
    setTargetId(defaultTargetId ? String(defaultTargetId) : "")
    setTool("nmap")
    setFile(null)
    setDragActive(false)
    setError(null)
  }

  function handleFileSelected(selected: File | null) {
    if (!selected) return
    setError(null)

    if (tool === "nmap" && !selected.name.toLowerCase().endsWith(".xml")) {
      setError("Nmap import expects an XML file (e.g. scan.xml generated via nmap -oX).")
      return
    }
    if (tool === "zap" && !selected.name.toLowerCase().endsWith(".json")) {
      setError("OWASP ZAP import expects a JSON report file (e.g. zap.json).")
      return
    }

    setFile(selected)
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0])
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0])
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  function handleCopySnippet() {
    navigator.clipboard.writeText(cliSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!effectiveTargetId || !file) {
        throw new Error("Target and scan file are required.")
      }

      const formData = new FormData()
      formData.append("target_id", effectiveTargetId)
      formData.append("tool", tool)
      formData.append("file", file)
      if (assessmentId != null) {
        formData.append("assessment_id", String(assessmentId))
      }

      return api<AssessmentDetail>("/api/assessments/import", {
        method: "POST",
        body: formData,
      })
    },
    onSuccess: (assessment) => {
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
      queryClient.invalidateQueries({ queryKey: ["assessment", assessment.id] })
      queryClient.invalidateQueries({ queryKey: ["findings"] })
      setOpen(false)
      reset()
      toast.success(`Imported ${tool.toUpperCase()} scan`)
      if (assessmentId == null) {
        navigate(`/assessments/${assessment.id}`)
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to import scan")
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" disabled={!canImport || targets.length === 0}>
              <FileUp data-icon="inline-start" />
              Import scan
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="size-5 text-primary" />
            {assessmentId != null ? `Import scan into Assessment #${assessmentId}` : "Import external scan"}
          </DialogTitle>
          <DialogDescription>
            Attach offline or manual scan results from local tools. Findings are normalized and forwarded to AI
            interpretation automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 pt-1">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="import-target">Target</Label>
            <Select
              value={effectiveTargetId}
              disabled={defaultTargetId != null}
              onValueChange={(val) => {
                setTargetId(val)
                setError(null)
              }}
            >
              <SelectTrigger id="import-target" className="w-full">
                <SelectValue placeholder="Select authorized target" />
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
            {selectedTarget && (
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-xs text-muted-foreground">Scope limit:</span>
                <Badge variant="outline" className="text-xs">
                  {selectedTarget.allowed_intensity === "full_intrusive" ? "Full / intrusive" : "Passive / safe"}
                </Badge>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Tool format</Label>
            <Tabs
              value={tool}
              onValueChange={(val) => {
                setTool(val as ToolChoice)
                setFile(null)
                setError(null)
              }}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="nmap">
                  <Terminal />
                  Nmap (XML)
                </TabsTrigger>
                <TabsTrigger value="zap">
                  <FileCode />
                  OWASP ZAP (JSON)
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">CLI execution reference</span>
              <Button type="button" variant="ghost" size="xs" onClick={handleCopySnippet}>
                {copied ? <Check className="text-primary" /> : <Copy />}
                <span className="sr-only">Copy command</span>
              </Button>
            </div>
            <code className="block overflow-x-auto font-mono text-xs text-foreground/90 select-all">
              {cliSnippet}
            </code>
            {tool === "zap" && (
              <p className="text-xs text-muted-foreground">
                Or in ZAP GUI: Report &rarr; Generate Report &rarr; JSON format.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Scan file</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={tool === "nmap" ? ".xml" : ".json"}
              onChange={handleFileChange}
              className="hidden"
            />

            {!file ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-border/80 hover:border-primary/50 hover:bg-muted/20"
                }`}
              >
                <UploadCloud className="size-8 text-muted-foreground" />
                <p className="pt-2 text-sm font-medium text-foreground">Click to browse or drag file here</p>
                <p className="pt-1 text-xs text-muted-foreground">
                  {tool === "nmap" ? "Accepts .xml files (up to 25 MB)" : "Accepts .json files (up to 25 MB)"}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3.5">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="rounded-md bg-primary/10 p-2 text-primary">
                    <FileCode className="size-5" />
                  </div>
                  <div className="truncate">
                    <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setFile(null)}>
                  <X />
                  <span className="sr-only">Remove file</span>
                </Button>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!effectiveTargetId || !file || mutation.isPending}>
              {mutation.isPending ? <Spinner data-icon="inline-start" /> : <UploadCloud data-icon="inline-start" />}
              {mutation.isPending ? "Importing & analyzing..." : "Import & analyze"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
