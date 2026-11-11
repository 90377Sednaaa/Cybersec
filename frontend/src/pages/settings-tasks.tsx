import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HelpHint } from "@/components/help-hint"
import { api } from "@/lib/api"
import {
  TEMPERATURE_PRESETS,
  getModelsForProvider,
  getTemperaturePresetId,
} from "@/lib/llm-presets"
import type { LLMProvider, LLMTaskConfig, LLMTestResult } from "@/lib/types"

const NONE = "none"

const TASK_INFO: Record<string, { label: string; hint: string }> = {
  interpretation: {
    label: "Scan interpretation",
    hint: "Turns raw scan output into structured finding candidates. A fast model is enough.",
  },
  summary: {
    label: "Report summaries",
    hint: "Writes executive and per-finding summaries for the report. A stronger reasoning model helps.",
  },
  prioritization: {
    label: "Risk prioritization",
    hint: "Orders findings by risk (stretch feature).",
  },
  qa: {
    label: "Finding Q&A",
    hint: "Answers analyst questions about a finding (stretch feature).",
  },
}

export function TestConnectionButton({ providerId }: { providerId: number }) {
  const test = useMutation({
    mutationFn: () =>
      api<LLMTestResult>("/api/settings/llm/test", {
        method: "POST",
        body: JSON.stringify({ provider_id: providerId }),
      }),
  })

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? "Testing…" : "Test connection"}
      </Button>
      {test.data?.ok && (
        <p className="text-xs text-muted-foreground">
          Connected: {test.data.model}
          {test.data.latency_ms !== null ? `, ${test.data.latency_ms} ms` : ""}
        </p>
      )}
      {test.data && !test.data.ok && (
        <p className="max-w-xs text-xs text-destructive">{test.data.error || "Connection failed"}</p>
      )}
      {test.error && <p className="max-w-xs text-xs text-destructive">{test.error.message}</p>}
    </div>
  )
}

function TaskRow({
  config,
  providers,
  isAdmin,
}: {
  config: LLMTaskConfig
  providers: LLMProvider[]
  isAdmin: boolean
}) {
  const queryClient = useQueryClient()
  const initialProvider = config.provider_id === null ? NONE : String(config.provider_id)
  const [providerId, setProviderId] = useState(initialProvider)
  const [model, setModel] = useState(config.model)
  const [temperature, setTemperature] = useState(String(config.temperature))
  const [error, setError] = useState<string | null>(null)

  const selectedProvider = providers.find((p) => String(p.id) === providerId)
  const availableModels = getModelsForProvider(selectedProvider?.name, selectedProvider?.base_url)

  const isModelInList = availableModels.includes(model)
  const [isCustomModel, setIsCustomModel] = useState(!isModelInList && model.trim() !== "")
  const [tempPreset, setTempPreset] = useState(getTemperaturePresetId(config.temperature))

  function handleProviderChange(newProviderId: string) {
    setProviderId(newProviderId)
    const newProv = providers.find((p) => String(p.id) === newProviderId)
    const newModels = getModelsForProvider(newProv?.name, newProv?.base_url)
    if (newModels.length > 0 && !newModels.includes(model)) {
      setModel(newModels[0])
      setIsCustomModel(false)
    }
  }

  const temperatureValue = Number(temperature)
  const temperatureValid =
    temperature.trim() !== "" && Number.isFinite(temperatureValue) && temperatureValue >= 0 && temperatureValue <= 2
  const dirty =
    providerId !== initialProvider || model !== config.model || temperature !== String(config.temperature)

  const save = useMutation({
    mutationFn: () =>
      api<LLMTaskConfig>(`/api/settings/llm/tasks/${config.task}`, {
        method: "PUT",
        body: JSON.stringify({
          provider_id: providerId === NONE ? null : Number(providerId),
          model: model.trim(),
          temperature: temperatureValue,
        }),
      }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["llm-settings"] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to save"),
  })

  const info = TASK_INFO[config.task]

  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-1">
          {info?.label ?? config.task}
          {info && <HelpHint label={info.label}>{info.hint}</HelpHint>}
        </div>
      </TableCell>
      <TableCell>
        <Select value={providerId} onValueChange={handleProviderChange} disabled={!isAdmin}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {providers.map((provider) => (
              <SelectItem key={provider.id} value={String(provider.id)}>
                {provider.name}
                {provider.enabled ? "" : " (disabled)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="min-w-[220px]">
        <div className="space-y-1.5">
          <Select
            value={isCustomModel ? "custom" : (availableModels.includes(model) ? model : "custom")}
            onValueChange={(val) => {
              if (val === "custom") {
                setIsCustomModel(true)
              } else {
                setIsCustomModel(false)
                setModel(val)
              }
            }}
            disabled={!isAdmin || providerId === NONE}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select model..." />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom model...</SelectItem>
            </SelectContent>
          </Select>
          {isCustomModel && (
            <Input
              className="w-52 text-xs font-mono"
              placeholder="e.g. org/model-name"
              value={model}
              disabled={!isAdmin || providerId === NONE}
              onChange={(e) => setModel(e.target.value)}
            />
          )}
        </div>
      </TableCell>
      <TableCell className="min-w-[170px]">
        <div className="space-y-1">
          <Select
            value={tempPreset}
            onValueChange={(val) => {
              setTempPreset(val)
              const preset = TEMPERATURE_PRESETS.find((p) => p.id === val)
              if (preset && preset.value >= 0) {
                setTemperature(String(preset.value))
              }
            }}
            disabled={!isAdmin}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPERATURE_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tempPreset === "custom" && (
            <Input
              className="w-24 text-xs font-mono"
              type="number"
              step="0.05"
              min="0"
              max="2"
              value={temperature}
              disabled={!isAdmin}
              onChange={(e) => setTemperature(e.target.value)}
            />
          )}
          <p className="text-[10px] text-muted-foreground leading-tight max-w-[160px]">
            {TEMPERATURE_PRESETS.find((p) => p.id === tempPreset)?.hint}
          </p>
        </div>
      </TableCell>
      {isAdmin && (
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            <Button size="sm" disabled={!dirty || !temperatureValid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            {error && <p className="max-w-xs text-xs text-destructive">{error}</p>}
          </div>
        </TableCell>
      )}
    </TableRow>
  )
}

export function TaskModelsCard({
  configs,
  providers,
  isAdmin,
}: {
  configs: LLMTaskConfig[]
  providers: LLMProvider[]
  isAdmin: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model per task</CardTitle>
        <CardDescription>
          Each AI task can use its own provider and model. Set a task here before using Test connection on its
          provider.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>
                <div className="flex items-center gap-1">
                  Temperature
                  <HelpHint label="Temperature">
                    Lower values (about 0.2) give more consistent answers; higher values give more varied ones.
                    Allowed range: 0 to 2.
                  </HelpHint>
                </div>
              </TableHead>
              {isAdmin && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {configs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                  No AI tasks loaded.
                </TableCell>
              </TableRow>
            )}
            {configs.map((config) => (
              <TaskRow key={config.task} config={config} providers={providers} isAdmin={isAdmin} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}