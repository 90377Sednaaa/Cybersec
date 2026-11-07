# Project Plan — AI-Assisted Security Assessment & Vulnerability Analysis Platform

> Status: **Confirmed 2026-11-07** via grilling session. This is the canonical decision record.
> Course brief: final project — combine existing security tools with AI to assess an *authorized* web application, human assessor confirms every finding.

## 1. Confirmed stack

| Layer | Decision |
|---|---|
| Backend | Python 3.13 + FastAPI + SQLAlchemy 2.0 + Pydantic v2 |
| Database | SQLite (via SQLAlchemy ORM; Postgres is a config swap if ever required) |
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui + TanStack Query + Recharts + react-router + lucide-react |
| Scan execution | In-process async worker; jobs persisted in DB; SSE live progress (Celery explicitly cut) |
| Auth | JWT, 3 roles (admin / assessor / viewer), admin-seeded accounts, no public signup |
| Reports | Server-rendered HTML template → PDF via Playwright headless Chromium |
| Deployment | Native Windows demo (uvicorn + built frontend); docker-compose only as final stretch |
| LLM | Provider-agnostic OpenAI-compatible client; **OpenRouter primary**, Ollama offline fallback; secrets encrypted at rest |

## 2. Targets & scope management (brief feature 01)

- **Target A:** OWASP Juice Shop — run locally via npm; carries the vulnerability demonstrations.
- **Target B:** team's own production website — authorized because owned; demonstrates recon, config/HTTPS checks, and the scope story.
- Target registry fields: name, URL, authorization reference, **allowed scan intensity** (`passive_safe` vs `full_intrusive`), in-scope assets, out-of-scope assets.
- Intrusive tools (ZAP active scan, wordlist probing) **refuse** to run against targets whose authorization/intensity doesn't permit it — enforced in the orchestrator, not just the UI.

## 3. Integrated tools (brief feature 02 — 4 sources, minimum was 2)

1. **Nmap** — ports/services/OS; XML output parsed into our model.
2. **OWASP ZAP** — daemon mode (REST API): spider (endpoint discovery) + active scan + alerts.
3. **Built-in HTTP prober** (our own engine) — security headers, TLS config, cookie flags, tech fingerprinting, wordlist-based directory/file probing, reflection checks.
4. **DNS recon** — dnspython (A/AAAA/MX/TXT, basic subdomain enumeration).
- Stretch: **Nuclei** (single .exe, JSON output).

## 4. Assessment categories (brief feature 03 — 5 committed, minimum 3)

1. Input validation & injection — ZAP active scan + prober reflection checks.
2. Security configuration & HTTPS — prober.
3. Exposed files & directories — ZAP spider + prober wordlists.
4. Information disclosure — classification rules over prober/ZAP outputs (near-free).
5. Session management — *(stretch)* cookie flags, session token behavior.

Not committed: business logic (needs hand-scripted tests), authentication/access control (partial ZAP coverage only).

## 5. AI integration (brief feature 04 — 2 mandatory + 2 stretch, minimum 2)

**Mandatory:**
1. **Scan-result interpretation** — LLM converts raw tool output into structured candidate findings (JSON-schema-constrained output: title, description, category, severity suggestion, evidence refs, remediation draft).
2. **Assessment summaries** — executive summary + per-finding explanation/remediation generated from verified findings, rendered into the PDF report.

