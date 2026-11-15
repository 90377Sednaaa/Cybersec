# Project Proposal - Aletheia

**AI-Assisted Security Assessment & Vulnerability Analysis Platform**

| Field | Value |
|---|---|
| Deliverable | Course milestone 1 (Proposal), M5 task **T5.0** |
| Status | **Draft for instructor submission**, assembled 2026-11-15 |
| Source of truth | `docs/PLAN.md` (decision record confirmed 2026-11-07), `docs/TASK_PLAN.md` |
| Owner | M5 - documentation, QA, deployment (integration steward) |
| Before submitting | Add course code, instructor name, team member names and student IDs, submission date; paste the official rubric wording where referenced |

> This is deliberately not a new design. Every technical claim below is lifted from the confirmed decision
> record `PLAN.md` and was cross-checked against the shipped code on the M5 branch. The only parts still
> needing human input are the administrative header, the sign-off, and the official wording of the rubric
> lines (the course brief itself is not stored in this repository).

---

## 1. Background

A web application security assessment produces a large volume of raw output: port and service inventories,
spider results, HTTP header and TLS observations, and scanner alerts. Turning that output into a defensible
report is skilled, slow work. Two shortcuts are common and both are unsatisfactory:

- **Tools alone.** Scanners emit many candidate issues with little context, including false positives. An
  assessor still has to read, reproduce, and classify every one.
- **AI alone.** A large language model is good at summarizing and structuring unstructured output, but it can
  hallucinate a vulnerability, invent evidence, or leak confidential data to a third-party service. In a
  security assessment a fabricated finding is worse than a missed one.

Aletheia takes the middle path: **tools do the scanning, AI does the reading, humans do the confirming.**
The platform orchestrates established security tools, uses an LLM to interpret and summarize their output,
and enforces that no finding counts as confirmed until a logged-in human assessor verifies it.

## 2. Problem statement

Build a platform that combines existing security tools with AI to assess an **authorized** web application,
produce a risk-rated report, and keep a human assessor in charge of every confirmed finding. The course brief
asks for scope management, integrated tools, assessment categories, AI features, findings verification with
risk assessment, and orchestration with a dashboard and reports. `PLAN.md` §§2-7 records the team's confirmed
answer to each of those six feature areas.

## 3. Objectives

| ID | Objective | Acceptance signal |
|---|---|---|
| O1 | Register only authorized targets, with an authorization reference, in/out-of-scope assets, and an allowed scan intensity | Target create requires `authorization_ref` and an absolute http(s) `base_url`; a request above the allowed intensity returns **409** server-side |
| O2 | Orchestrate at least two security tools into one assessment run with live progress | `dns -> nmap -> prober (-> zap at full intensity) -> normalize -> AI`, with per-job state persisted and SSE progress in the UI |
| O3 | Apply AI to real assessment work, not decoration | Two mandatory features: scan-result interpretation into structured candidate findings, and assessment summaries rendered into the PDF report |
| O4 | Keep the human in the loop | Every generated finding starts as `ai_candidate`; only an assessor/admin PATCH can move it to `verified`, `false_positive` or `needs_evidence`, with an attributable audit trail |
| O5 | Produce a defensible, framework-referenced report | PDF with cover, methodology, scope, findings by severity, evidence excerpts, OWASP Risk Rating table, recommendations and AI summary |
| O6 | Make the pipeline observable and repeatable | Dashboard on live data, persisted jobs that survive a page refresh, reproducible one-script environment setup, and an evidence pack mapped to rubric lines |

Non-functional objectives: secrets encrypted at rest and redacted before any LLM call; role-based access
control (admin / assessor / viewer); both light and dark UI themes; `main` always builds.

## 4. Scope

### 4.1 In scope

- **Targets:** OWASP Juice Shop running locally (vulnerability demonstrations) and the team's own production
  website (owned, therefore authorized). Only registered targets can be scanned.
- **Tools (4, brief minimum 2):** Nmap, OWASP ZAP in daemon mode, a custom HTTP prober, DNS recon via
  dnspython. Nuclei is an explicit stretch add.
- **Categories (5 committed, brief minimum 3):** input validation & injection; security configuration &
  HTTPS; exposed files & directories; information disclosure; session management (stretch).
- **AI (2 mandatory, brief minimum 2):** interpretation and summarization. Stretch: risk prioritization and
  per-finding grounded Q&A.
- **Verification and risk:** state machine, evidence capture (automatic + manual upload), severity tiers
  plus a 0-10 score mapped to the OWASP Risk Rating Methodology.
- **Delivery:** assessment wizard, SSE live log, dashboard, PDF report generation, three roles, and the
  documentation/QA/deployment deliverables owned by M5.

### 4.2 Out of scope (`PLAN.md` §12)

