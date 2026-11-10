# Member Log M4 — Findings, Verification & Reports

> Build log for M4 (owner: member 4). Started 2026-11-08, completed 2026-11-09 (Wave 2).
> Written as the module was built — the oral-defense script (approach, decisions,
> verification evidence, honest limitations), mirroring the M1 log structure.

**Status: Wave-2 tasks complete** (T4.0–T4.5 done, T4.6 stretch deferred per the
plan's cut line). Build order used: T4.0 → T4.1 → T4.3 → T4.2 → T4.5 → T4.4 —
state machine first (M3 and integration I2 depend on it), report last (depends
on evidence, risk model, Playwright).

## What was built (per task)

| Task | Delivered | Files | Status |
|---|---|---|---|
| T4.0 Contract | FindingUpdate / EvidenceOut / FindingDetailOut / ReportOut schemas for the frozen Wave-1 sketch | `app/schemas/findings.py` | done |
| T4.1 Findings API | Filtered list, detail with audit trail + evidence, PATCH with server-enforced verification state machine and role guards | `app/api/findings.py`, `tests/test_findings_api.py` | done |
| T4.3 Severity model | OWASP likelihood×impact matrix, 0-10 bands both directions, methodology note | `app/risk.py`, `docs/risk-methodology.md`, `tests/test_risk_model.py` | done |
| T4.2 Evidence | Manual upload (5 MB cap, allow-list, UUID names), list, safe download, http_transcript auto-capture helper | `app/api/evidence.py`, `app/evidence_capture.py`, `tests/test_evidence_api.py` | done |
| T4.5 Auth hardening | Change-own-password endpoint, full endpoint×role audit, team-account policy | `app/api/auth.py`, `app/schemas/auth.py`, `docs/auth-checklist.md`, `tests/test_auth_hardening.py` | done |
| T4.4 Report generation | Background report job, Jinja2 template (8 sections), Playwright PDF, 202/poll/download endpoints | `app/models/report.py`, `app/reporting.py`, `app/templates/report.html`, `app/api/reports.py`, `tests/test_reports_api.py` | done |
| T4.6 Export CSV/JSON | — | — | stretch, deferred (first on the plan's cut line) |

Shared-file one-liners (steward-flagged `fix():` commits, per tweak etiquette):
reports/evidence router registration in `app/main.py`, `Report` import in
`app/models/__init__.py`, jinja2+playwright in `requirements.txt`, `.gitignore`
for `backend/evidence/` + `backend/reports/`.

## The approach

- **Contract first, then the state machine.** T4.0 froze exact Pydantic shapes
  in a *new* file (`schemas/findings.py`) — the frozen `FindingOut` in
  `schemas/common.py` was never edited, so M1/M3 build against an unchanged list
  shape while detail/PATCH grew additively around it.
- **No DB migrations.** The scaffold's Finding/Evidence models already carried
  every contract field; M4 added exactly one new table (`reports`). Rationale:
  `create_all` does not ALTER existing SQLite tables, and five members share one
  schema — additive-only is the rule the whole team can rely on.
- **Every platform hard rule lands server-side.** The state machine
  (`ALLOWED_TRANSITIONS` + 409), attribution (`verified_by/at` from the JWT,
  never the request body), role guards (viewer 403 on all mutations), evidence
  download safety (UUID names, octet-stream + attachment + nosniff, path
  resolution jailed to the evidence dir) — none of it depends on the UI
  behaving.
- **Fail-soft report job.** Generation runs as a background task and every
  failure mode (missing Playwright, missing Chromium, render error) degrades to
  a `failed` row with an actionable message; the API always answers 202 first.
  Same philosophy as M1's runners: a missing binary must not kill the pipeline.
- **Tests as the proof, docs as the contract.** 75 M4 tests cover every
  acceptance line of T4.1–T4.5; `docs/risk-methodology.md`'s matrix is *parsed
  by a test* and compared against `app/risk.py`, so doc and code cannot drift.

## Key decisions and trade-offs (defense talking points)

1. **The state machine is a table, not if-chains.** `ALLOWED_TRANSITIONS` maps
   every status to its legal successors; illegal moves 409 with both statuses
   in the message. Reopening is supported (`verified → needs_evidence`,
   `false_positive → ai_candidate`) because assessors change their minds — but
   reopening *clears* the old attribution, and only a new assessor PATCH can
   re-stamp it. Nothing ever reaches `verified` without a human identity
   attached: that is the platform's core rule, enforced in one place.
2. **Attribution from the JWT, never the body.** A client cannot claim someone
   else verified a finding; `verified_by` in the detail response is resolved
   server-side from the stamped id.
3. **Evidence uploads are data, never code.** Random UUID filenames, the
   original name survives only as a label, downloads force
   `application/octet-stream` + `Content-Disposition: attachment` +
   `X-Content-Type-Options: nosniff`, and stored paths are resolved strictly
   inside `backend/evidence/` (a tampered row pointing at `../platform.db`
   serves 404 — tested). `file_path` is not in any response schema.
4. **The 5 MB cap is read-checked, not header-trusted.** The endpoint reads
   cap+1 bytes: exactly 5 MB passes, one byte more 413s, and rejected files are
   never written to disk (tested).
5. **Risk model is bidirectional and doc-locked.** `risk_rating()` maps OWASP
   likelihood×impact to tiers (OWASP's "Note" = `info`); `severity_for_score()`
   and `score_for()` are inverses (round-trip tested); the methodology doc's
   table is machine-checked against the code. The report's risk table uses the
   assessor's explicit score, falling back to the tier's representative value.
6. **Report = job, not request.** POST returns 202 with a `pending` row; a
   background task renders Jinja2 → Chromium PDF → flips the row. Pending and
   failed downloads are 409 with the reason. The AI summary slot renders an
   *honest placeholder* that states verified vs unverified counts — the report
   never fakes M2 content.
7. **Template lives in `app/templates/report.html`** (app code) rather than the
   planned `backend/reports/` — that directory is gitignored runtime output;
   mixing a source file into it would have been fragile. Deviation noted here
   deliberately.
8. **Change-password requires the current password** so a stolen unattended
   session cannot lock the owner out; stateless JWTs stay valid until expiry
   (documented limitation, not a silent one).

## Verification evidence

- **Test suite: 151 passed** on `main` after the M4 build (M1 9 + M2 67 + M4 75),
  zero failures, run before every push; `uvicorn` boot + `/openapi.json` endpoint
  registration checked before every push (health 200 each time).
- **T4.1 (14 tests):** frozen list shape; 401 unauthenticated; all four filters
  + combined; detail keys/evidence/no `file_path` leak; 404s; attribution
  stamped from JWT; 4 illegal transitions table-driven; reopen paths incl.
  attribution re-stamp; notes/severity without status change; empty body 422;
  score 11 → 422; viewer 403 on status *and* notes mutations while reads stay 200.
- **T4.3 (28 tests):** all nine OWASP pairs; matrix completeness; ValueError on
  unknown axes; case-insensitivity; band-edge table; clamping; representative
  values; round-trip; monotonicity; **doc/code consistency** (parses
  `docs/risk-methodology.md`, asserts every cell equals `risk_rating()`).
- **T4.2 (16 tests):** upload round-trip incl. on-disk bytes; 413 over-cap with
  nothing written; exactly-5 MB accepted; 415 on `.exe` and no-extension;
  viewer 403; 404s; mixed auto+manual list order; download round-trip with
  attachment + octet-stream; inline evidence 404; traversal row 404; missing
  file 404; transcript content from prober raw output; idempotency per
  (finding, job); non-prober/bad-JSON skips.
- **T4.5 (8 tests):** password rotation (old rejected at login, new accepted);
  wrong current → 401 with nothing changed; short new → 422; unauthenticated →
  401; viewer self-service works; users API admin-only; target delete
  admin-only.
- **T4.4 (9 tests):** full lifecycle with a **real %PDF- download** (~108 KB,
  5 pages on a 2-finding fixture; 6+ pages expected on the real Juice Shop
  dataset); forced-failure via impossible browser dir (API still 202, row
  `failed` with error); context grouping/scoring/attribution; template section
  markers; viewer 403; 404s. Deterministic without sleeps — BackgroundTasks
  settle inside TestClient.
- **Commits (all on `main`, Conventional Commits with bodies):** `ea51b77` log,
  `f305b04` T4.0, `1c78a41` T4.1, `eff29c6` T4.3, `3f1a321`+`f6e0d42` T4.2,
  `31e0841` T4.5 (rebased cleanly over M3's UI commits mid-push),
  `0bd5c09`+`551cdfa` T4.4.

## Self-review findings (post-completion defect pass, 2026-11-10)

A structured review of the finished M4 diff (base `dbf4e74` → HEAD, review-agent pass plus a live
null-value probe against the running API) found **one real defect**, fixed with a regression test
before this log entry:

| # | Severity | Defect found | Fix |
|---|---|---|---|
| 1 | Medium | **PATCH with explicit JSON nulls returned 500** — `{"severity": null}` passed schema validation (Optional fields), `exclude_unset` kept the explicitly-sent null, and `setattr` wrote `None` into NOT NULL columns, so the commit raised `IntegrityError`. Every test passed because none sent explicit nulls. | Nulls are filtered out after the dump — they mean "not provided"; clearing notes uses `""`. Regression test `test_patch_explicit_nulls_treated_as_absent`. Commit `eb27fae`. |

Checked and clean (no findings): state-machine check ordering (a 409 never half-applies), attribution
source (JWT only), viewer 403 coverage, evidence path-escape guard, size/extension checks with
nothing written on reject, Jinja autoescape (no `| safe` anywhere), report-job defensive catch,
risk doc/code consistency, route conflicts, explicit-null `status` handling.

## Honest limitations (say these before the examiner finds them)

1. **The http_transcript adapter is not yet wired into M1's normalizer.** The
   helper (`app/evidence_capture.py`) is built and tested, but the one-line
   call-site belongs to M1's `normalize.py` — hand-off proposed, not yet merged.
   Until then auto-evidence is M1's `tool_output` kind (which already satisfies
   the demo criterion).
2. **JWTs are stateless: a password change does not revoke existing tokens.**
   Full revocation needs a token-version check per request (additive, future
   work). Documented in `docs/auth-checklist.md` §4.
3. **No login rate limiting yet** (brute-force window on `/api/auth/login`) —
   planned for the deployment stage; recorded in the checklist instead of being
   silently skipped.
4. **Report generation runs in-process** (FastAPI BackgroundTasks, like M1's
   in-process worker): a server restart mid-job leaves the row `pending`
   forever (no job reaper). Same accepted trade-off as the scan pipeline,
   isolated in `app/reporting.py`.
5. **Playwright/Chromium is now a hard runtime dependency for PDFs** — the
   failure mode is graceful (409 + actionable error), but M5's setup script
   must run `playwright install chromium` (added to the PLAN.md §11 flow via
   the requirements change).
6. **List endpoints cap at 200 rows** without pagination — fine for the course
   demo scale, not for production volume.
7. **Python 3.12.7 on the dev machine** (project targets 3.13): all 151 tests
   pass on 3.12; no 3.13-only features are used. Noted rather than hidden.

## What remains for the owner (Wave 3+)

- **Sync questions:** confirm with M2 how the interpreter creates findings
  (T2.4 says "via M4's create endpoint" but the frozen sketch has none — M4's
  position: reuse the normalizer's direct-DB pattern; a public create endpoint
  would need a proposal). Confirm M5 adopts the two steward-flagged `fix():`
  commits.
- **I2 integration:** live Juice Shop run → verify findings in the UI → status
  persists (M1+M4+M3).
- **I3 integration:** M2 summary wired into `build_report_context()["ai_summary"]`
  → report renders it instead of the placeholder.
- **README status row** for step 5 (findings verification workflow) should flip
  to done — M5 owns that file.
- Optional stretch (only after I4 passes): T4.6 export, CVSS vectors,
  cross-scan dedup.
