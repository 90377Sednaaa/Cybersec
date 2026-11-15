# QA Checklist & Evidence Plan - Aletheia

**M5 task T5.3.** Owner: M5. Status: checklist and evidence scaffold ready 2026-11-15; **live capture not yet
performed**. The scripted Juice Shop demo run is blocked by M5 T5.1 (Nmap, ZAP daemon, Playwright Chromium
are not installed) and by the absence of a real LLM provider key. This document is the run sheet for that
rehearsal, not a claim that it happened.

Acceptance criterion from `TASK_PLAN.md` T5.3: *every rubric line (A4, B1-B7) has at least one evidence
artifact behind a checklist entry.*

---

## 0. How to use this document

1. Run `scripts/setup-dev.ps1`, then confirm §1 (environment gate) is all green.
2. Start the four processes in §1.2 and sign in with an **assessor** account.
3. Walk §2 in order, one pipeline stage at a time. For each row: perform the action, assert the expected
   result, capture the named artifact into `docs/evidence/<stage>/`.
4. Tick the checkbox, add the artifact filename and the date. Never tick a box without a file.
5. Fill §3 (rubric traceability) with the official rubric wording, then sign off in §6.

**Capture conventions:** `E-NN-short-name.png` for screenshots (a `b` suffix such as `E-06b` denotes a
supplementary capture for the same claim), `.json` / `.txt` for exports, `.pdf` for reports. Never capture a screen containing a real API key, a JWT, or an unredacted prompt. Screenshots of
LLM settings must show `has_api_key: true`, not the key itself. All artifacts are static files committed to
`docs/evidence/`; generated PDFs and uploaded evidence blobs stay in their gitignored runtime directories.

---

## 1. Pre-flight gate

### 1.1 Static verification (repeat before every push)

| # | Check | Command (from repo root) | Expected | Tick |
|---|---|---|---|---|
| V1 | Backend tests | `cd backend; .venv\Scripts\python -m pytest tests -q` | 268 passed, 0 failed (baseline in `AGENTS.md`) | [ ] |
| V2 | Frontend build | `cd frontend; npm run build` | `tsc -b && vite build` completes, 0 errors | [ ] |
| V3 | Frontend lint | `cd frontend; npm run lint` | 0 errors, 7 known warnings (shadcn fast-refresh / `Math.random`, `use-mobile` set-state-in-effect, `GradientASCII` ref-during-render) | [ ] |
| V4 | Backend boots | `.venv\Scripts\python -m uvicorn app.main:app --port 8000` | `GET /health` -> 200 | [ ] |
| V5 | Auth + list endpoints | see `docs/INTEGRATION_LOG.md` smoke row | login 200; all list endpoints 200 with a valid JWT | [ ] |
| V6 | Secrets hygiene | `git status`, search staged diff for keys | no `.env`, no API key, no token staged | [ ] |
| V7 | Both themes | manual browser pass on dashboard + findings + wizard | no contrast/layout regressions in dark and light, plus a narrow viewport | [ ] |

V7 is still outstanding for the Wave 4 dashboard changes because Playwright Chromium is missing; a manual
browser pass is acceptable until T5.1 lands (`AGENTS.md`).

### 1.2 Runtime topology for the rehearsal

| Process | Command | Ready signal |
|---|---|---|
| Backend | `cd backend; .venv\Scripts\python -m uvicorn app.main:app --port 8000` | `http://127.0.0.1:8000/health` -> 200 |
| Frontend | `cd frontend; npm run dev` | `http://localhost:5173` loads |
| Juice Shop | `npm start` in the Juice Shop clone | `http://localhost:3000` loads |
| ZAP daemon | `zap.bat -cmd -daemon -port 8080 -config api.key=<key>` | `http://127.0.0.1:8080` responds (only for `full_intrusive`) |
| LLM provider | Settings page: paste a real key, enable provider, "Test connection" | `{ok: true, model, latency_ms}` |

Do **not** run the intrusive path against anything except the local Juice Shop target with an explicit
`authorization_ref` and `allowed_intensity = full_intrusive`.

---

## 2. Scripted demo run (brief's eight steps)