**Stretch:** 3. Risk prioritization (severity × exploitability ordering, reasoning model). 4. Per-finding "ask the analyst" panel (grounded in that finding's evidence — not a general chatbot).

**LLM plumbing:**
- Settings UI stores base_url + API key per provider (encrypted at rest), with a test-connection button.
- Per-task model config, editable without code changes. Defaults on OpenRouter: `deepseek-chat` tier (fast, temp ≈ 0.2) for interpretation; `deepseek-r1` / GLM-thinking tier (reasoning, `reasoning_content` handled) for risk analysis & summaries.
- JSON-schema-constrained outputs with validate-and-retry repair loop.
- **Redaction layer**: regex scrub of common secret patterns + per-target deny-list strings applied to everything before it is sent to any LLM (brief's hard ethical rule: never expose credentials/confidential info to public AI services).

## 6. Findings verification & risk assessment (brief feature 05)

- State machine: `ai_candidate` → `verified` / `false_positive` / `needs_evidence`. Unverified findings are visually marked and never count as confirmed.
- Severity: Critical / High / Medium / Low + numeric score; documented against OWASP Risk Rating (feeds the "security methodology and framework references" rubric line).
- Evidence per finding: **auto-captured** (raw tool output snippet, HTTP request/response transcript, timestamps, tool+version) **+ manual upload** (files/screenshots) during verification.
- Verification attributable to the logged-in assessor (who/when audit trail).

## 7. Orchestration, dashboard & reports (brief feature 06)

- **Assessment wizard:** pick target + intensity + categories → orchestrated pipeline: recon (nmap+DNS) → discovery (spider) → active/probe scans → normalization → AI interpretation → candidate findings. Live SSE progress per job.
- Manual per-tool triggers available for debugging and re-running single phases.
- Dashboard: assessments overview, findings by severity (Recharts), verification pipeline status.
- Report: HTML template (findings, evidence, risks, recommendations, methodology) → Playwright PDF.

## 8. Team — 5 vertical modules (one per member, orally defensible)

| Module | Scope |
|---|---|
| M1 Scan engine | Nmap/ZAP/prober/DNS wrappers, orchestrator state machine, SSE |
| M2 AI pipeline | LLM client, provider settings, prompts, redaction, structured outputs |
| M3 Frontend | Dashboard, findings UI, wizard, charts, shadcn design system |
| M4 Findings & reports | Verification workflow, evidence, severity, PDF reports, auth |
| M5 Docs/QA/deploy | Proposal, system docs, test evidence, Juice Shop logistics, final report |

## 9. Data model (main tables)

`users` (role) · `targets` (authorization, intensity, scope lists) · `assessments` (target, intensity, categories, status) · `jobs` (tool, status, progress, log) · `raw_results` (tool, format, content) · `findings` (category, severity, score, status, remediation, verified_by/at, notes) · `evidence` (kind: http_transcript | tool_output | upload) · `llm_providers` + `llm_task_config` · `ai_outputs` (model, content — doubles as the "AI outputs" evidence deliverable).

## 10. Milestone mapping (weekly cadence until real dates are known)

1. **Proposal** — week 1
2. **System design** — weeks 1–2 (architecture diagram, ERD, workflow)
3. **Initial development** — weeks 2–4 (scaffold, auth, targets CRUD, base UI)
4. **Security integration** — weeks 4–6 (tools, orchestrator, categories)
5. **AI integration** — weeks 6–7
6. **Finalization** — weeks 7–8 (verification polish, dashboard, PDF)
7. **Final presentation** — week 8+ (evidence collected continuously from week 4)

## 11. Environment setup checklist (Windows, native)

- [ ] Install Nmap (Windows installer; verify `nmap --version` on PATH)
- [ ] Install OWASP ZAP; run daemon: `zap.bat -cmd -daemon -port 8080 -config api.key=<secret>`
- [ ] Juice Shop: clone → `npm install` → `npm start` (port 3000)
- [ ] Python 3.13 venv + `pip install fastapi uvicorn sqlalchemy pydantic-settings httpx dnspython python-multipart`
- [ ] Playwright + Chromium for PDF rendering
- [ ] OpenRouter API key (+ optional local Ollama for offline demo)

## 12. Explicitly out of scope (defined cuts / stretch adds)

Business-logic & access-control as core categories · Celery/Redis · PostgreSQL · cloud deployment · DOCX export · automated screenshots · Nuclei.

## 13. Build order (MVP sequence)

1. Repo scaffold (FastAPI + Vite + shadcn), DB models, JWT auth
2. Target registry + authorization + intensity gate
3. Prober + Nmap wrapper + jobs/SSE
4. ZAP integration + orchestrator pipeline
5. Findings model + verification workflow
6. AI pipeline (client → settings UI → interpretation → summaries)
7. Dashboard + PDF report
8. Stretches in the order: session mgmt category → prioritization → Q&A panel → Nuclei → compose
