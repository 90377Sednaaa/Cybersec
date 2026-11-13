# Proposal: delete a generated report

Proposed by: M1 (90377Sednaaa) · Date: 2026-11-13 · Status: open (implemented, pending team review)

## The idea

Add `DELETE /api/reports/{id}` (admin + assessor, 204) and a Delete action on each report row in the
assessment run page. The row and its PDF are removed together. A report whose generation is still running is
refused with 409.

## Why

- **Real gap:** reports accumulate and cannot be removed. Every failed attempt (for example while Playwright
  Chromium was missing) leaves a permanent `failed` row in the run view, and `ready` rows leave PDFs behind in
  `backend/reports/` with no way to reclaim the space or hide an outdated report.
- **Demo value:** a rehearsed demo generates several throwaway reports. Being unable to clean up makes the run
  page look cluttered in the evidence pack.
- **Consistency:** targets and providers are deletable; reports were the obvious remaining gap.

## Cost

One short session. Additive contract: one new endpoint, no existing request or response shape changed.
Touches M4 (`app/api/reports.py`, `src/pages/assessment-reports.tsx`). Ships with 5 new backend tests.

## Risk

- **Deleting a row the background job still owns:** a `pending` report is mid-generation, and the job writes to
  the row afterwards. Refused with 409 instead.
- **Path traversal through `file_path`:** the stored name is only unlinked after `resolve()` proves it lives
  inside `REPORTS_DIR`, the same guard the download endpoint uses. A tampered path deletes the row but leaves
  the outside file alone. Pinned by a test.
- **Losing evidence:** a report is a derived artifact, not the audit trail. Findings, verification states and
  the run are untouched, and a new report can always be regenerated. The confirm dialog says so.
- **Main stays green:** `pytest tests -q` and `npm run build` both pass.

## Out of scope

Deleting findings, assessments, evidence or users. Findings stay undeletable by design; they carry the
verification audit trail.

## Also in this change

The `failed` report row previously rendered the raw multi-line Playwright launch error verbatim, including the
ASCII box and install instructions, wrapped in red across the card. It now collapses to one line
("Report generation failed. Show details") with the full text behind a native `<details>` toggle.

## Decision

Filled in at the daily sync: accepted / rejected, one-line reason, and the steward's note about contract or
timeline impact.