Each row maps to one artifact in `docs/evidence/`. Stage folders are pre-created with `.gitkeep`.

| Step | Action | Expected result (assert) | Artifact | Tick |
|---|---|---|---|---|
| 1. Define scope | `POST /api/targets` for local Juice Shop with `authorization_ref`, in-scope assets, `passive_safe` | 201; `base_url` absolute http(s); missing `authorization_ref` -> 422 | `01-scope/E-01-target-registry.png` | [ ] |
| 1b. Scope safety | Request an assessment with `full_intrusive` against that passive-safe target | **409** server-side; no intrusive job scheduled | `01-scope/E-02-intensity-gate-409.png` | [ ] |
| 2. Recon | Start the assessment; watch the `dns` and `nmap` jobs | DNS A/AAAA/MX/TXT results stored on `jobs.raw_output`; nmap XML parsed into hosts/ports | `02-recon/E-03-dns-job.json`, `03-scan/E-04-nmap-output.json` | [ ] |
| 3. Scanning | `prober` (and `zap` only on a separate full-intrusive run) | Security-header, TLS, cookie and banner observations; ZAP alerts with categories | `03-scan/E-05-prober-and-zap-alerts.png` | [ ] |
| 4. Assessment | Watch `/api/assessments/{id}/events` live; refresh mid-run; cancel a second run | Snapshot + live job/progress/log events; refresh keeps state; cancel marks jobs `cancelled` not `failed` | `04-assessment/E-06-sse-live-log.png`, `04-assessment/E-06b-job-timeline.png` | [ ] |
| 5. AI analysis | With a real key enabled, let interpretation run after normalization | New `ai_candidate` findings appear; an `AIOutput` audit row is written for every attempt, success or failure; prompt payload is redacted | `05-ai/E-07-interpretation-output.json`, `05-ai/E-08-redaction-test.txt` | [ ] |
| 6. Human verification | Assessor reviews a candidate, inspects evidence, PATCHes to `verified` with notes | `verified_by`/`verified_at` set; viewer PATCH -> 403; illegal transition -> 409; overlapping decision -> 409 | `06-verification/E-09-verification-before-after.png`, `06-verification/E-10-evidence-detail.png` | [ ] |
| 6b. Viewer read-only | Sign in as viewer, attempt a mutation | 403, no state change | `06-verification/E-09b-viewer-403.png` | [ ] |
| 7. Risk assessment | Set severity/score on verified findings; open the dashboard | OWASP Risk Rating bands in `docs/risk-methodology.md` agree with the risk table; chart shows real totals from `X-Total-Count` | `07-risk/E-11-risk-table.png`, `07-risk/E-11b-dashboard.png` | [ ] |
| 8. Report | "Generate report" -> 202 -> poll -> download | PDF contains cover, methodology, scope, findings by severity, evidence excerpts, risk table, recommendations, AI summary; totals match the findings list | `08-report/E-12-generated-report.pdf` | [ ] |
| 8b. Dashboard | Screenshot dashboard in dark, light and a narrow viewport | Legible in all three; no clipped charts | `08-report/E-13-dashboard-themes.png` | [ ] |
| Close-out | Export the build/test output and commit history per member | `npm run build`, `pytest`, `npm run lint`, `git log` per member | `99-exports/E-14-verification-log.txt`, `99-exports/E-15-member-contributions.md` | [ ] |

**Captured AI outputs:** `AIOutput` rows are the authoritative evidence for the AI features. Export them
(without any provider key) to `05-ai/E-07-interpretation-output.json` and note the model name and task.

**Verified findings export:** copy the verified finding rows (id, title, category, severity, score, status,
verified_by, verified_at) into `99-exports/E-16-verified-findings.csv`.

---

## 3. Rubric traceability (T5.3 acceptance criterion)

> **Important:** the course brief is not stored in this repository. The codes below (`A4`, `B1`-`B7`) are
> taken verbatim from `TASK_PLAN.md` T5.3, and the criterion text in the second column is a **provisional
> label**, not the official wording. The M5 owner must paste the exact rubric text from the course brief
> before submission, then confirm each row still has at least one artifact. Grading context from `AGENTS.md`:
> Documentation 30 / Implementation 50 / Individual & Oral Defense 20.

