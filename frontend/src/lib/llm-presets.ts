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
      "anthropic/claude-3.5-sonnet",
      "deepseek/deepseek-chat",
      "deepseek/deepseek-r1",
      "meta-llama/llama-3.3-70b-instruct",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-001",
    ],
    note: "Access 200+ models from Claude, DeepSeek, Llama, and OpenAI with one key.",
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
    defaultModels: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1-mini"],
    note: "Standard OpenAI GPT-4o and reasoning models.",
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

export function isReasoningModel(modelName: string): boolean {
  const lower = modelName.toLowerCase()
  return (
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.includes("reasoner") ||
    lower.includes("r1") ||
    lower.includes("thinking")
  )
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