Business-logic and access-control as core categories; Celery/Redis; PostgreSQL; cloud deployment; DOCX
export; automated screenshot capture; Nuclei. Session management is stretch, not committed.

### 4.3 Authorization and ethics boundary

Intrusive behaviour (ZAP active scan, wordlist probing) is gated by the target's `allowed_intensity` and is
re-checked in the orchestrator at scheduling time, not only in the UI. `full_intrusive` escalation is
admin-only. Hosts are validated by `scanner/hostguard.py`, including every redirect hop, against an SSRF
policy. No endpoint exists that scans an unregistered host.

## 5. Proposed system

```
Define Scope -> Reconnaissance -> Scanning -> Security Assessment -> AI Analysis
             -> Findings Verification (human) -> Risk Assessment -> Report Generation
```

An assessor registers a target and starts an assessment. The in-process async worker runs the tool pipeline,
stores each job's raw output, and streams progress over SSE. The normalizer converts deterministic signals
(missing headers, exposed files) into `ai_candidate` findings; the AI interpreter adds non-deterministic ones.
Both sources are unverified by construction. The assessor reviews the findings page, attaches or inspects
evidence, and sets a status and severity. The report renderer then builds an HTML template from **verified**
findings and prints it to PDF with headless Chromium.

The invariant that governs the whole design: **`verified` is unreachable without an authenticated human.**
The normalizer and the LLM can only ever create candidates.

## 6. Features mapped to the brief

| Brief feature (`PLAN.md` §) | Confirmed answer | Where it lives in the shipped code |
|---|---|---|
| 01 Targets & scope (§2) | Registry with authorization ref, intensity, scope lists; server-side intensity gate | `app/models/target.py`, `app/api/targets.py`, `app/scanner/hostguard.py` |
| 02 Integrated tools (§3) | Nmap, ZAP, custom HTTP prober, DNS | `app/scanner/{nmap_runner,zap_runner,prober,dns_runner}.py`, `registry.py` |
| 03 Assessment categories (§4) | Five committed categories | `app/schemas/assessment.py` (`KNOWN_CATEGORIES`), `scanner/normalize.py` |
| 04 AI integration (§5) | Interpretation + summaries, encrypted keys, redaction, per-task models | `app/ai/{client,redaction,interpret,summarize,catalog}.py`, `app/api/settings_llm.py` |
| 05 Verification & risk (§6) | State machine, evidence, OWASP-based severity | `app/api/findings.py`, `app/api/evidence.py`, `app/risk.py`, `docs/risk-methodology.md` |
| 06 Orchestration & reports (§7) | Wizard, SSE, dashboard, PDF | `app/scanner/orchestrator.py`, `app/api/reports.py`, `app/reporting.py`, `frontend/src/pages/**` |

## 7. Technology stack and rationale

| Layer | Choice | Why |
|---|---|---|
| Backend | Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2.0 | Async IO for concurrent tool wrappers, automatic OpenAPI docs, typed request/response contracts at the API boundary |
| Database | SQLite through the ORM | Zero-setup native Windows demo; Postgres is a config swap, not a redesign |
| Scan execution | In-process async worker + SSE | Keeps the deployment to two processes; Celery/Redis explicitly cut in `PLAN.md` §1 |
| Frontend | React 19, Vite, TypeScript, Tailwind v4, shadcn/ui, TanStack Query, Recharts, react-router | Typed contracts mirrored from the backend, accessible component primitives, live-data charts |
| Auth | JWT (PyJWT) + bcrypt, three roles | Stateless API auth; viewer is read-only by design |
| LLM | Provider-agnostic OpenAI-compatible client, OpenRouter primary, Ollama offline fallback | Avoids vendor lock-in; a local fallback keeps the demo runnable without a paid key |
| Secrets | Fernet-encrypted provider keys, write-only API responses | A key is never returned by any endpoint and is never logged |
| Reports | Jinja2 HTML -> Playwright headless Chromium PDF | Full control over pagination and styling without a commercial renderer |
| Runtime | Native Windows development | Matches the team's machines; docker-compose is only a stretch goal |

The full confirmed stack is `PLAN.md` §1; this table is a summary, not a competing decision.

## 8. Methodology and framework references

- **OWASP Risk Rating Methodology** for likelihood x impact -> severity, and the 0-10 score bands;
  documented and unit-tested in `docs/risk-methodology.md` and `backend/app/risk.py`.
- **OWASP Top 10** for finding category language; **OWASP Cheat Sheet Series** for remediation text.
- The workflow itself follows the brief's eight steps, which is the assessment methodology presented in the
  final report and the demo.

These references are called out explicitly because "security methodology and framework references" is a
graded line: the report includes the methodology note, and the rubric evidence pack links it to an artifact.

## 9. Team and work breakdown

