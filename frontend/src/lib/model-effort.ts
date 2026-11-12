/**
 * Model-specific reasoning effort levels.
 *
 * The live catalog (OpenRouter's `reasoning.supported_efforts`) is the source of
 * truth: Gemini reports low/medium/high, Claude adds xhigh/max, GPT-5 style
 * models add minimal/xhigh. The helpers here order those values for display and
 * provide a small family-based fallback for offline presets and custom IDs.
 */

const EFFORT_ORDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
] as const

const ORDER_INDEX: Record<string, number> = Object.fromEntries(
  EFFORT_ORDER.map((level, index) => [level, index]),
)

export function sortEfforts(levels: string[]): string[] {
  const unique = [...new Set(levels.map((level) => level.trim().toLowerCase()).filter(Boolean))]
  return unique.sort(
    (a, b) => (ORDER_INDEX[a] ?? 99) - (ORDER_INDEX[b] ?? 99) || a.localeCompare(b),
  )
}

export function formatEffortLabel(level: string): string {
  const labels: Record<string, string> = {
    none: "None (off)",
    xhigh: "XHigh",
    ultracode: "Ultracode",
  }
  return labels[level] ?? level.charAt(0).toUpperCase() + level.slice(1)
}

/** Fallback only: used when the live catalog is unavailable or for a custom ID. */
export function getFallbackEfforts(modelId: string): string[] {
  const slug = modelId.split("/").pop()?.toLowerCase() ?? ""
  if (!slug) return []
  if (slug.includes("gemini")) return ["low", "medium", "high"]
  if (slug.includes("claude")) return ["low", "medium", "high", "xhigh", "max"]
  if (/^(o1|o3|o4|gpt-5)/.test(slug)) return ["minimal", "low", "medium", "high", "xhigh"]
  if (/r1|qwq|reasoner|thinking|reasoning/.test(slug)) return ["low", "medium", "high"]
  return []
}

export function effortHint(level: string, options: string[]): string {
  const notes: Record<string, string> = {
    none: "Reasoning off: fastest and cheapest.",
    minimal: "Minimal thinking budget for simple output.",
    low: "Low effort: fast responses for straightforward analysis.",
    medium: "Medium effort: balanced depth and latency.",
    high: "High effort: deeper reasoning for complex assessments.",
    xhigh: "Extra high effort: more thorough, slower and costlier.",
    max: "Maximum effort: the deepest reasoning this model offers.",
    ultra: "Ultra effort: exhaustive reasoning budget.",
    ultracode: "Ultracode effort: the highest available reasoning budget.",
  }
  const note = notes[level] ?? "Model-specific reasoning level."
  return `${note} Auto-detected levels: ${options.join(", ")}.`
}
