<div align="center">

<img src="frontend/src/assets/aletheia-logo.png" alt="Aletheia logo" width="120" />

# Aletheia

**AI-Assisted Security Assessment & Vulnerability Analysis Platform**

Combine battle-tested security tools with AI analysis, while a human assessor stays in charge
of what counts as a confirmed vulnerability.

![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.116-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-latest-000000?logo=shadcnui&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-embedded-003B57?logo=sqlite&logoColor=white)

</div>

## What it does

Aletheia walks an authorized web application through a complete assessment pipeline:

**Define Scope → Reconnaissance → Scanning → Security Assessment → AI Analysis → Findings Verification (human) → Risk Assessment → Report Generation**

- **Tools do the scanning.** Nmap, OWASP ZAP, a custom HTTP prober, and DNS utilities feed structured results into the platform.
- **AI does the reading.** An LLM turns raw scan output into structured candidate findings, prioritizes risk, and drafts summaries.
- **Humans do the confirming.** Nothing counts as a vulnerability until an assessor verifies it - every AI-generated finding stays marked as a candidate until then.

> The canonical plan and decision record is **[docs/PLAN.md](docs/PLAN.md)** - read that before changing architecture.

## Tech stack

| Layer | Technologies |
|---|---|
| **Backend** | Python 3.13, FastAPI, SQLAlchemy 2.0, Pydantic v2, SQLite, PyJWT + bcrypt, Server-Sent Events |
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query, Recharts, react-router |
| **Security tools** | Nmap (ports/services), OWASP ZAP (spider + active scan), custom HTTP prober (headers, TLS, cookies, directories), dnspython (DNS recon) |
| **AI / LLM** | Provider-agnostic OpenAI-compatible client; OpenRouter primary (DeepSeek, GLM, ...), Ollama offline fallback; per-task model config; secret-redaction layer |
| **Reports** | Server-rendered HTML → PDF via Playwright headless Chromium |
| **Runtime** | Native Windows development, SQLite storage; docker-compose only as a final stretch goal |

### AI-powered functionality

| Feature | Status |
|---|---|
| Scan-result interpretation into structured findings (JSON-schema constrained) | Core |
| Executive summary + per-finding explanation and remediation for reports | Core |
| Risk prioritization across findings (reasoning model) | Stretch |
| Per-finding "ask the analyst" Q&A, grounded in evidence | Stretch |

### Assessment coverage

Five categories committed (brief requires three): input validation & injection, security configuration & HTTPS,
exposed files & directories, information disclosure, session management *(stretch)*.

## Repository layout

```
backend/   FastAPI + SQLAlchemy 2.0 + SQLite (JWT auth, targets, assessments, findings, evidence, LLM config)
frontend/  React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui (TanStack Query, Recharts, react-router)
docs/      PLAN.md (decisions), TASK_PLAN.md, proposal.md, system-design.md, qa-checklist.md,
           INTEGRATION_LOG.md, final-report.md, presentation-skeleton.md, evidence/, member-logs/
scripts/   setup-dev.ps1 (Windows environment setup, PLAN.md section 11)
```

## Prerequisites

Aletheia runs **natively on Windows**. Docker, WSL and Celery/Redis are not used in development. The setup
script installs or verifies everything below; the table is the manual checklist from `PLAN.md` §11.

### Software you must install

| Requirement | Version / install | Why it is needed |
|---|---|---|
| Windows 10/11 + Windows PowerShell 5.1 | built in | `scripts/setup-dev.ps1` is a Windows script |
| Python | **3.13** (tested on 3.13.x) | FastAPI backend, SQLAlchemy, Playwright driver |
| Node.js + npm | **Node 22+ / npm 10+** (tested on 22.22.2 / 10.9.7) | Vite frontend and the Juice Shop demo target |
| Git | any recent release | cloning the repo and Juice Shop |
| winget (App Installer) | optional but recommended | lets the setup script install Nmap and ZAP automatically; otherwise use the manual installers |
| **Nmap** | 7.80+, `winget install --id Insecure.Nmap -e` | the `nmap` job. It must be on `PATH`; without it the job fails with `nmap executable not found on PATH` while the rest of the assessment still completes |
| **OWASP ZAP + Java 17** | ZAP 2.17.0, `winget install --id ZAP.ZAP -e` (pulls Temurin JRE 17) | spider and active scan. Needed **only** for `full_intrusive` targets; passive runs do not schedule it |
| **Playwright Chromium** | `backend\.venv\Scripts\python -m playwright install chromium` | PDF report rendering. Without it a report job fails with `BrowserType.launch: Executable doesn't exist` |
| **OWASP Juice Shop** | local clone on port 3000, `-InstallJuiceShop` | the deliberately vulnerable, authorized demo target. Optional for a smoke test, required for the full graded demo |

After a winget install, **restart the terminal** (or add `C:\Program Files (x86)\Nmap` to `PATH`) before
starting uvicorn, or the backend process will not see the new binary. Building Juice Shop from source runs a
nested `npm install` plus a frontend build; if its postinstall fails, use a prebuilt release or point the
scanner at another application you own.

### Configuration and accounts

| Item | How it is provided |
|---|---|
| `backend/.env` | Created by the setup script from `.env.example`; **gitignored, never commit it**. Holds `SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DATABASE_URL`, `ZAP_API_URL`, `ZAP_API_KEY` |
| `SECRET_KEY` | The script generates a random one. **Do not change it later**: it signs JWTs and derives the Fernet key that encrypts stored LLM provider keys, so rotating it invalidates every session and makes existing keys undecryptable |
| LLM provider key | **Not a file and not an env var.** An admin enters it in Settings → Add provider; it is stored Fernet-encrypted in SQLite and is write-only over the API. Required only for AI interpretation and summaries |
| ZAP daemon | `zap.bat -cmd -daemon -host 127.0.0.1 -port 8080 -config api.key=<key from backend/.env>`. Start it only for `full_intrusive` runs |
| Ports | `8000` backend · `5173` frontend · `3000` Juice Shop · `8080` ZAP daemon |

