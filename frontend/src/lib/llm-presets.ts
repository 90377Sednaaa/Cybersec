export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  placeholderKey: string
  keyRequired: boolean
  defaultModels: string[]
  note?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    placeholderKey: "sk-or-v1-...",
    keyRequired: true,
    defaultModels: [
      "deepseek/deepseek-chat",
      "openai/gpt-4o-mini",
      "baidu/ernie-5.5-flash-preview:free",
      "qwen/qwen3-coder",
      "openai/gpt-4o",
      "meta-llama/llama-3.3-70b-instruct",
      "google/gemini-4-carbon",
    ],
    note: "Hundreds of models from OpenAI, Anthropic, DeepSeek, Google and more with one key. Use Browse models for the live catalog.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    placeholderKey: "sk-...",
    keyRequired: true,
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    note: "Direct DeepSeek V3 and R1 reasoning API.",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    placeholderKey: "sk-proj-...",
    keyRequired: true,
    defaultModels: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    note: "Standard OpenAI GPT-4o and reasoning models.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    placeholderKey: "AIza...",
    keyRequired: true,
    defaultModels: [
      "gemini-3.8-flash",
      "gemini-4-carbon",
      "gemini-4-argon",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ],
    note: "Uses Google's official OpenAI-compatible endpoint. Create a key in Google AI Studio, then use Browse models for the live catalog.",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    placeholderKey: "gsk_...",
    keyRequired: true,
    defaultModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "deepseek-r1-distill-llama-70b",
    ],
    note: "Ultra-fast inference for open weights models.",
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    baseUrl: "http://localhost:11434/v1",
    placeholderKey: "(optional for local Ollama)",
    keyRequired: false,
    defaultModels: ["llama3.2", "qwen2.5-coder", "mistral", "deepseek-r1:8b"],
    note: "Runs entirely on your machine. No external telemetry or cloud egress.",
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    baseUrl: "",
    placeholderKey: "Paste provider API key",
    keyRequired: true,
    defaultModels: ["gpt-4o-mini", "deepseek-chat", "llama-3.3-70b-instruct"],
    note: "Any self-hosted vLLM, LM Studio, or OpenAI-compatible proxy.",
  },
]

export function detectProviderFromKey(key: string): string | null {
  const trimmed = key.trim()
  if (!trimmed) return null
  // Google AI Studio keys (Gemini) start with AIza and are not sk- prefixed.
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(trimmed)) {
    return "gemini"
  }
  if (trimmed.startsWith("sk-or-v1-") || trimmed.startsWith("sk-or-")) {
    return "openrouter"
  }
  if (trimmed.startsWith("gsk_")) {
    return "groq"
  }
  if (trimmed.startsWith("sk-proj-") || trimmed.startsWith("sk-admin-")) {
    return "openai"
  }
  // DeepSeek keys are 32 hex chars prefixed with sk-
  if (/^sk-[0-9a-fA-F]{32}$/.test(trimmed)) {
    return "deepseek"
  }
  if (trimmed.startsWith("sk-")) {
    return "openai"
  }
  return null
}

/** Capability badge: does this model reason? Used for catalog metadata and presets. */
export function isReasoningModel(modelName: string): boolean {
  const slug = modelName.split("/").pop()?.toLowerCase() ?? ""
  return (
    slug.startsWith("o1") ||
    slug.startsWith("o3") ||
    slug.startsWith("o4") ||
    slug.includes("reasoner") ||
    slug.includes("reasoning") ||
    slug.includes("r1") ||
    slug.includes("thinking") ||
    slug.includes("qwq")
  )
}

/**
 * Request-shape gate: only OpenAI o1/o3/o4 style models reject `temperature`
 * and need `reasoning_effort`. Mirrors backend/app/ai/client.py so the UI label
 * never claims "Reasoning effort" for a model that is actually sent a temperature.
 */
export function usesReasoningEffort(modelName: string): boolean {
  const slug = modelName.split("/").pop()?.toLowerCase() ?? ""
  return slug.startsWith("o1") || slug.startsWith("o3") || slug.startsWith("o4")
}

export function formatPrice(price: number | null): string {
  if (price === null) return "Price unavailable"
  if (price === 0) return "Free"
  return `$${price.toFixed(price < 0.01 ? 3 : 2)} / 1M in`
}

