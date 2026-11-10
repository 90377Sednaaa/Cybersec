# M4 to M3 hand-off: findings page + report button behavior spec

Everything below is live on `main` and covered by tests
(`backend/tests/test_findings_api.py`, `test_evidence_api.py`,
`test_reports_api.py`). Field names are exact — mirror them into
`src/lib/types.ts`. OpenAPI: http://127.0.0.1:8000/docs (tags: findings,
evidence, reports).

## 1. Types (mirror into types.ts)

```ts
type FindingStatus = "ai_candidate" | "needs_evidence" | "verified" | "false_positive"
type Severity = "info" | "low" | "medium" | "high" | "critical"
type EvidenceKind = "http_transcript" | "tool_output" | "upload"
type ReportStatus = "pending" | "ready" | "failed"

interface Finding {            // GET /api/findings (frozen shape, unchanged)
  id: number; assessment_id: number | null; category: string; title: string
  description: string; severity: Severity; score: number; status: FindingStatus
  ai_confidence: number; remediation: string; assessor_notes: string
}

interface FindingDetail extends Finding {   // GET /api/findings/{id}
  verified_by_id: number | null
  verified_at: string | null               // ISO datetime, null when unverified
  verified_by: string | null               // verifier email, resolved server-side
  evidence: Evidence[]
}

interface Evidence {
  id: number; finding_id: number; kind: EvidenceKind; label: string
  content: string; tool: string; captured_at: string
  // note: no file_path by design - uploads download via the endpoint below
}

interface Report {
  id: number; assessment_id: number; status: ReportStatus
  error: string; created_at: string; finished_at: string | null
}
```

## 2. Findings table (T3.2)

- `GET /api/findings?assessment_id=&status=&severity=&category=` → `Finding[]`,
  newest first, cap 200. All filters optional and combinable; invalid enum → 422.
- `ai_candidate` rows must stay visually marked (platform hard rule: never
  looks confirmed). Suggested: the severity pill for status + a distinct
  badge/border for `ai_candidate`; `verified` green check, `false_positive`
  muted/struck-through, `needs_evidence` amber.
- Severity colors: use the semantic `--severity-*` tokens, not ad-hoc colors.

## 3. Detail drawer

- `GET /api/findings/{id}` → `FindingDetail`. Show attribution when present:
  "Verified by {verified_by} at {verified_at}".
- Evidence tab: list `evidence[]`; `kind` icons (transcript / tool / upload);
  render `content` in a monospace block (it can be multi-line); uploads have
  empty `content` — show a download link instead:
  `GET /api/evidence/{id}/download` (auth header; response is an attachment).

## 4. Verification actions (assessor/admin only)

`PATCH /api/findings/{id}` with any of `{status?, severity?, score?,
assessor_notes?}` — at least one field, `score` 0-10, notes ≤ 4000 chars.

Legal status moves (server-enforced; others → **409**):

```
ai_candidate  -> verified | false_positive | needs_evidence
needs_evidence-> verified | false_positive
verified      -> false_positive | needs_evidence   (reopen; clears attribution)
false_positive-> ai_candidate                        (reopen a dismissal)
```

- `verified` stamps who/when server-side (never sent from the client).
- Viewers: every mutation → **403**. Detect role from `/api/auth/me` and render
  read-only UI; also handle 403 defensively.
- Empty body → 422; illegal move → 409 with `detail` "Illegal transition: ...".
- Severity edit without status change is a normal PATCH (both fields in one
  request is fine).

## 5. Evidence upload (assessor/admin)

`POST /api/findings/{id}/evidence`, multipart field name **`file`**.
- 5 MB cap → 413; allow-list png/jpg/jpeg/gif/webp/pdf/txt/log/csv/json/xml/zip
  → 415 otherwise (detail lists allowed extensions — surface it).
- Success 201 → `Evidence` (kind `upload`, label = original filename).

## 6. Report button (T3.5)

On assessment detail (status `completed` is the natural place):

1. `POST /api/assessments/{id}/report` → **202** + `Report` (`status: "pending"`).
   Assessor/admin only (viewer → 403).
2. Poll `GET /api/assessments/{id}/reports` (list, newest first) or refetch on
   dialog focus; ~2 s interval is plenty (a run takes a few seconds).
3. `status: "ready"` → download link `GET /api/reports/{id}` (streams
   `application/pdf` as attachment; `<a href>` + token via fetch → blob, or
   open after auth). `status: "failed"` → error state showing `report.error`
   (e.g. Playwright/Chromium missing — actionable text comes from the server).
4. While pending, a download attempt would 409 — prefer the list status.

## 7. Conventions reminders (AGENTS.md)

Both themes (dark default), no em-dashes in UI copy, skeletons/empty/error
states, HelpHints on the three actions (verify / false positive / needs
evidence) explaining the workflow in one sentence each.
