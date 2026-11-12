import { useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { Check, ChevronsUpDown, Info, Search, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { formatContext, formatPrice, getModelsForProvider, isReasoningModel } from "@/lib/llm-presets"
import type { LLMModel, LLMModelsResponse, LLMProvider } from "@/lib/types"

const SORTS = [
  { id: "popular", label: "Default order" },
  { id: "price", label: "Price: low to high" },
  { id: "context", label: "Largest context" },
  { id: "name", label: "Name A to Z" },
] as const

type SortId = (typeof SORTS)[number]["id"]

const EMPTY_MODELS: LLMModel[] = []

interface ModelPickerProps {
  provider: LLMProvider | null
  value: string
  onChange: (model: string) => void
  disabled?: boolean
}

function presetModel(id: string): LLMModel {
  return {
    id,
    name: id,
    free: false,
    prompt_price: null,
    completion_price: null,
    context_length: null,
    reasoning: isReasoningModel(id),
    structured_outputs: false,
    zero_data_retention: false,
    source: "preset",
  }
}

function FilterChip({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? "default" : "outline"}
      className="rounded-full"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/**
 * A searchable model browser for the Settings page. The live catalog comes from
 * the backend proxy, so API keys stay server-side. If the provider is offline
 * or has no /models endpoint, the built-in presets remain selectable.
 */
export function ModelPicker({ provider, value, onChange, disabled = false }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortId>("popular")
  const [freeOnly, setFreeOnly] = useState(false)
  const [reasoningOnly, setReasoningOnly] = useState(false)
  const [structuredOnly, setStructuredOnly] = useState(false)
  const [zdrOnly, setZdrOnly] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [customValue, setCustomValue] = useState(value)
  const [activeIndex, setActiveIndex] = useState(0)
  const [visibleCount, setVisibleCount] = useState(40)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const catalogQuery = useQuery({
    queryKey: ["llm-models", provider?.id ?? null, zdrOnly],
    queryFn: () =>
      api<LLMModelsResponse>(
        `/api/settings/llm/providers/${provider?.id}/models${zdrOnly ? "?zdr=true" : ""}`,
      ),
    enabled: Boolean(provider) && open,
    staleTime: 10 * 60 * 1000,
    retry: false,
  })

  const presets = useMemo<LLMModel[]>(
    () => (provider ? getModelsForProvider(provider.name, provider.base_url).map(presetModel) : []),
    [provider],
  )
  const liveModels = catalogQuery.data?.source === "live" ? catalogQuery.data.models : EMPTY_MODELS
  const isLive = liveModels.length > 0
  const zdrSupported = catalogQuery.data?.zdr_supported ?? false
  const catalogUnavailable = catalogQuery.isError || catalogQuery.data?.source === "unavailable"

  const models = useMemo<LLMModel[]>(() => {
    const base = isLive ? liveModels : presets
    if (!value.trim() || base.some((model) => model.id === value)) return base
    return [presetModel(value), ...base]
  }, [isLive, liveModels, presets, value])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let list = models.filter((model) => {
      if (needle && !`${model.name} ${model.id}`.toLowerCase().includes(needle)) return false
      if (freeOnly && !model.free) return false
      if (reasoningOnly && !model.reasoning) return false
      if (structuredOnly && !model.structured_outputs) return false
      if (zdrOnly && !model.zero_data_retention) return false
      return true
    })
    if (sort === "price") {
      list = [...list].sort(
        (a, b) => (a.prompt_price ?? Number.POSITIVE_INFINITY) - (b.prompt_price ?? Number.POSITIVE_INFINITY),
      )
    } else if (sort === "context") {
      list = [...list].sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
    } else if (sort === "name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [models, query, freeOnly, reasoningOnly, structuredOnly, zdrOnly, sort])

  const visible = filtered.slice(0, visibleCount)
  const active = Math.min(activeIndex, Math.max(visible.length - 1, 0))

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-model-index="${active}"]`)
    node?.scrollIntoView({ block: "nearest" })
  }, [active, visible.length])

  function resetPosition() {
    setActiveIndex(0)
    setVisibleCount(40)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setQuery("")
      setCustomMode(false)
      setActiveIndex(0)
    }
  }

  function selectModel(id: string) {
    onChange(id)
    handleOpenChange(false)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (customMode) return
    const target = event.target as HTMLElement
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, visible.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter" && target.tagName !== "BUTTON") {
      event.preventDefault()
      const model = visible[active]
      if (model) selectModel(model.id)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || !provider}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm transition-colors",
          "hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
        aria-label="Choose a model"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs">{value || (provider ? "Select a model" : "Select a provider first")}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-h-[90vh] max-w-2xl gap-0 overflow-hidden p-0 sm:max-w-2xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchRef.current?.focus()
          }}
          onKeyDown={handleKeyDown}
        >
          <DialogHeader className="gap-1.5 px-5 pt-5 pb-4 text-left">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DialogTitle>Choose a model</DialogTitle>
              <Badge variant="outline" className="font-normal">
                {isLive ? `Live catalog · ${liveModels.length} models` : "Offline presets"}
              </Badge>
            </div>
            <DialogDescription>
              {provider
                ? `Browse chat models on ${provider.name}. Prices are USD per 1M input tokens.`
                : "Select a provider before choosing a model."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  resetPosition()
                }}
                placeholder="Search by name or model ID..."
                aria-label="Search models"
                className="pl-9"
              />
            </div>
            <Select
              value={sort}
              onValueChange={(next) => {
                setSort(next as SortId)
                resetPosition()
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Sort models">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-1.5 border-b px-5 pb-3">
            <FilterChip
              active={freeOnly}
              onClick={() => {
                setFreeOnly((current) => !current)
                resetPosition()
              }}
            >
              Free
            </FilterChip>
            <FilterChip
              active={reasoningOnly}
              onClick={() => {
                setReasoningOnly((current) => !current)
                resetPosition()
              }}
            >
              Reasoning
            </FilterChip>
            <FilterChip
              active={structuredOnly}
              onClick={() => {
                setStructuredOnly((current) => !current)
                resetPosition()
              }}
            >
              Structured output
            </FilterChip>
            <FilterChip
              active={zdrOnly}
              disabled={!zdrSupported}
              title={zdrSupported ? "Only zero data retention endpoints" : "Only OpenRouter supports this filter"}
              onClick={() => {
                setZdrOnly((current) => !current)
                resetPosition()
              }}
            >
              Zero data retention
            </FilterChip>
          </div>

          {catalogUnavailable && (
            <div className="flex items-center gap-2 border-b bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              <span className="flex-1">
                {catalogQuery.isError ? "Could not load the live catalog." : catalogQuery.data?.notice || "Live catalog unavailable."}{" "}
                Offline presets are shown instead.
              </span>
              <Button variant="ghost" size="xs" onClick={() => void catalogQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}

          <div
            ref={listRef}
            role="listbox"
            aria-label="Available models"
            className="max-h-[42vh] min-h-[220px] overflow-y-auto"
          >
            {catalogQuery.isLoading && (
              <div className="flex flex-col gap-2 p-4">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            )}

            {!catalogQuery.isLoading && visible.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                <Search className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No models match</p>
                <p className="text-xs text-muted-foreground">Try a different search or clear the filters.</p>
              </div>
            )}

            {!catalogQuery.isLoading &&
              visible.map((model, index) => {
                const details = [
                  formatContext(model.context_length),
                  model.structured_outputs ? "JSON" : "",
                  model.zero_data_retention ? "ZDR" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={model.id === value}
                    data-model-index={index}
                    onClick={() => selectModel(model.id)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 border-b px-5 py-3 text-left transition-colors",
                      index === active && "bg-accent",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{model.name}</span>
                        {model.id === value && <Check className="size-3.5 text-primary" />}
                        {model.free && <Badge>Free</Badge>}
                        {model.reasoning && <Badge variant="secondary">Reasoning</Badge>}
                        {model.source === "preset" && <Badge variant="outline">Preset</Badge>}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{model.id}</span>
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                      <span className="block tabular-nums">{formatPrice(model.prompt_price)}</span>
                      <span className="block">{details || "Model ID"}</span>
                    </span>
                  </button>
                )
              })}

            {!catalogQuery.isLoading && visible.length < filtered.length && (
              <div className="p-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => setVisibleCount((count) => count + 40)}>
                  Show more ({filtered.length - visible.length} left)
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
            {customMode ? (
              <form
                className="flex w-full items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const next = customValue.trim()
                  if (next) selectModel(next)
                }}
              >
                <Input
                  autoFocus
                  value={customValue}
                  onChange={(event) => setCustomValue(event.target.value)}
                  placeholder="org/model-name"
                  aria-label="Custom model ID"
                  className="font-mono text-xs"
                />
                <Button type="submit" size="sm" disabled={!customValue.trim()}>
                  Use model
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCustomMode(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => {
                    setCustomValue(value)
                    setCustomMode(true)
                  }}
                >
                  Use a custom model ID
                </button>
                <div className="flex items-center gap-3">
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">
                    Arrow keys to browse · Enter to select
                  </span>
                  <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
