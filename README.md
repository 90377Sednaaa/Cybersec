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
docs/      PLAN.md (confirmed decisions), later: proposal, system design, reports
```

## Quick start (Windows, native)

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

These are development defaults. Change them by setting `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `SECRET_KEY` in
`backend/.env` **before the first start** (see `backend/.env.example`), or afterwards through the users API.
There is no public registration; the admin creates all other accounts.

After signing in, register a target to work with (e.g. Juice Shop at `http://localhost:3000`).

## Current status (build order from PLAN.md §13)

| Step | Status |
|---|---|
| 1. Repo scaffold: FastAPI + models + JWT auth + Vite/shadcn shell | ✅ done |
| 2. Target registry + authorization + intensity gate | ✅ done — gate enforced server-side (409), re-checked at scheduling |
| 3. Prober + Nmap wrapper + jobs/SSE | ✅ done — 7 backend tests passing; live nmap run pending Nmap install |
| 4. ZAP integration + orchestrator pipeline | 🔶 code complete — ZAP runner degrades gracefully; live test pending ZAP daemon install |
| 5. Findings verification workflow | ✅ done — M4 T4.1-T4.3 backend + M3 T3.2 UI: state machine, role guards, evidence drawer, notes, verification actions |
| 6. AI pipeline (client → settings → interpretation → summaries) | ✅ done — T2.1–T2.5; 67 AI tests passing; redaction gate enforced before every call |
| 7. Dashboard + PDF report | ✅ done — M4 T4.4 PDF backend + M3 T3.4 live dashboard + M3 T3.5 report trigger UI |
| 8. Assessment wizard + live scan view | ✅ done — M3 T3.1: wizard with server-side intensity gate mirrored in the UI, authenticated SSE live log, per-job progress, cancel |

Build log for M1 (approach, decisions, defense notes): [docs/member-logs/m1-scan-engine.md](docs/member-logs/m1-scan-engine.md).
Build log for M2 (approach, decisions, defense notes): [docs/member-logs/m2-ai-pipeline.md](docs/member-logs/m2-ai-pipeline.md).

## Team modules

M1 scan engine · M2 AI pipeline · M3 frontend · M4 findings/reports/auth · M5 docs/QA/deployment — see PLAN.md §8.
Detailed per-member tasks, expected outputs, and the sequenced integration plan: **[docs/TASK_PLAN.md](docs/TASK_PLAN.md)**.
New team member? Start here: **[docs/ONBOARDING.md](docs/ONBOARDING.md)**.
