import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { Finding, FindingDetail, FindingStatus, FindingUpdate } from "@/lib/types"

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

  const update = useMutation({
    mutationFn: (payload: FindingUpdate) =>
      api<Finding>(`/api/findings/${finding.id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finding", finding.id] })
      queryClient.invalidateQueries({ queryKey: ["findings"] })
    },
  })

  if (!hasRole("admin", "assessor")) {
    return (
      <Alert>
        <AlertDescription>Read-only: only assessors and admins can verify or dismiss findings.</AlertDescription>
      </Alert>
    )
  }

  const notesChanged = notes !== finding.assessor_notes

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Assessor decision</p>

      <div className="grid gap-1.5">
        <Label htmlFor={`notes-${finding.id}`}>Assessor notes</Label>
        <Textarea
          id={`notes-${finding.id}`}
          value={notes}
          maxLength={4000}
          rows={3}
          placeholder="What did you check? How did you confirm or dismiss this finding?"
          onChange={(event) => setNotes(event.target.value)}
        />
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

      <div className="flex flex-wrap gap-2">
        {ACTIONS[finding.status].map((action) => (
          <Button
            key={action.to}
            size="sm"
            variant={action.variant}
            disabled={update.isPending}
            onClick={() => update.mutate({ status: action.to, assessor_notes: notes })}
          >
            {action.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={update.isPending || !notesChanged}
          onClick={() => update.mutate({ assessor_notes: notes })}
        >
          Save notes only
        </Button>
      </div>
    </div>
  )
}