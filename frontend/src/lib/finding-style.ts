import type { FindingStatus, Severity } from "@/lib/types"

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"]
export const STATUSES: FindingStatus[] = ["ai_candidate", "needs_evidence", "verified", "false_positive"]

export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "border-transparent bg-severity-critical text-white",
  high: "border-transparent bg-severity-high text-white",
  medium: "border-transparent bg-severity-medium text-black",
  low: "border-transparent bg-severity-low text-white",
  info: "border-transparent bg-severity-info text-white",
}

export const STATUS_LABEL: Record<FindingStatus, string> = {
  ai_candidate: "AI candidate (unconfirmed)",
  needs_evidence: "Needs evidence",
  verified: "Verified",
  false_positive: "False positive",
}

export const STATUS_VARIANT: Record<FindingStatus, "default" | "secondary" | "outline"> = {
  ai_candidate: "outline",
  needs_evidence: "secondary",
  verified: "default",
  false_positive: "outline",
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}