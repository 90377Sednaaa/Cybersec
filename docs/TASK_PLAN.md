# Team Task Plan — Aletheia

Per-member work plan with detailed expected outputs, sequenced so parallel work never breaks the build.

> **Read this first: this plan is a baseline, not a cage.** Everything in the member sections below is the
> *agreed default* — the minimum that must exist for the platform to hit the brief. It is not a ceiling.
> Your module, your call: if you have a better tool, design, or an idea that isn't in here at all, propose it
> (see "Proposing a change" below) and it can replace or extend anything negotiable.

**How sequencing works:** work runs in **waves**. Every wave has an entry condition and an exit condition.
Nobody starts Wave N until Wave N−1's exit condition is met. Wave 1 freezes the interface contracts (API shapes,
file ownership) — after that, members build in parallel against frozen contracts and integrate in a fixed order.
The wave skeleton is deliberately fixed: it is what makes everyone's ideas safe to build, whatever they turn out to be.

**Ground rules (all members):**

- Conventional Commits with detailed bodies; push after every finished task; stage by explicit path.
- `main` must always build: backend `uvicorn` boots + frontend `npm run build` passes before every push.
- Only a file's owner edits it (ownership matrix below). Shared files are changed by small hand-offs to the
  integration steward (M5), never edited in place by two people.
- Never weaken the platform rules: human verification, intensity gate, authorized targets only, secret redaction.

---

## Negotiable vs fixed

| Negotiable — propose anything | Fixed — protects everyone |
|---|---|
| Task approaches, tools, libraries within your ownership area | Platform hard rules: human verification, intensity gate, authorized targets only, secret redaction |
| Stretch goals: replace the listed ones or add your own | Wave sequence and frozen contracts after Wave 1 (additive changes only) |
| Extra features beyond the brief | File ownership boundaries (re-negotiate via proposal, never change silently) |
| Internal design, prompts, checklists, naming | `main` staying green; Conventional Commits |

## Proposing a change (lightweight RFC)

