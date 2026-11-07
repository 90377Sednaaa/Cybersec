# Aletheia: AI-Assisted Security Assessment & Vulnerability Analysis Platform

Final project — **Aletheia** combines existing security tools (Nmap, OWASP ZAP, custom HTTP prober, DNS) with AI analysis
(OpenAI-compatible LLMs via OpenRouter/DeepSeek/GLM/Ollama), while keeping a **human assessor in charge** of what
counts as a confirmed vulnerability.

**Canonical plan & decision record: [docs/PLAN.md](docs/PLAN.md)** — read that first.

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
- On first start a bootstrap admin is seeded: **admin@example.com / admin123** (dev only — change it or set
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `SECRET_KEY` in `backend/.env`, see `backend/.env.example`)

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

- App: http://localhost:5173 (dev server proxies `/api` → `127.0.0.1:8000`)
- Sign in with the bootstrap admin account, register a target (e.g. Juice Shop at `http://localhost:3000`)

## Current status (build order from PLAN.md §13)

| Step | Status |
|---|---|
| 1. Repo scaffold: FastAPI + models + JWT auth + Vite/shadcn shell | ✅ **this commit** |
| 2. Target registry + authorization + intensity gate | ✅ backend + UI (gate enforcement lands with orchestrator) |
| 3. Prober + Nmap wrapper + jobs/SSE | ⬜ milestone 4 (M1) |
| 4. ZAP integration + orchestrator pipeline | ⬜ milestone 4 (M1) |
| 5. Findings verification workflow | ⬜ milestone 6 (M4) |
| 6. AI pipeline (client → settings → interpretation → summaries) | ⬜ milestone 5 (M2) |
| 7. Dashboard + PDF report | ⬜ milestone 7 (M3/M4) |

## Team modules

M1 scan engine · M2 AI pipeline · M3 frontend · M4 findings/reports/auth · M5 docs/QA/deployment — see PLAN.md §8.
