import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"

import { HelpHint } from "@/components/help-hint"
import { ModelPicker } from "@/components/model-picker"
import { useModelCatalog } from "@/lib/model-catalog"
import type { ModelCapabilities } from "@/lib/model-catalog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import {
  TEMPERATURE_PRESETS,
  getModelsForProvider,
  getTaskPresetHint,
  getTemperaturePresetId,
  isReasoningModel,
  usesReasoningEffort,
  type TemperaturePresetId,
} from "@/lib/llm-presets"
import { effortHint, formatEffortLabel, getFallbackEfforts, sortEfforts } from "@/lib/model-effort"
import type { LLMProvider, LLMTaskConfig, LLMTestResult } from "@/lib/types"

const NONE = "none"

const TASK_INFO: Record<string, { label: string; hint: string }> = {
  interpretation: {
    label: "Scan interpretation",
    hint: "Turns raw scan output into structured finding candidates. A fast model is enough.",
  },
  summary: {
    label: "Report summaries",
    hint: "Writes executive and per-finding summaries for the report. A stronger model helps.",
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
      <Button variant="outline" size="xs" disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? "Testing..." : "Test connection"}
      </Button>
      {test.data?.ok && (
        <p className="flex items-center gap-1 text-[11px] font-medium text-primary">
          <Check className="size-3 shrink-0" />
          <span>
            Connected: {test.data.model} ({test.data.latency_ms} ms)
          </span>
        </p>
      )}
      {test.data && !test.data.ok && (
        <p className="max-w-56 text-[11px] text-destructive">
          {test.data.error.includes("No task model")
            ? "Assign a model to a task below first."
            : test.data.error || "Connection failed"}
        </p>
      )}
      {test.error && <p className="max-w-56 text-[11px] text-destructive">{test.error.message}</p>}
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
  const [tempPreset, setTempPreset] = useState(getTemperaturePresetId(config.temperature))
  const [effort, setEffort] = useState(config.effort ?? "")
  const [error, setError] = useState<string | null>(null)

  const selectedProvider = providers.find((p) => String(p.id) === providerId) ?? null
  const catalog = useModelCatalog(selectedProvider)
  const liveModel =
    catalog.data?.source === "live" ? catalog.data.models.find((item) => item.id === model) : undefined

  // Levels come from the model itself, not a global list. Gemini reports
  // low/medium/high; Claude adds xhigh/max; models without reasoning keep
  // temperature presets. Offline/custom IDs use a small family fallback.
  const effortOptions = useMemo(() => {
    if (liveModel?.supported_efforts?.length) return sortEfforts(liveModel.supported_efforts)
    return getFallbackEfforts(model)
  }, [liveModel, model])
  const isEffortModel = effortOptions.length > 0
  const effectiveEffort = useMemo(() => {
    if (!isEffortModel) return ""
    if (effortOptions.includes(effort)) return effort
    const preferred = liveModel?.default_effort
    if (preferred && effortOptions.includes(preferred)) return preferred
    return effortOptions[Math.min(1, effortOptions.length - 1)]
  }, [isEffortModel, effortOptions, effort, liveModel])
  const reasoningCapable = liveModel?.reasoning ?? isReasoningModel(model)

  function handleProviderChange(newProviderId: string) {
    setProviderId(newProviderId)
    const newProvider = providers.find((p) => String(p.id) === newProviderId)
    const newModels = getModelsForProvider(newProvider?.name, newProvider?.base_url)
    if (newModels.length > 0 && !newModels.includes(model)) {
      setModel(newModels[0])
      setEffort("")
    }
  }

  function handleModelChange(nextModel: string, capabilities?: ModelCapabilities) {
    setModel(nextModel)
    const nextEfforts = capabilities?.supportedEfforts?.length
      ? sortEfforts(capabilities.supportedEfforts)
      : getFallbackEfforts(nextModel)
    if (nextEfforts.length === 0) {
      setEffort("")
      return
    }
    const preferred = capabilities?.defaultEffort
    setEffort(
      preferred && nextEfforts.includes(preferred)
        ? preferred
        : nextEfforts[Math.min(1, nextEfforts.length - 1)],
    )
  }

  function handlePresetChange(next: string) {
    const presetId = next as TemperaturePresetId
    setTempPreset(presetId)
    const preset = TEMPERATURE_PRESETS.find((p) => p.id === presetId)
    if (preset && preset.value >= 0) setTemperature(String(preset.value))
  }

  const temperatureValue = Number(temperature)
  const temperatureValid =
    temperature.trim() !== "" &&
    Number.isFinite(temperatureValue) &&
    temperatureValue >= 0 &&
    temperatureValue <= 2
  const dirty =
    providerId !== initialProvider ||
    model !== config.model ||
    temperature !== String(config.temperature) ||
    effectiveEffort !== (config.effort ?? "")

  const save = useMutation({
    mutationFn: () =>
      api<LLMTaskConfig>(`/api/settings/llm/tasks/${config.task}`, {
        method: "PUT",
        body: JSON.stringify({
          provider_id: providerId === NONE ? null : Number(providerId),
          model: model.trim(),
          temperature: temperatureValue,
          effort: effectiveEffort,
        }),
      }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["llm-settings"] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to save"),
  })

  const info = TASK_INFO[config.task]
  const levelHint = isEffortModel
    ? effortHint(effectiveEffort, effortOptions)
    : getTaskPresetHint(config.task, tempPreset, usesReasoningEffort(model) && !isEffortModel)

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] xl:items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{info?.label ?? config.task}</span>
          {reasoningCapable && (
            <Badge variant="outline" className="text-[10px]">
              Reasoning model
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{info?.hint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`provider-${config.task}`} className="text-[11px] text-muted-foreground">
          Provider
        </Label>
        <Select value={providerId} onValueChange={handleProviderChange} disabled={!isAdmin}>
          <SelectTrigger id={`provider-${config.task}`} className="w-full">
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
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground">Model</span>
        <ModelPicker
          provider={selectedProvider}
          value={model}
          onChange={handleModelChange}
          disabled={!isAdmin || providerId === NONE}
        />
        {!model && <p className="text-[11px] text-muted-foreground">No model selected</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`level-${config.task}`} className="text-[11px] text-muted-foreground">
            {isEffortModel ? "Reasoning effort" : "Sampling level"}
          </Label>
          {isEffortModel && (
            <Badge variant="outline" className="text-[10px]">
              Auto
            </Badge>
          )}
        </div>
        {isEffortModel ? (
          <Select value={effectiveEffort} onValueChange={setEffort} disabled={!isAdmin}>
            <SelectTrigger id={`level-${config.task}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {effortOptions.map((level) => (
                <SelectItem key={level} value={level}>
                  {formatEffortLabel(level)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            <Select value={tempPreset} onValueChange={handlePresetChange} disabled={!isAdmin}>
              <SelectTrigger id={`level-${config.task}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPERATURE_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tempPreset === "custom" && (
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8 w-20 font-mono text-xs"
                  type="number"
                  step="0.05"
                  min="0"
                  max="2"
                  value={temperature}
                  disabled={!isAdmin}
                  onChange={(event) => setTemperature(event.target.value)}
                />
                <span className="font-mono text-[10px] text-muted-foreground">0.0 to 2.0</span>
              </div>
            )}
          </>
        )}
        <p className="text-[11px] leading-tight text-muted-foreground">{levelHint}</p>
      </div>

      {isAdmin && (
        <div className="flex flex-col items-start gap-1 xl:pt-6">
          <Button size="sm" disabled={!dirty || !temperatureValid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
          {error && <p className="max-w-40 text-[11px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
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
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Model per task</CardTitle>
            <CardDescription>
              Each AI task can use its own provider and model. Effort levels adapt to the selected model.
            </CardDescription>
          </div>
          <HelpHint label="Model guidance" className="mt-1">
            Reasoning models show the effort levels they actually support. Other models use temperature from 0.0 to 2.0.
          </HelpHint>
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y rounded-lg border">
          {configs.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No AI tasks loaded.</div>
          )}
          {configs.map((config) => (
            <TaskRow key={config.task} config={config} providers={providers} isAdmin={isAdmin} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
