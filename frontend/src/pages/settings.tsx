import { useState } from "react"
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
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HelpHint } from "@/components/help-hint"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { LLMProvider, LLMProviderInput, LLMSettings } from "@/lib/types"
import { TaskModelsCard, TestConnectionButton } from "@/pages/settings-tasks"

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-"
}

function ProviderForm({ provider, onDone }: { provider: LLMProvider | null; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(provider?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? "")
  const [apiKey, setApiKey] = useState("")
  const [enabled, setEnabled] = useState(provider?.enabled ?? false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      onDone()
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to save provider"),
  })

  function handleSubmit(event: React.FormEvent) {
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="provider-name">Name</Label>
        <Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="provider-url">Base URL</Label>
          <HelpHint label="OpenAI-compatible endpoint">
            The address of an OpenAI-compatible API, for example OpenRouter or a local Ollama server.
          </HelpHint>
        </div>
        <Input
          id="provider-url"
          type="url"
          placeholder="https://openrouter.ai/api/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          required
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="provider-key">API key</Label>
          <HelpHint label="Write-only">
            The key is stored encrypted on the server and is never shown again. Leave this blank when editing to
            keep the current key.
          </HelpHint>
        </div>
        <Input
          id="provider-key"
          type="password"
          autoComplete="off"
          placeholder={provider?.has_api_key ? "Leave blank to keep the current key" : "Paste the key"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enabled
      </label>

      {needsAcknowledgment && (
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>
            I understand that redacted scan data may be sent to this external AI service, and that no credentials or
            confidential data should be sent to public AI services.
          </span>
        </label>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button
          type="submit"
          disabled={mutation.isPending || !name.trim() || !baseUrl.trim() || (needsAcknowledgment && !acknowledged)}
        >
          {mutation.isPending ? "Saving…" : provider ? "Save changes" : "Add provider"}
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

  const { data, isLoading, error } = useQuery({
    queryKey: ["llm-settings"],
    queryFn: () => api<LLMSettings>("/api/settings/llm"),
  })

  function openDialog(provider: LLMProvider | null) {
    setEditing(provider)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <HelpHint label="AI settings" className="mt-1.5">
              Choose which AI service the platform uses to interpret scan results and write summaries. Only admins
              can change these settings.
            </HelpHint>
          </div>
          <p className="text-sm text-muted-foreground">AI provider configuration (feature 04).</p>
        </div>
        {isAdmin && (
          <Button onClick={() => openDialog(null)}>
            <Plus className="size-4" />
            Add provider
          </Button>
        )}
      </div>

      {!isAdmin && (
        <Alert>
          <AlertDescription>Read-only: only admins can change AI settings.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>AI providers</CardTitle>
          <CardDescription>
            Enabling a provider means redacted scan data may be sent to that service. API keys are write-only and
            never shown.
          </CardDescription>
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
                <TableHead>Status</TableHead>
                <TableHead>API key</TableHead>
                <TableHead>External use acknowledged</TableHead>
                {isAdmin && <TableHead className="w-20" />}
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
              {!isLoading && data?.providers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-sm font-medium">No AI providers yet</p>
                      <p className="text-xs text-muted-foreground">
                        {isAdmin
                          ? "Add a provider to enable AI interpretation of scan results."
                          : "Ask an admin to configure an AI provider."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {data?.providers.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.name}</TableCell>
                  <TableCell className="font-mono text-xs">{provider.base_url}</TableCell>
                  <TableCell>
                    <Badge variant={provider.enabled ? "default" : "outline"}>
                      {provider.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={provider.has_api_key ? "secondary" : "outline"}>
                      {provider.has_api_key ? "Set" : "Not set"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(provider.acknowledged_external_at)}
                  </TableCell>
                  {isAdmin && (
                                       <TableCell>
                      <div className="flex items-start gap-2">
                        <TestConnectionButton providerId={provider.id} />
                        <Button variant="ghost" size="sm" onClick={() => openDialog(provider)}>
                          Edit
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
       </Card>

      <TaskModelsCard configs={data?.task_configs ?? []} providers={data?.providers ?? []} isAdmin={isAdmin} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit provider" : "Add provider"}</DialogTitle>
            <DialogDescription>
              Connect an OpenAI-compatible AI service. The key is stored encrypted and is never shown again.
            </DialogDescription>
          </DialogHeader>
          <ProviderForm provider={editing} onDone={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}