### Only authorized targets

Every scan needs a registered target with a real `authorization_ref` (ticket, contract or sign-off).
Loopback/private hosts such as `localhost` and `127.0.0.1` additionally require the host in
`in_scope_assets`. Only scan systems you own or have written permission to test; `full_intrusive` is
admin-only and must never be pointed at a third-party site.

### Verify the install

```bash
cd backend
.venv\Scripts\python -m pytest tests -q     # 268 passed
cd ..\frontend
npm run build                              # 0 errors
nmap --version                             # must resolve on PATH
```

## Quick start (Windows, native)

On a clean machine, run `powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1` first. It installs
and verifies the Python venv, npm dependencies, Playwright Chromium, Nmap and OWASP ZAP, writes a
gitignored `backend/.env` with a random `SECRET_KEY` and ZAP API key, and prints the `PLAN.md` §11
checklist. Useful flags: `-InstallJuiceShop` (clone the demo target), `-StartZap` (launch the daemon),
`-SkipTools` (skip Nmap/ZAP), `-SkipTests`, and `-RepoRoot D:\Cybersec` (set up the main checkout from a
linked worktree). The manual steps below are what the script runs; see
[docs/ONBOARDING.md](docs/ONBOARDING.md) for the full walkthrough.

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

- API docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/health
- Run backend tests: `.venv\Scripts\python -m pytest tests -q` (requirements-dev.txt)

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

- App: http://localhost:5173 (dev server proxies `/api` → `127.0.0.1:8000`)

### 3. Sign in

A bootstrap admin account is created automatically on first backend startup:

| Field | Value |
|---|---|
| Email | `admin@example.com` |
| Password | `admin123` |
| Role | `admin` (can create assessor/viewer accounts via the users API) |

These are development defaults. On a clean setup the setup script already created `backend/.env` with a
random `SECRET_KEY`; to change the admin credentials, edit `ADMIN_EMAIL` / `ADMIN_PASSWORD` there **before
the first start** (see `backend/.env.example`), or use the users API afterwards. There is no public
registration; the admin creates all other accounts.

After signing in, register a target (e.g. local Juice Shop at `http://localhost:3000`) with a real
`authorization_ref` and, for loopback hosts, `in_scope_assets: ["localhost"]`. To turn on AI findings, go
to Settings → Add provider as an admin, tick the external-processing acknowledgement, assign a model to
`interpretation` and `summary`, then use Test connection. No API key belongs in a file.

## Current status (build order from PLAN.md §13)

| Step | Status |
|---|---|
| 1. Repo scaffold: FastAPI + models + JWT auth + Vite/shadcn shell | ✅ done |
| 2. Target registry + authorization + intensity gate | ✅ done — gate enforced server-side (409), re-checked at scheduling |
| 3. Prober + Nmap wrapper + jobs/SSE | ✅ done — live `nmap` job completed on an authorized localhost target after the Nmap 7.80 install (2026-11-15) |
| 4. ZAP integration + orchestrator pipeline | 🔶 code complete — ZAP 2.17.0 installed; daemon not started, so the `full_intrusive`/active-scan path is not yet rehearsed |
| 5. Findings verification workflow | ✅ done — M4 T4.1-T4.3 backend + M3 T3.2 UI: state machine, role guards, evidence drawer, notes, verification actions |
| 6. AI pipeline (client → settings → interpretation → summaries) | ✅ done in code — T2.1-T2.5; 67 AI tests passing; redaction gate enforced before every call. **No provider configured yet**, so live AI needs an admin to add a key |
| 7. Dashboard + PDF report | ✅ done — M4 T4.4 PDF backend + M3 T3.4 live dashboard + M3 T3.5 report trigger UI; a real 150 KB PDF was generated on 2026-11-15 |
| 8. Assessment wizard + live scan view | ✅ done — M3 T3.1: wizard with server-side intensity gate mirrored in the UI, authenticated SSE live log, per-job progress, cancel |

A live API-level smoke test (login → target → assessment → three completed jobs → verified finding → PDF)
passed on 2026-11-15. It is an environment check, **not** the I1-I4 integration-wave rehearsal: see
[docs/INTEGRATION_LOG.md](docs/INTEGRATION_LOG.md) for what has and has not been exercised.

Build log for M1 (approach, decisions, defense notes): [docs/member-logs/m1-scan-engine.md](docs/member-logs/m1-scan-engine.md).
Build log for M2 (approach, decisions, defense notes): [docs/member-logs/m2-ai-pipeline.md](docs/member-logs/m2-ai-pipeline.md).

## Team modules

M1 scan engine · M2 AI pipeline · M3 frontend · M4 findings/reports/auth · M5 docs/QA/deployment — see PLAN.md §8.
Detailed per-member tasks, expected outputs, and the sequenced integration plan: **[docs/TASK_PLAN.md](docs/TASK_PLAN.md)**.
New team member? Start here: **[docs/ONBOARDING.md](docs/ONBOARDING.md)**.
Project deliverables: [proposal](docs/proposal.md) · [system design](docs/system-design.md) ·
[QA checklist](docs/qa-checklist.md) · [evidence pack](docs/evidence/README.md) ·
[integration log](docs/INTEGRATION_LOG.md) · [final report](docs/final-report.md) ·
[presentation skeleton](docs/presentation-skeleton.md).
