# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

**Aletheia** — an AI-Assisted Security Assessment & Vulnerability Analysis Platform (university final project).
It integrates existing security tools (Nmap, OWASP ZAP, a custom HTTP prober, DNS) with LLM analysis, and keeps a
**human assessor in charge**: AI-generated findings are only candidates until an assessor verifies them.

The canonical decision record is **`docs/PLAN.md`** — read it before making architectural decisions and do not
contradict it silently. Grading context: Documentation 30 / Implementation 50 / Individual & Oral Defense 20.

## Stack

- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2.0, Pydantic v2, SQLite. JWT auth (PyJWT + bcrypt) with three
  roles: admin / assessor / viewer.
- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query, Recharts, react-router.
- **Runtime:** native Windows (no Docker in development). Scan execution: in-process async worker + SSE
  (Celery is explicitly out of scope per PLAN.md).

## Layout

```
backend/   FastAPI app — app/main.py (factory + seeding), app/models, app/api, app/core, app/schemas,
           app/scanner (M1: runners via @register, orchestrator, normalizer, event bus), tests/
frontend/  React SPA — src/lib (api, auth, theme, types), src/pages, src/components
docs/      PLAN.md (decisions), TASK_PLAN.md (per-member plan), member-logs/ (build logs), proposals/
```

## Commands

Backend (from `backend/`):

```bash
python -m venv .venv                      # setup (once)
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

API docs: http://127.0.0.1:8000/docs — health: http://127.0.0.1:8000/health

Backend tests (from `backend/`, dev deps in requirements-dev.txt):

```bash
.venv\Scripts\python -m pytest tests -q   # must pass before claiming backend work done
```

Frontend (from `frontend/`):

```bash
npm install
npm run dev      # dev server, proxies /api to 127.0.0.1:8000
npm run build    # tsc -b && vite build — must pass before claiming any frontend work is done
```

## Development accounts

A bootstrap admin is seeded on first backend startup: **`admin@example.com` / `admin123`**.
Override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `SECRET_KEY` in `backend/.env` (see `backend/.env.example`)
before the first start. There is no public registration — the admin creates assessor/viewer accounts through
the users API.

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, scopes like `feat(ui):`) with a detailed
  body explaining what and why. **Every finished task must be committed and pushed** — do not leave completed,
  verified work sitting in the working tree. Run the relevant verification (build, tests) before committing.
  Stage files explicitly by path (never `git add -A` / `git commit -a`) so unrelated working-tree changes are
  not swept into your commit.
- **UI:** shadcn/ui + Tailwind v4. One accent (the Aletheia brand blue) locked across the app; severity colors
  (`--severity-critical|high|medium|low|info`) are semantic state colors, not decoration. Every UI change must
  work in **both** light and dark themes (dark is the default — verify both). No em-dashes in UI copy. Verify
  changes visually in the running app, not just via the build.
- **Design skills:** UI work follows the project-local `.agents/skills/impeccable` skill (this app is *Operate*
  mode — scanability and consistency outrank expression). `.agents/skills/shadcn`, `tailwind-4-docs`, and
  `tanstack-query` hold stack-specific references; `.agents/skills/fastapi` covers backend patterns.
- **Python:** SQLAlchemy 2.0 typed mappings (`Mapped` / `mapped_column`); enums stored with
  `native_enum=False`; all request/response shapes go through Pydantic schemas at the API boundary.
- **Working across modules:** the ownership matrix in `docs/TASK_PLAN.md` assigns accountability, not
  exclusivity — members tweak each other's code to unblock their own workflow, and that is allowed. When
  editing code owned by another member: make the **minimal** change that unblocks the task, preserve all
  API/DB contract shapes, match the existing code's style, do **not** refactor or "improve" surrounding code,
  and commit as `fix(<module>): ...` with a note to the owner. Contract changes go through the proposal
  process (see TASK_PLAN.md), never drive-by edits.
- **TypeScript:** `import type` for type-only imports (`verbatimModuleSyntax`); no constructor parameter
  properties (`erasableSyntaxOnly`); `@/` path alias; `cn` imported from the `cn` package (shadcn v4 style).

## Hard rules (do not violate)

- **Human verification:** never auto-confirm findings. `ai_candidate` findings stay visually marked and never
  count as confirmed until an assessor verifies them.
- **Scope safety:** the per-target `allowed_intensity` gate is enforced in the backend orchestrator. Never add
  a path that runs intrusive tools (ZAP active scan, wordlist brute force) against a `passive_safe` target.
- **Secrets:** never commit `.env`, API keys, or tokens. LLM API keys are encrypted at rest (Fernet) and must
  never be logged or returned by any API response. The redaction layer strips credentials before any content
  is sent to an LLM provider.
- **Authorized targets only:** the platform scans only registered targets. Never weaken that constraint.

## Current state / next up

The build-order status table lives in [README.md](README.md). **M1 (scan engine) is complete and tested**:
runners (nmap/dns/prober/zap) registered in `app/scanner`, orchestrator with SSE + cancel, intensity gate
enforced server-side (409), normalizer emitting `ai_candidate` findings, contracts frozen in
`app/schemas/assessment.py`. Build log + defense notes: `docs/member-logs/m1-scan-engine.md`.

Next: **M5.1** environment setup (install Nmap + ZAP daemon so the nmap/zap jobs run live — ZAP runner
currently degrades gracefully without it), **M2** AI pipeline (the interpreter wires in as the
post-normalize step of `orchestrator.run_pipeline`; raw-result shapes are in `job.raw_output`), **M3**
assessments UI (wizard + SSE live view; endpoints are live under `/api/assessments`). Nmap, OWASP ZAP, and
Playwright are still not installed — checklist in PLAN.md §11.
