import { useRef, useState } from "react"
import type { ChangeEvent, DragEvent, FormEvent } from "react"
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

interface ImportScanDialogProps {
  targets: Target[]
}

export function ImportScanDialog({ targets }: ImportScanDialogProps) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState("")
  const [tool, setTool] = useState<ToolChoice>("nmap")
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const canImport = hasRole("admin", "assessor")
  const selectedTarget = targets.find((t) => String(t.id) === targetId)

  const targetHost = selectedTarget ? new URL(selectedTarget.base_url).hostname : "target-host"
  const cliSnippet =
    tool === "nmap"
      ? `nmap -sV -oX scan.xml ${targetHost}`
      : `zap-cli quick-scan --spider -r -o zap.json ${selectedTarget?.base_url ?? "https://target-url"}`

  function reset() {
    setTargetId("")
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
      if (!targetId || !file) {
        throw new Error("Target and scan file are required.")
      }

      const formData = new FormData()
      formData.append("target_id", targetId)
      formData.append("tool", tool)
      formData.append("file", file)

      return api<AssessmentDetail>("/api/assessments/import", {
        method: "POST",
        body: formData,
      })
    },
    onSuccess: (assessment) => {
      queryClient.invalidateQueries({ queryKey: ["assessments"] })
      setOpen(false)
      reset()
      toast.success(`Imported ${tool.toUpperCase()} scan successfully`)
      navigate(`/assessments/${assessment.id}`)
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
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!canImport || targets.length === 0} className="gap-2">
          <FileUp className="size-4" />
          Import scan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="size-5 text-primary" />
            Import external scan
          </DialogTitle>
          <DialogDescription>
            Attach offline or manual scan results from local tools. Findings will be automatically
            normalized and forwarded to AI interpretation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="import-target">Target</Label>
            <Select value={targetId} onValueChange={(val) => { setTargetId(val); setError(null); }}>
              <SelectTrigger id="import-target" className="w-full">
                <SelectValue placeholder="Select authorized target" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-muted-foreground text-xs font-mono">({t.base_url})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTarget && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-muted-foreground text-xs">Scope limit:</span>
                <Badge variant="outline" className="text-xs">
                  {selectedTarget.allowed_intensity === "full_intrusive" ? "Full / intrusive" : "Passive / safe"}
                </Badge>
              </div>
            )}
          </div>

          <div className="space-y-2">
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
                <TabsTrigger value="nmap" className="gap-2">
                  <Terminal className="size-4" />
                  Nmap (XML)
                </TabsTrigger>
                <TabsTrigger value="zap" className="gap-2">
                  <FileCode className="size-4" />
                  OWASP ZAP (JSON)
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center justify-between pb-1">
              <span className="text-muted-foreground text-xs font-medium">CLI execution reference:</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopySnippet}
                className="h-6 px-2 text-xs"
              >
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                <span className="sr-only">Copy command</span>
              </Button>
            </div>
            <code className="text-foreground/90 block overflow-x-auto font-mono text-xs select-all">
              {cliSnippet}
            </code>
            {tool === "zap" && (
              <p className="text-muted-foreground pt-1.5 text-xs">
                Or in ZAP GUI: <em>Report &rarr; Generate Report &rarr; JSON format</em>.
              </p>
            )}
          </div>

          <div className="space-y-2">
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
                <UploadCloud className="text-muted-foreground size-8" />
                <p className="text-foreground pt-2 text-sm font-medium">
                  Click to browse or drag file here
                </p>
                <p className="text-muted-foreground pt-1 text-xs">
                  {tool === "nmap" ? "Accepts .xml files (up to 25MB)" : "Accepts .json files (up to 25MB)"}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/20 p-3">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="rounded-md bg-primary/10 p-2 text-primary">
                    <FileCode className="size-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-foreground truncate text-sm font-medium">{file.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFile(null)}
                  className="size-8 p-0"
                >
                  <X className="size-4" />
                  <span className="sr-only">Remove file</span>
                </Button>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!targetId || !file || mutation.isPending}
              className="gap-2"
            >
              {mutation.isPending ? (
                <>
                  <Spinner className="size-4" />
                  Importing & analyzing...
                </>
              ) : (
                <>
                  <UploadCloud className="size-4" />
                  Import & analyze
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