Five vertical modules, one per member, so every member can defend a coherent slice in the oral exam
(`PLAN.md` §8, `TASK_PLAN.md` §8).

| Module | Mission | Principal deliverables |
|---|---|---|
| M1 Scan engine | Make "Run assessment" a live, safe pipeline | Runner interface/registry, four tool wrappers, orchestrator, SSE, intensity gate |
| M2 AI pipeline | Add trustworthy AI analysis | Provider client, encrypted settings, redaction, interpreter, summarizer, audit rows |
| M3 Frontend | Make every page real | Wizard and live scan view, findings verification UI, settings, dashboard |
| M4 Findings & reports | Verification backbone and graded deliverable | State machine, evidence, severity model, PDF reports, auth hardening |
| M5 Docs/QA/deploy | Keep `main` green and assemble deliverables | This proposal, system design, setup script, QA/evidence pack, integration log, final report and presentation |

Per-member contribution evidence lives in `docs/member-logs/` and is assembled in `docs/final-report.md`.

## 10. Milestones and deliverables

`PLAN.md` §10 maps the seven course milestones. Grading context: Documentation 30, Implementation 50,
Individual & Oral Defense 20.

| # | Course milestone | Concrete deliverable |
|---|---|---|
| 1 | Proposal | `docs/proposal.md` (this document) |
| 2 | System design | `docs/system-design.md`: architecture, ERD, workflow, module descriptions |
| 3 | Initial development | Scaffold, auth, target CRUD, base UI (build steps 1-2 of `README.md`) |
| 4 | Security integration | Tools, orchestrator, categories (build steps 3-4) |
| 5 | AI integration | Client, settings, interpretation, summaries (build step 6) |
| 6 | Finalization | Verification polish, dashboard, PDF, QA checklist, evidence pack (`docs/qa-checklist.md`) |
| 7 | Final presentation | `docs/final-report.md`, `docs/presentation-skeleton.md`, rehearsal log |

## 11. Evaluation and acceptance criteria

- **Build:** `npm run build` passes with 0 errors; backend boots on port 8000 and `/health` returns 200.
- **Tests:** `pytest tests -q` passes; the current baseline is 268 tests (see `AGENTS.md`).
- **Hard-rule tests:** passive-safe target never schedules intrusive tools; viewer mutation returns 403;
  illegal finding transitions return 409; secrets never appear in an API response or LLM prompt.
- **Live demo:** the eight-step pipeline runs end to end on Juice Shop, with screenshots at each stage
  (`docs/qa-checklist.md`, `docs/evidence/`).
- **Documentation:** every rubric line has at least one linked evidence artifact; each member's log and
  contribution section is reviewed by that member.

## 12. Ethics, safety and legal constraints

1. **Authorized targets only.** Only registered targets can be scanned; no free-form URL endpoint exists.
2. **Intensity is enforced server-side.** A disabled button is not a security control; the orchestrator
   re-checks the target's allowed intensity before scheduling.
3. **Human verification.** AI output is a candidate, never a confirmed finding.
4. **Secret hygiene.** Provider keys are encrypted at rest, write-only over the API, excluded from logs, and
   redacted before any content leaves the process for an LLM provider.
5. **No live third-party targets in the demo.** The demonstration uses a local Juice Shop instance and the
   team's own site.

## 13. Known limitations and risks (stated up front)

Recorded so the examiners hear them from the team first. Full detail in `AGENTS.md` and
`docs/system-design.md` §8.

- The app is not yet workable end to end on a clean machine until Nmap, the ZAP daemon and Playwright
  Chromium are installed (M5 T5.1). The runners fail soft with actionable log lines until then.
- AI interpretation needs a real provider key; without one, scans complete on the rule-based normalizer and
  skip AI cleanly.
- SQLite foreign keys are declared but not enforced, so target deletion can orphan dependent rows; the UI
  deliberately does not offer target deletion.
- Single-process worker: a server restart kills an in-flight run; jobs are persisted so the UI survives a
  page refresh, but not a backend restart.
- No frontend automated test harness yet; UI verification is by build, lint and manual browser passes.
- No login rate limiting; accepted for a single-machine university demo.

## 14. References

- `docs/PLAN.md` - confirmed decisions and stack (canonical record)
- `docs/TASK_PLAN.md` - per-member tasks, ownership, waves, contracts
- `docs/system-design.md` - architecture, ERD, workflow
- `docs/risk-methodology.md` - OWASP Risk Rating mapping
- `docs/auth-checklist.md`, `docs/fix-plan.md` - security audit and hardening record
- OWASP Risk Rating Methodology - https://owasp.org/www-community/OWASP_Risk_Rating_Methodology
- OWASP Top 10 - https://owasp.org/www-project-top-ten/
- OWASP Juice Shop - https://owasp.org/www-project-juice-shop/