export function formatContext(tokens: number | null): string {
  if (!tokens) return ""
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M ctx`
  }
  return `${Math.round(tokens / 1000)}K ctx`
}

export type TemperaturePresetId = "low" | "medium" | "high" | "max" | "xhigh" | "custom"

export interface TemperaturePreset {
  id: TemperaturePresetId
  label: string
  shortLabel: string
  value: number
  hint: string
}

export const TEMPERATURE_PRESETS: TemperaturePreset[] = [
  {
    id: "low",
    label: "Low (0.0)",
    shortLabel: "Low",
    value: 0.0,
    hint: "Deterministic and strictly factual. Recommended for scan interpretation to prevent hallucinations.",
  },
  {
    id: "medium",
    label: "Medium (0.4)",
    shortLabel: "Med",
    value: 0.4,
    hint: "Balanced phrasing and coherent synthesis. Recommended for report summaries.",
  },
  {
    id: "high",
    label: "High (0.8)",
    shortLabel: "High",
    value: 0.8,
    hint: "More expressive phrasing and broader exploration.",
  },
  {
    id: "max",
    label: "Max (1.2)",
    shortLabel: "Max",
    value: 1.2,
    hint: "Maximum variance and high diversity generation.",
  },
  {
    id: "xhigh",
    label: "XHigh (1.8)",
    shortLabel: "XHigh",
    value: 1.8,
    hint: "Extreme temperature for highly speculative or unconventional output.",
  },
  {
    id: "custom",
    label: "Custom",
    shortLabel: "Custom",
    value: -1,
    hint: "Explicit numeric temperature between 0.0 and 2.0.",
  },
]

export function getModelsForProvider(providerName?: string, baseUrl?: string): string[] {
  if (!providerName && !baseUrl) return []

  const lowerName = (providerName || "").toLowerCase()
  const lowerUrl = (baseUrl || "").toLowerCase()

  for (const preset of PROVIDER_PRESETS) {
    if (preset.id === "custom") continue
    if (
      lowerName.includes(preset.id) ||
      (preset.baseUrl && lowerUrl.includes(preset.baseUrl.replace("https://", "").replace("http://", "")))
    ) {
      return preset.defaultModels
    }
  }

  return ["gpt-4o-mini", "deepseek-chat", "llama-3.3-70b-versatile"]
}

export function findMatchingPresetId(name: string, baseUrl: string): string {
  const lowerName = name.toLowerCase()
  const lowerUrl = baseUrl.toLowerCase()

  for (const preset of PROVIDER_PRESETS) {
    if (preset.id === "custom") continue
    if (lowerName.includes(preset.id) || lowerUrl === preset.baseUrl.toLowerCase()) {
      return preset.id
    }
  }
  return "custom"
}

export function getTemperaturePresetId(temperature: number): TemperaturePresetId {
  if (temperature <= 0.1) return "low"
  if (temperature > 0.1 && temperature <= 0.55) return "medium"
  if (temperature > 0.55 && temperature <= 0.95) return "high"
  if (temperature > 0.95 && temperature <= 1.45) return "max"
  if (temperature > 1.45 && temperature <= 2.0) return "xhigh"
  return "custom"
}

/**
 * Guidance copy for the temperature control. `usesEffort` means the backend
 * will send `reasoning_effort` instead of `temperature` for this model, so the
 * hint must describe effort rather than sampling variance.
 */
export function getTaskPresetHint(
  task: string,
  presetId: TemperaturePresetId,
  usesEffort: boolean,
): string {
  if (usesEffort) {
    switch (presetId) {
      case "low":
        return "Low effort: fast responses for straightforward logic."
      case "medium":
        return "Medium effort: standard multi-step analysis."
      case "high":
        return "High effort: deeper reasoning for complex assessments."
      case "max":
      case "xhigh":
        return "Mapped to high effort. Use a custom value for finer control."
      case "custom":
        return "Custom value is mapped to low, medium or high effort."
    }
  }

  if (task === "interpretation") {
    switch (presetId) {
      case "low":
        return "Recommended: deterministic output limits invented findings."
      case "medium":
        return "Slight phrasing variance. Low is recommended for scans."
      case "high":
      case "max":
      case "xhigh":
        return "Higher variance increases the risk of hallucinated findings."
      case "custom":
        return "0.0 is strongly recommended for scan interpretation."
    }
  }

  if (task === "summary") {
    switch (presetId) {
      case "low":
        return "Factual, concise summary statements."
      case "medium":
        return "Recommended for reports: balanced executive writing."
      case "high":
      case "max":
      case "xhigh":
        return "More expressive prose with a higher variance risk."
      case "custom":
        return "Custom float between 0.0 and 2.0."
    }
  }

  if (task === "prioritization") {
    switch (presetId) {
      case "low":
        return "Recommended: consistent ordering of risk scores."
      case "medium":
        return "Moderate ranking variance."
      case "high":
      case "max":
      case "xhigh":
        return "High variance in priority scoring."
      case "custom":
        return "Custom float between 0.0 and 2.0."
    }
  }

  if (task === "qa") {
    switch (presetId) {
      case "low":
        return "Direct answers that cite evidence only."
      case "medium":
        return "Recommended for Q&A: helpful but grounded."
      case "high":
      case "max":
      case "xhigh":
        return "Expansive, brainstorming style answers."
      case "custom":
        return "Custom float between 0.0 and 2.0."
    }
  }

  return TEMPERATURE_PRESETS.find((p) => p.id === presetId)?.hint ?? "Adjust output sampling temperature."
}
