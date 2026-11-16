import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { SlidersHorizontal } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { SEVERITIES, SEVERITY_SCORE, capitalize } from "@/lib/finding-style"
import type { Finding, FindingDetail, FindingStatus, FindingUpdate, Severity } from "@/lib/types"

type ButtonVariant = "default" | "secondary" | "outline"

// Mirrors the backend's ALLOWED_TRANSITIONS (app/api/findings.py).
// The server stays the authority: anything else would be rejected with a 409.
const ACTIONS: Record<FindingStatus, { to: FindingStatus; label: string; variant: ButtonVariant }[]> = {
  ai_candidate: [
    { to: "verified", label: "Verify finding", variant: "default" },
    { to: "needs_evidence", label: "Needs evidence", variant: "secondary" },
    { to: "false_positive", label: "False positive", variant: "outline" },
  ],
  needs_evidence: [
    { to: "verified", label: "Verify finding", variant: "default" },
    { to: "false_positive", label: "False positive", variant: "outline" },
  ],
  verified: [
    { to: "needs_evidence", label: "Reopen: needs evidence", variant: "secondary" },
    { to: "false_positive", label: "Mark false positive", variant: "outline" },
  ],
  false_positive: [{ to: "ai_candidate", label: "Reopen as candidate", variant: "secondary" }],
}

export function FindingReview({ finding }: { finding: FindingDetail }) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState(finding.assessor_notes)
  const [severity, setSeverity] = useState<Severity>(finding.severity)
  const initialScore = finding.score > 0 ? finding.score : SEVERITY_SCORE[finding.severity]
  const [score, setScore] = useState<string>(String(initialScore))

  const update = useMutation({
    mutationFn: (payload: FindingUpdate) =>
      api<Finding>(`/api/findings/${finding.id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: (_updated, payload) => {
      queryClient.invalidateQueries({ queryKey: ["finding", finding.id] })
      queryClient.invalidateQueries({ queryKey: ["findings"] })
      const messages: Record<string, string> = {
        verified: "Finding verified",
        false_positive: "Marked as false positive",
        needs_evidence: "Marked as needing evidence",
        ai_candidate: "Reopened as candidate",
      }
      const status = payload.status
      toast.success(status ? (messages[status] ?? "Finding updated") : "Changes saved")
    },
  })

  if (!hasRole("admin", "assessor")) {
    return (
      <Alert>
        <AlertDescription>Read-only: only assessors and admins can verify or dismiss findings.</AlertDescription>
      </Alert>
    )
  }

  const parsedScore = parseFloat(score)
  const validScore = !isNaN(parsedScore) && parsedScore >= 0 && parsedScore <= 10
  const notesChanged = notes !== finding.assessor_notes
  const severityChanged = severity !== finding.severity
  const scoreChanged = validScore && Math.abs(parsedScore - initialScore) > 0.05
  const hasAdjustments = notesChanged || severityChanged || scoreChanged

  const buildPayload = (newStatus?: FindingStatus): FindingUpdate => {
    const payload: FindingUpdate = {}
    if (newStatus) payload.status = newStatus
    if (notesChanged || newStatus) payload.assessor_notes = notes
    if (severityChanged) payload.severity = severity
    if (scoreChanged && validScore) payload.score = Number(parsedScore.toFixed(1))
    return payload
  }

  return (
    <div className="space-y-4 rounded-md border p-3.5 bg-card/60">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Assessor Decision & Governance</p>
        {(severityChanged || scoreChanged) && (
          <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/40 py-0">
            Override active
          </Badge>
        )}
      </div>

      {/* Assessor Notes Input */}
      <div className="grid gap-1.5">
        <Label htmlFor={`notes-${finding.id}`} className="text-xs font-medium">Assessor notes</Label>
        <Textarea
          id={`notes-${finding.id}`}
          value={notes}
          maxLength={4000}
          rows={3}
          placeholder="What did you check? How did you confirm or dismiss this finding?"
          onChange={(event) => setNotes(event.target.value)}
          className="text-xs leading-relaxed"
        />
      </div>

      {/* Severity and Score Adjustments */}
      <div className="pt-2 border-t space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <SlidersHorizontal className="size-3.5 text-primary" />
          <span className="font-medium text-foreground">Assessor Adjustments</span>
          <span className="text-[11px]">(override AI severity &amp; CVSS score)</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor={`severity-${finding.id}`} className="text-[11px] text-muted-foreground">
              Severity Level
            </Label>
            <Select
              value={severity}
              onValueChange={(val) => {
                const newSev = val as Severity
                setSeverity(newSev)
                if (score === String(SEVERITY_SCORE[severity])) {
                  setScore(String(SEVERITY_SCORE[newSev]))
                }
              }}
            >
              <SelectTrigger id={`severity-${finding.id}`} className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {capitalize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor={`score-${finding.id}`} className="text-[11px] text-muted-foreground">
              Risk Score (0.0 – 10.0)
            </Label>
            <Input
              id={`score-${finding.id}`}
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {finding.evidence.length === 0 && finding.status !== "verified" && (
        <p className="text-xs text-muted-foreground">
          No evidence is attached yet. Confirming a finding without evidence weakens the assessment report.
        </p>
      )}

      {update.error && (
        <Alert variant="destructive">
          <AlertDescription>{update.error.message}</AlertDescription>
        </Alert>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
        {ACTIONS[finding.status].map((action) => (
          <Button
            key={action.to}
            size="sm"
            variant={action.variant}
            disabled={update.isPending}
            onClick={() => update.mutate(buildPayload(action.to))}
          >
            {action.label}
          </Button>
        ))}

        <Button
          size="sm"
          variant="ghost"
          disabled={update.isPending || !hasAdjustments}
          onClick={() => update.mutate(buildPayload())}
        >
          {notesChanged && !severityChanged && !scoreChanged ? "Save notes only" : "Save changes"}
        </Button>
      </div>
    </div>
  )
}
