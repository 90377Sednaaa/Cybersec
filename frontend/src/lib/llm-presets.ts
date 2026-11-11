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
      "meta-llama/llama-3.3-70b-instruct",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-exp:free",
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
    placeholderKey: "sk-...",
    keyRequired: true,
    defaultModels: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
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
    defaultModels: ["gpt-4o-mini", "deepseek-chat"],
    note: "Any self-hosted vLLM, LM Studio, or OpenAI-compatible proxy.",
  },
]

export interface TemperaturePreset {
  id: string
  label: string
  value: number
  hint: string
}

export const TEMPERATURE_PRESETS: TemperaturePreset[] = [
  {
    id: "precise",
    label: "Precise (0.0)",
    value: 0.0,
    hint: "Deterministic and factual. Recommended for scan interpretation to avoid hallucinations.",
  },
  {
    id: "balanced",
    label: "Balanced (0.4)",
    value: 0.4,
    hint: "Balanced phrasing and coherent synthesis. Recommended for report summaries.",
  },
  {
    id: "creative",
    label: "Creative (0.7)",
    value: 0.7,
    hint: "Exploratory generation. May introduce speculative phrasing.",
  },
  {
    id: "custom",
    label: "Custom value",
    value: -1,
    hint: "Specify an explicit numeric temperature between 0.0 and 2.0.",
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

export function getTemperaturePresetId(temperature: number): string {
  if (Math.abs(temperature - 0.0) < 0.05) return "precise"
  if (Math.abs(temperature - 0.4) < 0.05) return "balanced"
  if (Math.abs(temperature - 0.7) < 0.05) return "creative"
  return "custom"
}