| Rubric line | Provisional criterion | Evidence artifact(s) | Supporting document | Done |
|---|---|---|---|---|
| **A4** | Documentation: system design / methodology and framework references | `E-12` report, `E-11` risk table | `docs/proposal.md`, `docs/system-design.md`, `docs/risk-methodology.md` | [ ] |
| **B1** | Scope management and authorized targets | `E-01`, `E-02` | `PLAN.md` §2, `app/api/targets.py` | [ ] |
| **B2** | Integration of existing security tools (minimum 2, shipped 4) | `E-03`, `E-04`, `E-05` | `app/scanner/**` | [ ] |
| **B3** | Assessment categories (minimum 3, committed 5) | `E-05`, `E-09` | `app/schemas/assessment.py`, `scanner/normalize.py` | [ ] |
| **B4** | AI integration and its limitations (minimum 2 features) | `E-07`, `E-08` | `app/ai/**`, `docs/final-report.md` §6 | [ ] |
| **B5** | Human verification and risk assessment | `E-09`, `E-09b`, `E-10`, `E-11` | `app/api/findings.py`, `docs/risk-methodology.md` | [ ] |
| **B6** | Orchestration, dashboard and report generation | `E-06`, `E-12`, `E-13` | `app/scanner/orchestrator.py`, `app/reporting.py` | [ ] |
| **B7** | Quality assurance, security hardening, evidence | `E-02`, `E-14`, `E-15`, `E-16` | `docs/qa-checklist.md`, `docs/auth-checklist.md`, `docs/INTEGRATION_LOG.md` | [ ] |
| Individual / oral defense | Understanding of individual contribution and AI limitations | `E-15` + all five `docs/member-logs/m<N>-*.md` | `docs/presentation-skeleton.md` | [ ] |

---

## 4. Negative / security checks (must pass, no exceptions)

| # | Check | Expected | Tick |
|---|---|---|---|
| S1 | `passive_safe` target + intrusive request | 409, no ZAP active scan or wordlist job | [ ] |
| S2 | Viewer performs any mutation | 403 | [ ] |
| S3 | Illegal finding transition / overlapping decision | 409 | [ ] |
| S4 | Second concurrent run for the same target | 409 | [ ] |
| S5 | Provider key in any API response or log | never present; `has_api_key` boolean only | [ ] |
| S6 | Credentials in an outbound LLM prompt | redacted (`tests/test_redaction.py`) | [ ] |
| S7 | Private/loopback host without `authorization_ref`, cloud metadata host, leading-dash hostname | rejected before any tool runs | [ ] |
| S8 | `ai_candidate` counted as a confirmed finding anywhere in UI or report | never | [ ] |

---

## 5. Known failures to disclose, not to hide

Record these in the demo debrief and in `docs/final-report.md` §9. They are documented in `AGENTS.md` and
`docs/system-design.md` §8.

1. Nmap, ZAP daemon and Playwright Chromium are not installed until T5.1 runs. Fail-soft behaviour is by
   design, but a live full-intrusive run and PDF generation cannot be demonstrated until they are.
2. Without a real LLM provider key, AI interpretation is skipped cleanly; the demo still works on the
   rule-based normalizer. AI evidence therefore needs a key to be captured.
3. SQLite FKs are unenforced; target deletion is not offered in the UI to avoid orphaned rows.
4. No login rate limiting, no frontend automated test harness, no evidence binary download from the detail
   drawer.
5. `docs/auth-checklist.md` has drifted (still says `PUT /api/targets/{id}`); M4 owns that file and must
   refresh it. M5 flags it here rather than rewriting another member's log.
6. A backend restart kills an in-flight run because the worker is in-process (`PLAN.md` §1 decision).

---

## 6. Sign-off

| Role | Name | Date | What was checked |
|---|---|---|---|
| M5 (QA owner) | | | checklist + evidence completeness + rubric wording |
| M1 | | | scan pipeline artifacts E-03..E-06 |
| M2 | | | AI artifacts E-07, E-08 |
| M3 | | | UI artifacts, both themes |
| M4 | | | verification, risk, report artifacts |
| Team lead | | | final demo rehearsal (I4) |
