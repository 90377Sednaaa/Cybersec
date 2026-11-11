import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
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
  isReasoningModel,
  type TemperaturePresetId,
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

function getTaskPresetHint(
  task: string,
  presetId: TemperaturePresetId,
  isReasoning: boolean,
): string {
  if (isReasoning) {
    switch (presetId) {
      case "low":
        return "Low reasoning effort: fast responses for straightforward logic."
      case "medium":
        return "Medium reasoning effort: standard multi-step chain-of-thought analysis."
      case "high":
        return "High reasoning effort: deep reasoning for complex security assessments."
      case "max":
      case "xhigh":
        return "Maximum reasoning effort: exhaustive reasoning budget (mapped to high effort)."
      case "custom":
        return "Custom value: mapped to low, medium, or high effort based on value magnitude."
    }
  }

  switch (task) {
    case "interpretation":
      switch (presetId) {
        case "low":
          return "Recommended for scan analysis: strictly deterministic to prevent false CVE hallucinations."
        case "medium":
          return "Slight phrasing variance. Low is recommended for security scans."
        case "high":
        case "max":
        case "xhigh":
          return "High temperature: increased risk of hallucinating CVEs and scan findings."
        case "custom":
          return "Custom float: 0.0 is strongly recommended for scan analysis."
      }
      break

    case "summary":
      switch (presetId) {
        case "low":
          return "Factual, strictly concise summary statements."
        case "medium":
          return "Recommended for report summaries: balanced executive writing."
        case "high":
          return "More expressive phrasing and broader report prose."
        case "max":
        case "xhigh":
          return "High variance prose for creative report drafting."
        case "custom":
          return "Custom float (0.0 to 2.0)."
      }
      break

    case "prioritization":
      switch (presetId) {
        case "low":
          return "Recommended: consistent mathematical ordering of risk scores."
        case "medium":
          return "Moderate ranking variance."
        case "high":
        case "max":
        case "xhigh":
          return "High variance in priority scoring."
        case "custom":
          return "Custom float (0.0 to 2.0)."
      }
      break

    case "qa":
      switch (presetId) {
        case "low":
          return "Direct, strictly factual answers citing evidence only."
        case "medium":
          return "Recommended for Q&A: helpful explanations with balanced context."
        case "high":
        case "max":
        case "xhigh":
          return "Brainstorming and expansive investigative guidance."
        case "custom":
          return "Custom float (0.0 to 2.0)."
      }
      break
  }

  const found = TEMPERATURE_PRESETS.find((p) => p.id === presetId)
  return found?.hint ?? "Adjust output sampling temperature."
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
        <p className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="size-3 shrink-0" />
          <span>Connected: {test.data.model} ({test.data.latency_ms} ms)</span>
        </p>
      )}
      {test.data && !test.data.ok && (
        <p className="max-w-xs text-xs text-destructive">
          {test.data.error.includes("No task model")
            ? "Assign a model in 'Model per task' below first."
            : (test.data.error || "Connection failed")}
        </p>
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

  const isReasoning = isReasoningModel(model)

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
  const hintText = getTaskPresetHint(config.task, tempPreset, isReasoning)

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
            <SelectTrigger className="w-56">
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
              className="w-56 text-xs font-mono"
              placeholder="e.g. org/model-name"
              value={model}
              disabled={!isAdmin || providerId === NONE}
              onChange={(e) => setModel(e.target.value)}
            />
          )}
        </div>
      </TableCell>
      <TableCell className="min-w-[280px]">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">
              {isReasoning ? "Reasoning Effort" : "Sampling Level"}
            </span>
            {isReasoning && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-primary/40 text-primary">
                Reasoning Model
              </Badge>
            )}
          </div>
          <div className="inline-flex rounded-md border p-0.5 bg-muted/40 w-full">
            {TEMPERATURE_PRESETS.map((p) => {
              const active = tempPreset === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => {
                    setTempPreset(p.id)
                    if (p.value >= 0) {
                      setTemperature(String(p.value))
                    }
                  }}
                  className={cn(
                    "flex-1 px-1.5 py-1 text-xs font-medium rounded-sm transition-all text-center",
                    active
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.shortLabel}
                </button>
              )
            })}
          </div>
          {tempPreset === "custom" && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <Input
                className="w-20 text-xs font-mono h-7"
                type="number"
                step="0.05"
                min="0"
                max="2"
                value={temperature}
                disabled={!isAdmin}
                onChange={(e) => setTemperature(e.target.value)}
              />
              <span className="text-[10px] text-muted-foreground font-mono">0.0 - 2.0</span>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground leading-tight max-w-[280px]">
            {hintText}
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
                  Effort / Temperature
                  <HelpHint label="Model guidance">
                    Standard models use temperature (Low 0.0 to XHigh 1.8). Reasoning models (o1, o3, R1) use reasoning effort (Low, Medium, High).
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