1. Copy `docs/proposals/TEMPLATE.md` to `docs/proposals/NN-short-name.md` and fill it in — ten minutes.
2. Raise it at the daily sync (or async in chat if it's small and touches only your own area).
3. **Accepted:** the steward logs it in the *Adopted changes* table below, updates the contracts
   **additively**, and adjusts affected tasks/dates.
4. **Rejected:** it gets a one-line reason in the same table — refine and re-propose if you disagree.

Adopted proposals carry the same weight as this document; anyone building against a changed contract rebuilds
their mocks/types the same day.

---

## Wave overview

| Wave | Name | Who | Duration | Entry condition | Exit condition |
|---|---|---|---|---|---|
| 1 | Contract freeze | All | Day 1, morning | Repo scaffold merged (done) | This document's API sketches reviewed + signed off by all 5; ownership matrix accepted |
| 2 | Parallel build | All | Days 2–4 | Wave 1 exit | Each member's Wave-2 tasks pass their own acceptance criteria |
| 3 | Integration | M5 leads, pairs rotate | Day 5, strictly ordered I1→I4 | Wave 2 exit | Full pipeline runs end-to-end on Juice Shop |
| 4 | Hardening & evidence | All, M5 leads | Days 6–7 | Wave 3 exit | Demo rehearsal passes; evidence pack + report draft exist |

**One-week vibecode sprint.** This plan runs in a single week with AI-assisted development. That changes where
time actually goes: writing code is no longer the bottleneck — verification, integration, and decision latency
are. Three consequences:

- **Daily 15-minute sync** instead of weekly (proposals included — small ones get decided same-day).
- **Small slices, pushed immediately.** The standing commit-push rule is what makes a 7-day sprint recoverable;
  nothing lives only on someone's machine overnight.
- **Every stretch goal is auto-deferred** unless integration step I4 (full rehearsal) has already passed. If
  Wave 2 is behind at the end of Day 3, the cut line in the timeline below is applied without ceremony.

Mapping to the course milestones: all seven land inside the week — milestone 1 (proposal) on Day 1, milestones
3–5 across Days 1–5, milestone 6 on Days 5–6, milestone 7 on Day 7.

---

## File ownership matrix (who may edit what)

| Area / files | Owner | Others may |
|---|---|---|
| `backend/app/scanner/**` (runners, orchestrator) | **M1** | read |
| `backend/app/ai/**` (client, redaction, prompts) | **M2** | read |
| `backend/app/api/findings.py`, `backend/app/api/reports.py`, `backend/app/api/evidence.py` | **M4** | read |
| `backend/app/api/assessments.py`, `backend/app/api/settings_llm.py` | **M1** / **M2** respectively | read |
| `frontend/src/pages/assessments.tsx`, `dashboard.tsx` | **M3** (behavior specced by M1) | read |
| `frontend/src/pages/findings.tsx` | **M3** (behavior specced by M4) | read |
| `frontend/src/pages/settings.tsx` | **M3** (behavior specced by M2) | read |
| `frontend/src/lib/types.ts`, shared components | **M3** | propose changes |
| `docs/proposal.md`, `docs/system-design.md`, evidence pack | **M5** | contribute content |
| Shared touchpoints: `backend/app/main.py` (router registration), `backend/app/models/__init__.py`, `frontend/src/App.tsx` (routes) | **M5 (steward)** merges owner-provided one-liners | — |
| `docs/PLAN.md`, `AGENTS.md` | Frozen; changes only by team consensus | — |

Model additions after Wave 1 are **additive only** (new nullable columns / new tables), scoped to the owning module.

---

## M1 — Scan engine & orchestration

**Mission:** turn "Run assessment" into a live, safe pipeline: recon → discovery → scanning → normalized results
handed to the AI interpreter, with progress streaming to the UI.

**Minimum expected output (summary):** a working orchestrator that runs Nmap + DNS + prober + ZAP against a registered
target (respecting its intensity gate), persists jobs and raw output, streams live progress over SSE, and emits
raw-result records that M2's interpreter can consume. Wire-through: "New Assessment" in the UI works end-to-end.

**Idea slots (yours to fill or ignore):** additional runners (Nuclei, deeper fingerprinting), smarter scheduling or
re-scan diffing, a scan-profile designer, anything that makes the pipeline faster or more thorough.

| Task | Build | Expected output / acceptance |
|---|---|---|
| **T1.0 Contract** | Write exact request/response shapes for the endpoints below into this doc's Appendix + `app/schemas/assessment.py` | Teammates sign off in Wave 1; FastAPI TestClient smoke test returns the documented shapes |
| **T1.1 Runner interface** | `backend/app/scanner/base.py`: `Runner` protocol (`async def run(job, ctx)`), progress callback, log-line helper, tool registry mapping `tool` string → runner class | Registry + interface unit-tested; adding a runner = one registration line |
| **T1.2 Nmap runner** | `scanner/nmap_runner.py`: subprocess call (`nmap -sV -oX -` top-ports profile), XML parse to hosts/ports/services JSON | pytest with a committed fixture XML parses correctly; real scan of `localhost` records a completed job with parsed results |
| **T1.3 DNS runner** | `scanner/dns_runner.py`: A/AAAA/MX/TXT/NS via dnspython + small built-in subdomain wordlist | Works against a real domain and `localhost`; results stored as raw output |
| **T1.4 HTTP prober** | `scanner/prober/` package (httpx): security headers, TLS cert facts, cookie flags, server banner, tech hints; directory probing only at `full_intrusive` | Against Juice Shop: passive mode finds missing-header candidates; intrusive mode adds wordlist hits; prober never touches out-of-scope paths |
| **T1.5 ZAP integration** | `scanner/zap_runner.py`: daemon client (start against `ZAP_API_URL`), spider, active scan **only when intensity = full_intrusive**, alerts polling → raw results | Scripted run: Juice Shop `full_intrusive` produces ZAP alerts; `passive_safe` target never triggers active scan (assert in test) |
| **T1.6 Orchestrator + SSE** | `api/assessments.py` + `scanner/orchestrator.py`: create assessment, pipeline assembly, job state machine persisted to DB, `GET /api/assessments/{id}/events` SSE streaming progress + log lines, cancel support | Full run on Juice Shop: 4+ jobs complete, UI watches live progress, refresh keeps state (jobs table) |
| **T1.7 Intensity gate** | Enforcement inside orchestrator scheduling (server-side), plus unit test proving a `passive_safe` target can never schedule an intrusive runner | Test in CI-style check list; code path returns 409 on direct API attempt |

**Depends on:** nothing (Wave 2 start). **Feeds:** M2 T2.4 (raw results), M3 T3.1 (SSE + wizard), M4 T4.2 (evidence sources).

---

## M2 — AI pipeline

**Mission:** the OpenAI-compatible LLM layer: provider settings with encrypted keys, secret redaction, and the two
core AI features (interpretation → candidate findings, summaries for reports).

**Minimum expected output (summary):** a Settings page backend + UI spec that lets an admin paste an OpenRouter key and get
a working "test connection"; a redaction module with tests; an interpreter that converts M1's raw results into
`ai_candidate` findings via M4's findings API; a summarizer whose output M4's report template renders.

**Idea slots (yours to fill or ignore):** prompt-evaluation harness for comparing models, an attack-surface
narrative generator, smarter prompt caching to cut token cost, extra AI features from the brief's list
(recommending next tests), or your own.

| Task | Build | Expected output / acceptance |
|---|---|---|
| **T2.0 Contract** | Settings API shapes (`GET/PUT /api/settings/llm`, `POST /api/settings/llm/test`), interpretation input/output JSON schema, redaction spec | Signed off in Wave 1; schemas committed |
| **T2.1 Provider client** | `backend/app/ai/client.py`: OpenAI-compatible chat client, base_url + Fernet-decrypted key from DB, per-task model/temperature, timeouts + 1 retry, `reasoning_content` handling, Ollama fallback profile | Unit test with a mock server; real call against OpenRouter once a key exists |
| **T2.2 Settings backend** | `api/settings_llm.py`: provider CRUD (key write-only, never returned), per-task config, test-connection endpoint | Response bodies never contain keys (test asserts); test-connection reports model + latency |
| **T2.3 Redaction** | `ai/redaction.py`: pattern scrub (passwords, tokens, Authorization/Cookie headers, private keys, .env contents) + per-target deny-list terms; applied to everything before any LLM call | Table-driven pytest with adversarial fixtures proves secrets never survive into a prompt |
| **T2.4 Interpreter** | `ai/interpret.py`: raw tool results → candidate findings via M4's create endpoint (status `ai_candidate`), JSON-schema-constrained output with validate-retry, confidence score, called by M1 as post-scan hook | Given a fixture of ZAP alerts + prober results, produces ≥ 3 valid findings; malformed LLM output is repaired or dropped, never crashes the pipeline |
| **T2.5 Summarizer** | `ai/summarize.py`: executive summary + per-finding explanation/remediation from **verified** findings, consumed by M4's report template | Generated summary renders in the report HTML; reasoning-tier model used when configured |
| **T2.6 Stretch** | Prioritization endpoint; per-finding Q&A grounded in that finding's evidence only | Demo-grade; clearly marked stretch if time runs out |

**Depends on:** M1 raw-results shape (T1.0 contract, not the finished runners). **Feeds:** M4 T4.4 (summary text), M3 T3.3 (settings page).

---

## M3 — Frontend

**Mission:** every page real: assessment wizard with live progress, findings verification workflow, settings,
dashboard on live data — all in both themes, with loading/empty/error states.

**Minimum expected output (summary):** the four placeholder pages become working features wired to frozen contracts (built
against local mocks first, then integrated in Wave 3); dashboard reflects real data; all rubric-visible UX
(skeletons, empty states, HelpHints, severity colors) present.

**Idea slots (yours to fill or ignore):** keyboard-driven navigation, an assessment timeline visualization,
toast notifications for finished scans, a findings "investigation" view, demo-friendly UI touches — anything
that makes the app feel sharp, within the shadcn design system.

| Task | Build | Expected output / acceptance |
|---|---|---|
| **T3.0 Contract** | Freeze `src/lib/types.ts` to match Wave-1 API sketches; document component conventions (shadcn usage, HelpHint, state patterns) in a short `frontend/CONVENTIONS.md` | Teammates sign off; mocks for all four pages committed (`src/mocks/`) |
| **T3.1 Assessments page** | Wizard (target select, intensity ≤ target gate, category checkboxes) → run view with per-job progress cards, live SSE log viewer, cancel button | Works against mock in Wave 2; against live backend in I1; refresh mid-run shows persisted state |
| **T3.2 Findings page** | Table with severity/status/category filters, detail drawer with evidence tabs, verify / false-positive / needs-evidence actions with notes, `ai_candidate` rows visually marked | Works against mock; in I2 performs real verification; viewers get read-only UI (403 handled) |
| **T3.3 Settings page** | Provider list + add/edit dialog (key field write-only), per-task model dropdowns, "Test connection" button with result state | Works against mock; in I3 against live settings API |
| **T3.4 Dashboard live data** | Replace placeholder zeros: targets/assessments/findings stats from APIs, severity chart in semantic colors, recent assessments list | Shows real counts after I2; empty states still correct pre-data |
| **T3.5 Report trigger UI** | "Generate report" button on assessment detail + download link (M4's endpoint); report preview placeholder while generating | Wired in I3; download produces the M4 PDF |

**Depends on:** all Wave-1 contracts (T1.0, T2.0, T4.0). **Feeds:** everyone's demo.

---

## M4 — Findings, verification & reports

**Mission:** the verification backbone and the graded deliverable generator: findings API with the enforced state
machine, evidence capture, severity model, and the PDF report.

**Minimum expected output (summary):** findings endpoints where only assessors/admins can change status (server-enforced),
evidence auto-captured from M1 jobs plus manual uploads, OWASP Risk Rating mapping, and a one-click PDF report
containing findings, evidence, risks, recommendations, and M2's summaries.

**Idea slots (yours to fill or ignore):** CVSS vector scoring alongside the 4-tier scale, finding de-duplication
across re-scans, assessment-over-assessment diffs, customizable report templates, findings export formats.

| Task | Build | Expected output / acceptance |
|---|---|---|
| **T4.0 Contract** | Findings API shapes (list/filter, detail, `PATCH` status/severity/notes), evidence endpoints (attach, upload), report endpoints (`POST /api/assessments/{id}/report`, download) | Signed off in Wave 1 |
| **T4.1 Findings API** | `api/findings.py` + service layer: state machine transitions enforced server-side (`ai_candidate → verified / false_positive / needs_evidence`), `verified_by/at` from JWT, role checks (viewer = 403 on mutation) | pytest: illegal transitions rejected; viewer mutation → 403; every verified finding has an attributing user |
| **T4.2 Evidence** | Auto-capture adapters (HTTP transcript + tool snippet from M1 job outputs), manual upload endpoint (multipart, 5 MB cap, stored under `backend/evidence/`), evidence list/serve endpoints | A verified finding in the demo carries ≥ 1 auto + optionally 1 manual evidence item; uploaded files are not executable from the app origin |
| **T4.3 Severity model** | 4-tier + 0–10 score helper, OWASP Risk Rating mapping function + short methodology note (feeds the "framework references" rubric line) | Mapping documented in `docs/risk-methodology.md` and unit-tested |
| **T4.4 Report generation** | `api/reports.py` + `reports/template.html` (Jinja2): cover, methodology, scope, findings by severity with evidence excerpts, risk table, recommendations, M2 summary; Playwright print-to-PDF | One click produces a 6+ page PDF for the Juice Shop assessment; charts embedded; generation is a job so it can't block the API |
| **T4.5 Auth hardening** | Role-check audit across all endpoints, "change own password" endpoint, real team accounts seeded, login rate-limit note | Checklist doc with every endpoint × allowed roles; password change tested |
| **T4.6 Stretch** | Findings export CSV/JSON | Optional |

**Depends on:** M1 job outputs for auto-evidence (contract only), M2 summaries (contract only). **Feeds:** M3 T3.2/T3.5, final report deliverable.

---

## M5 — Docs, QA, deployment (integration steward)

**Mission:** the deliverables engine and the person who keeps main green: proposal, system design docs, environment
setup, evidence pack, and the final report/presentation assembly.

**Minimum expected output (summary):** proposal + system design docs submitted on time, every dev machine able to run the
full stack via a setup script, an evidence pack that maps 1:1 to rubric lines, and the final report + presentation
skeleton built from the platform's own generated report.

**Idea slots (yours to fill or ignore):** GitHub Actions CI to enforce "main stays green", automated screenshot
capture for the evidence pack, a demo video, a risk-matrix visualization for the presentation.

| Task | Build | Expected output / acceptance |
|---|---|---|
| **T5.0 Proposal** (starts immediately, milestone 1) | `docs/proposal.md`: background, objectives, scope, features, technologies | Submitted/accepted by instructor; content lifted from PLAN.md, not re-invented |
| **T5.1 Environment setup** | `scripts/setup-dev.ps1`: install + verify Nmap, OWASP ZAP (daemon start script with API key), Playwright Chromium, venv, npm install; fills PLAN.md §11 checklist | A teammate's machine goes from zero to running stack following only the script + README |
| **T5.2 System design doc** (milestone 2) | `docs/system-design.md`: architecture diagram, ERD, workflow diagram, module descriptions | Diagrams match the actual code (checked against Wave-1 contracts) |
| **T5.3 QA + evidence pack** | `docs/qa-checklist.md` + `docs/evidence/`: scripted demo run on Juice Shop with screenshots at each pipeline stage, AI outputs captured, verified findings exported | Every rubric line (A4, B1–B7) has ≥ 1 evidence artifact behind a checklist entry |
| **T5.4 Stewardship** | Merge shared-file one-liners (routers, routes, model imports), keep main green, run wave integration checks (I1–I4 below), maintain `docs/INTEGRATION_LOG.md` | No broken main across the project; every integration wave has a logged pass/fail |
| **T5.5 Final report + presentation** (milestone 7) | `docs/final-report.md` (built from M4's generated PDF + methodology) and presentation skeleton with per-member contribution sections | Complete draft exists before Wave 4 exit; each member's section reviewed by that member |

---

## Integration waves (strictly sequential — this is what prevents breakage)

| Order | Integration | Participants | Pass condition |
|---|---|---|---|
| **I1** | Assessments live | M1 + M3 | Create assessment in UI → pipeline runs → SSE progress + logs visible → cancel works |
| **I2** | Findings + verification | M1 + M4 + M3 | Orchestrator emits candidates → findings page lists them marked `ai_candidate` → assessor verifies one with evidence → status persists |
| **I3** | AI wiring | M2 + M1 + M4 + M3 | Post-scan interpretation produces candidates automatically (redaction on); settings page configures a real key; report includes AI summary + verified findings |
| **I4** | Full rehearsal | All + M5 | The brief's 8-step demo: scope → recon → scan → assessment → AI analysis → human verification → risk → PDF report, executed live from a clean shell |

If an integration step fails, it blocks the next one — fix, re-run, log. No member merges feature work into main
during I1–I4 without the steward.

---

## Wave-1 contract sketches (to be signed off, then frozen)

Authoritative endpoints M1/M2/M4 implement and M3 builds against. Exact field-level shapes land in
`app/schemas/` during T1.0/T2.0/T4.0 and are mirrored into `src/lib/types.ts`.

```
# Assessments (M1)
POST   /api/assessments                      {target_id, intensity ≤ target gate, categories[]} → AssessmentOut
GET    /api/assessments                      → AssessmentOut[]
GET    /api/assessments/{id}                 → AssessmentOut + jobs[]
GET    /api/assessments/{id}/events          → SSE: {job_id, status, progress, log_line}
POST   /api/assessments/{id}/cancel          → 202

# LLM settings (M2)
GET    /api/settings/llm                     → providers[{id, name, base_url, enabled, has_api_key}], task_configs[]
PUT    /api/settings/llm/providers/{id}      {name?, base_url?, api_key?, enabled?} (key write-only)
POST   /api/settings/llm/test                {provider_id} → {ok, model, latency_ms, error?}

# Findings / evidence / reports (M4)
GET    /api/findings?assessment_id&status&severity&category   → FindingOut[]
PATCH  /api/findings/{id}                    {status?, severity?, score?, assessor_notes?} → FindingOut
POST   /api/findings/{id}/evidence           multipart upload → EvidenceOut
POST   /api/assessments/{id}/report          → 202 (report job) ; GET /api/reports/{id} → PDF stream
```

Error convention: FastAPI `detail` strings; 403 for role violations; 409 for illegal transitions and intensity-gate
violations. All list endpoints require auth; role rules per M4 T4.5 checklist.

---

## Timeline (one-week sprint)

| Day | Waves | Course milestone | Key outputs |
|---|---|---|---|
| **Day 1 morning** | Wave 1 | 1 Proposal, 2 System design | 30-minute contract sign-off call; M5.0 proposal drafted (AI-assisted) and submitted; M5.1 environment setup script running |
| **Day 1 afternoon – Day 4** | Wave 2 | 3 Initial development, 4 Security integration | M1 runners + orchestrator; M4 findings API; M2 client + redaction; M3 pages on mocks — daily 15-min sync, everything pushed the day it's built |
| **Day 5** | Wave 3 | 5 AI integration, 6 Finalization | I1 assessments live → I2 verification works → I3 AI wired. Strictly sequential, fix-forward: a failing step blocks the next |
| **Day 6** | I4 + Wave 4 | 6 Finalization | Full 8-step rehearsal on Juice Shop; evidence pack captured during the rehearsal; dashboard on live data |
| **Day 7** | Wave 4 | 7 Final presentation | Final report + presentation assembled from the platform's own generated report; dry run; buffer for whatever Day 6 found |

**Cut line (decided at the Day-3 sync, applied without ceremony).** Defer in this order:

1. All stretch tasks (T2.6, T4.6) and every idea-slot item
2. Session-management category (already marked stretch in PLAN.md)
3. T3.5 report trigger UI → minimum viable version on Day 6
4. Anything else not required by the brief

The line we do not cross: the brief's minimums — 3 assessment categories, 2 AI features, 2 tools, a working
verification flow, dashboard, and report. Everything in this plan beyond that exists to be cut.

---

## Adopted changes (idea log)

Every accepted proposal lands here and becomes part of the plan. Rejected proposals get a one-line reason so
nobody re-litigates the same idea blindly.

| Date | Proposal (link to `docs/proposals/…`) | By | Decision | Impact on plan/contracts |
|---|---|---|---|---|
| *—* | *none yet — the table starts empty on purpose* | | | |
