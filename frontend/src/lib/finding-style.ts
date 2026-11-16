import type { FindingStatus, Severity } from "@/lib/types"

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"]
export const STATUSES: FindingStatus[] = ["ai_candidate", "needs_evidence", "verified", "false_positive"]

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

export const STATUS_VARIANT: Record<FindingStatus, "default" | "secondary" | "outline"> = {
  ai_candidate: "outline",
  needs_evidence: "secondary",
  verified: "default",
  false_positive: "outline",
}

// Distinct semantic styling: ensures unconfirmed AI candidates stand out unmistakably
// to enforce the human-verification hard rule.
export const STATUS_CLASS: Record<FindingStatus, string> = {
  ai_candidate: "border-amber-500/70 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium",
  needs_evidence: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  verified: "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium",
  false_positive: "border-muted-foreground/30 text-muted-foreground line-through bg-muted/30",
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
