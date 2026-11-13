import { useState } from "react"
import type { FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bot, Check, Eye, EyeOff, Info, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react"

import { HelpHint } from "@/components/help-hint"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import {
  PROVIDER_PRESETS,
  detectProviderFromKey,
  findMatchingPresetId,
} from "@/lib/llm-presets"
import type { LLMProvider, LLMProviderInput, LLMSettings } from "@/lib/types"
import { TaskModelsCard, TestConnectionButton } from "@/pages/settings-tasks"

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-"
}

function ProviderForm({ provider, onDone }: { provider: LLMProvider | null; onDone: () => void }) {
  const queryClient = useQueryClient()
  const defaultPreset = PROVIDER_PRESETS[0]
  const initialPreset = provider
    ? findMatchingPresetId(provider.name, provider.base_url)
    : defaultPreset.id
  const [presetId, setPresetId] = useState(initialPreset)
  const [name, setName] = useState(provider?.name ?? defaultPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? defaultPreset.baseUrl)
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [showAdvancedUrl, setShowAdvancedUrl] = useState(initialPreset === "custom")
  const [detectedBadge, setDetectedBadge] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(provider?.enabled ?? false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleApiKeyChange(val: string) {
    setApiKey(val)
    if (!provider && val.trim()) {
      const detected = detectProviderFromKey(val)
      if (detected) {
        const found = PROVIDER_PRESETS.find((p) => p.id === detected)
        if (found) {
          setPresetId(detected)
          setName(found.name)
          setBaseUrl(found.baseUrl)
          setDetectedBadge(found.name)
          return
        }
      }
    }
    setDetectedBadge(null)
  }

  function handlePresetChange(newPresetId: string) {
    setPresetId(newPresetId)
    setDetectedBadge(null)
    const selected = PROVIDER_PRESETS.find((p) => p.id === newPresetId)
    if (selected && newPresetId !== "custom") {
      setName(selected.name)
      setBaseUrl(selected.baseUrl)
      setShowAdvancedUrl(false)
    } else if (newPresetId === "custom") {
      setShowAdvancedUrl(true)
    }
  }

  // Enabling needs an explicit acknowledgment unless one was already recorded.
  const needsAcknowledgment = enabled && !provider?.acknowledged_external_at

  const mutation = useMutation({
    mutationFn: (payload: LLMProviderInput) =>
      api<LLMProvider>(
        provider ? `/api/settings/llm/providers/${provider.id}` : "/api/settings/llm/providers",
        { method: provider ? "PUT" : "POST", body: JSON.stringify(payload) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["llm-settings"] })
      queryClient.invalidateQueries({ queryKey: ["llm-models"] })
      onDone()
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to save provider"),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    mutation.mutate({
      name: name.trim(),
      base_url: baseUrl.trim(),
      api_key: apiKey,
      enabled,
      acknowledged_external_processing: acknowledged ? true : null,
    })
  }

  const selectedPreset = PROVIDER_PRESETS.find((p) => p.id === presetId)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Connection</h3>
        <p className="text-xs text-muted-foreground">Connect an OpenAI-compatible endpoint. Keys are encrypted at rest.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="provider-preset">Provider</Label>
              <HelpHint label="Provider preset">
                Choose a provider or paste your API key below for automatic detection.
              </HelpHint>
            </div>
            {detectedBadge && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                <Check className="size-3" />
                Detected {detectedBadge}
              </span>
            )}
          </div>
          <Select value={presetId} onValueChange={handlePresetChange}>
            <SelectTrigger id="provider-preset">
              <SelectValue placeholder="Select a provider..." />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedPreset?.note && (
            <p className="text-xs leading-snug text-muted-foreground">{selectedPreset.note}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="provider-key">API key</Label>
            <HelpHint label="Encrypted at rest">
              Stored encrypted with Fernet and never logged or returned by the API.
            </HelpHint>
          </div>
          <div className="relative">
            <Input
              id="provider-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              className="pr-9 font-mono text-xs"
              placeholder={
                provider?.has_api_key
                  ? "Leave blank to keep the current key"
                  : selectedPreset?.placeholderKey || "Paste API key"
              }
              value={apiKey}
              onChange={(event) => handleApiKeyChange(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowKey((current) => !current)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {presetId === "ollama" && (
            <p className="text-xs text-muted-foreground">
              Local Ollama typically needs no key unless it runs behind an authenticated proxy.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="provider-name">Display name</Label>
          <Input id="provider-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>

        {presetId !== "custom" && !showAdvancedUrl ? (
          <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-muted-foreground">Endpoint URL</span>
              <button
                type="button"
                onClick={() => setShowAdvancedUrl(true)}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Customize endpoint
              </button>
            </div>
            <p className="break-all font-mono text-muted-foreground">{baseUrl || "(standard endpoint)"}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="provider-url">Base URL</Label>
                <HelpHint label="OpenAI-compatible endpoint">
                  Address of the OpenAI-compatible endpoint. Standard endpoints are pre-filled.
                </HelpHint>
              </div>
              {presetId !== "custom" && (
                <button
                  type="button"
                  onClick={() => {
                    setBaseUrl(selectedPreset?.baseUrl || "")
                    setShowAdvancedUrl(false)
                  }}
                  className="text-[11px] text-muted-foreground hover:underline"
                >
                  Reset to default
                </button>
              )}
            </div>
            <Input
              id="provider-url"
              type="url"
              className="font-mono text-xs"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              required
            />
          </div>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Access</h3>
        <p className="text-xs text-muted-foreground">Control whether this service may receive redacted scan data.</p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Enabled</span>
          <span className="text-xs text-muted-foreground">AI features can use this provider for assigned tasks.</span>
        </div>
        <Switch
          id="provider-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Enable provider"
        />
      </div>

      {needsAcknowledgment && (
        <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <Checkbox
            id="provider-ack"
            className="mt-0.5"
            checked={acknowledged}
            onCheckedChange={(value) => setAcknowledged(value === true)}
          />
          <Label htmlFor="provider-ack" className="flex-1 cursor-pointer font-normal leading-relaxed">
            I understand that redacted scan data may be sent to this external AI service, and that no credentials or
            confidential data should be sent to public AI services.
          </Label>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter className="sticky bottom-0 gap-2 bg-background pt-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={mutation.isPending || !name.trim() || !baseUrl.trim() || (needsAcknowledgment && !acknowledged)}
        >
          {mutation.isPending ? "Saving..." : provider ? "Save changes" : "Add provider"}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function SettingsPage() {
  const { hasRole } = useAuth()
  const isAdmin = hasRole("admin")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LLMProvider | null>(null)
  const [deleting, setDeleting] = useState<LLMProvider | null>(null)
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: (providerId: number) =>
      api<void>(`/api/settings/llm/providers/${providerId}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ["llm-settings"] })
    },
  })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["llm-settings"],
    queryFn: () => api<LLMSettings>("/api/settings/llm"),
  })

  const providers = data?.providers ?? []
  const configs = data?.task_configs ?? []
  const enabledCount = providers.filter((provider) => provider.enabled).length
  const assignedCount = configs.filter((config) => config.provider_id !== null && config.model.trim() !== "").length

  function openDialog(provider: LLMProvider | null) {
    setEditing(provider)
    setDialogOpen(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
            <HelpHint label="AI settings" className="mt-1.5">
              Choose which AI service the platform uses to interpret scan results and write summaries. Only admins
              can change these settings.
            </HelpHint>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure providers, browse live model catalogs and assign a model to each task.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => openDialog(null)}>
            <Plus className="size-4" />
            Add provider
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Bot className="size-3.5" />
          {providers.length} {providers.length === 1 ? "provider" : "providers"}
        </span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          {enabledCount} enabled
        </span>
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5" />
          {assignedCount} of {configs.length} tasks assigned
        </span>
        <span className="flex items-center gap-1.5 sm:ml-auto">
          <ShieldCheck className="size-3.5" />
          Keys encrypted at rest
        </span>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1.5">
            <CardTitle>AI providers</CardTitle>
            <CardDescription>
              Enabling a provider may send redacted scan data to that service. API keys are write-only and never shown.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!isAdmin && (
            <Alert>
              <AlertDescription>Read-only: only admins can change AI settings.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{error.message}</span>
                <Button variant="ghost" size="xs" onClick={() => void refetch()}>
                  <RefreshCw className="size-3" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="divide-y rounded-lg border">
            {isLoading && (
              <div className="flex flex-col gap-2 p-4">
                {[0, 1].map((index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            )}
            {!isLoading && providers.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="size-5" />
                </div>
                <p className="text-sm font-medium">No AI providers yet</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {isAdmin
                    ? "Add a provider to enable AI interpretation of scan results."
                    : "Ask an admin to configure an AI provider."}
                </p>
                {isAdmin && (
                  <Button variant="outline" size="sm" className="mt-1" onClick={() => openDialog(null)}>
                    <Plus className="size-3.5" />
                    Add provider
                  </Button>
                )}
              </div>
            )}
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Bot className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{provider.name}</span>
                      <Badge variant={provider.enabled ? "default" : "outline"}>
                        {provider.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{provider.base_url}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:justify-end">
                  <Badge variant={provider.has_api_key ? "secondary" : "outline"} className="gap-1">
                    <KeyRound className="size-3" />
                    {provider.has_api_key ? "Key set" : "No key"}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {provider.acknowledged_external_at
                      ? `Acknowledged ${formatDate(provider.acknowledged_external_at)}`
                      : "External use not acknowledged"}
                  </span>
                  {isAdmin && (
                    <div className="flex items-center gap-1.5">
                      <TestConnectionButton providerId={provider.id} />
                      <Button variant="ghost" size="xs" onClick={() => openDialog(provider)}>
                        <Pencil className="size-3" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(provider)}
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <TaskModelsCard configs={configs} providers={providers} isAdmin={isAdmin} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit provider" : "Add provider"}</DialogTitle>
            <DialogDescription>
              Connect an OpenAI-compatible AI service. The key is stored encrypted and is never shown again.
            </DialogDescription>
          </DialogHeader>
          <ProviderForm provider={editing} onDone={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete provider?</DialogTitle>
            <DialogDescription>
              {deleting?.name} will be removed along with its stored key. Any task that uses it is reset to no
              provider, so AI analysis stops until another provider is assigned. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{deleteMutation.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
