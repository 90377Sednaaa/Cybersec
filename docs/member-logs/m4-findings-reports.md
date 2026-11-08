# Member Log M4 — Findings, Verification & Reports

> Build log for M4 (owner: member 4). Started 2026-11-08, written *as the module is built* —
> at the end it is the oral-defense script (approach, decisions, verification evidence, honest
> limitations), mirroring the structure of the M1 log.

**Status: in progress.** Task order: T4.0 → T4.1 → T4.3 → T4.2 → T4.5 → T4.4 (state machine
first because M3 builds the findings page against it; report last because it depends on evidence,
risk model, and Playwright). T4.6 (export) is stretch and deferred per the plan's cut line.

## What was built (per task)

| Task | Delivered | Files | Status |
|---|---|---|---|
| T4.0 Contract | Findings/evidence/report request+response schemas for the frozen Wave-1 sketch | `app/schemas/findings.py` | pending |
| T4.1 Findings API | List with filters, detail, PATCH with the server-enforced verification state machine, role guards | `app/api/findings.py`, `tests/test_findings_api.py` | pending |
| T4.3 Severity model | 4-tier + 0-10 score helper, OWASP Risk Rating mapping, methodology note | `app/risk.py`, `docs/risk-methodology.md`, `tests/test_risk_model.py` | pending |
| T4.2 Evidence | Manual upload (5 MB cap, allow-list), list, safe download, auto-capture helper from job raw output | `app/api/evidence.py`, `app/evidence_capture.py`, `tests/test_evidence_api.py` | pending |
| T4.5 Auth hardening | Change-own-password endpoint, endpoint × role audit checklist, team accounts via users API | `app/api/auth.py`, `docs/auth-checklist.md` | pending |
| T4.4 Report generation | Jinja2 HTML template → Playwright PDF, background job, 202 + download endpoints | `app/api/reports.py`, `app/reporting.py`, `reports/template.html`, `tests/test_reports_api.py` | pending |

## The approach

- **Contract first (T4.0), then the state machine (T4.1)** — the verification state machine is the
  graded heart of the module ("human verification" is a platform hard rule), so it lands before
  anything cosmetic.
- **No DB migrations.** The scaffold's `Finding`/`Evidence` models already carry every field the
  frozen contract needs; M4 adds only a new `reports` table (additive, `create_all` picks it up).
  New columns on existing tables are avoided on purpose: `create_all` does not ALTER existing
  SQLite tables, and five members share the schema.
- **New schemas in a new file** (`schemas/findings.py`) instead of editing the shared
  `schemas/common.py` — keeps the frozen shapes untouched and the diff reviewable.
- **Evidence auto-capture builds on M1's normalizer**, which already writes `tool_output`
  evidence rows; M4 adds an `http_transcript` adapter + the upload/download endpoints around it.
- **Report degrades gracefully**: if Playwright/Chromium is missing (install is M5's T5.1), the
  report job fails with an actionable log line instead of crashing the API — same fail-soft
  pattern as M1's runners.

## Key decisions and trade-offs (defense talking points)

(filled in as tasks land)

## Verification evidence

- Environment verified before any M4 work: fresh clone, venv, `pytest tests -q` →
  **9 passed** (Python 3.12.7 on this machine; project targets 3.13 but no 3.13-only
  features are used — noted honestly rather than silently).

(per-task evidence added as tests land)

## Honest limitations

(filled in as the module matures)
