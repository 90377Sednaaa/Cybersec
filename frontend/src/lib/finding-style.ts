import type { FindingStatus, Severity } from "@/lib/types"

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"]
export const STATUSES: FindingStatus[] = ["ai_candidate", "needs_evidence", "verified", "false_positive"]

// Ordinal weight for client-side sorting. Higher is more severe.
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

// Crisp white text provides high contrast (>= 4.5:1 WCAG AA) against saturated
// severity tokens in both light and dark themes, matching security platform standards.
export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "border-transparent bg-severity-critical text-white font-semibold shadow-xs",
  high: "border-transparent bg-severity-high text-white font-semibold shadow-xs",
  medium: "border-transparent bg-severity-medium text-white font-semibold shadow-xs",
  low: "border-transparent bg-severity-low text-white font-semibold shadow-xs",
  info: "border-transparent bg-severity-info text-white font-semibold shadow-xs",
}

export const STATUS_LABEL: Record<FindingStatus, string> = {
  ai_candidate: "AI candidate (unconfirmed)",
  needs_evidence: "Needs evidence",
  verified: "Verified",
  false_positive: "False positive",
}

// Compact label for dense rows (findings table, run summary). The full label
// still explains the unconfirmed state wherever there is room for it.
export const STATUS_SHORT_LABEL: Record<FindingStatus, string> = {
  ai_candidate: "AI candidate",
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

// Distinct semantic styling backed by --state-* tokens so Dashboard progress
// bars and Findings table/drawer chips share the exact same 4-hue mapping.
export const STATUS_CLASS: Record<FindingStatus, string> = {
  ai_candidate:
    "border-state-candidate/60 bg-state-candidate/12 text-amber-800 dark:text-amber-300 font-medium",
  needs_evidence:
    "border-state-needs-evidence/60 bg-state-needs-evidence/12 text-orange-800 dark:text-orange-300 font-medium",
  verified:
    "border-state-verified/60 bg-state-verified/15 text-emerald-800 dark:text-emerald-300 font-medium",
  false_positive:
    "border-state-false-positive/40 bg-muted/40 text-muted-foreground line-through",
}

// Representative fallback scores matching backend app/reporting.py score_for()
export const SEVERITY_SCORE: Record<Severity, number> = {
  critical: 9.5,
  high: 8.0,
  medium: 5.5,
  low: 2.5,
  info: 0.0,
}

export function displayScore(score: number, severity: Severity): string {
  const effective = score > 0 ? score : SEVERITY_SCORE[severity]
  return effective.toFixed(1)
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
