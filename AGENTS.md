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
- **Git sync — pull before work and before pushing:** start every session or task with `git status -sb` then
  `git pull --rebase`. Multiple members and multiple agent sessions push to `main` daily; users forget to pull,
  so the local clone is often stale — pushing from it causes rejected pushes or messy merge commits. Re-check
  `git log --oneline -3` immediately before committing (another session may have committed in the meantime).
  With uncommitted task edits in flight, the order is: **commit first, then `git pull --rebase`, then push**
  (rebase needs a clean tree). If a pull brings conflicts: stop, resolve carefully or ask the user — never
  force-push, never commit with unresolved conflict markers.
- **Milestone status upkeep — update this file every time a member completes a milestone:** `AGENTS.md`
  is the first thing every agent session reads, so a stale "Current state / next up" is a defect, not
  cosmetic. When a member completes a milestone — a team module (M1-M5, `TASK_PLAN.md` §8) or a numbered
  course milestone (`PLAN.md` §10) — the same work must refresh the snapshot below before it is pushed:
  flip that module's row, name the tasks/files that shipped, update "Next up" and the integration-wave
  state, and re-date the snapshot with the verification results (build + test counts). Put it in the
  module's final commit or an immediately following `docs(agents): ...` commit; never leave it for a
  later session. Smaller tasks that change what is "next" should update that line too. If the milestone
  also changes a build-order row in [README.md](README.md), sync that row in the same commit so the two
  never disagree. The status section is living content; everything else in this file, `PLAN.md`, and
  `TASK_PLAN.md` stays a decision record that changes only by team consensus. Member build logs in
  `docs/member-logs/` belong to their owner — remind them to refresh the log, do not rewrite it for them.
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

**Snapshot: 2026-11-12.** Living content — see "Milestone status upkeep" in Conventions. The build-order
table in [README.md](README.md) is kept in sync by the M5 steward.

| Module | State | What landed |
|---|---|---|
| **M1** Scan engine | done | nmap/dns/prober/zap runners, orchestrator with SSE + cancel, server-side intensity gate (409), normalizer emitting `ai_candidate`; contracts frozen in `app/schemas/assessment.py`. Log: `docs/member-logs/m1-scan-engine.md`. |
| **M2** AI pipeline | done | T2.0-T2.5: OpenAI-compatible client, Fernet-encrypted provider settings + discretion gate, redaction before every call, interpreter, summarizer + `ai_outputs` audit. 67 AI tests. Additive enhancement (2026-11-12): live model-catalog proxy `app/ai/catalog.py` + `GET /api/settings/llm/providers/{id}/models` with TTL cache, normalized pricing/capability metadata, per-model `supported_efforts`/`default_effort`, persisted `LLMTaskConfig.effort` (idempotent startup migration) and offline fallback; proposal `docs/proposals/01-live-model-catalog.md`. Log: `docs/member-logs/m2-ai-pipeline.md`. |
| **M3** Frontend | done | T3.0-T3.5 complete: assessments wizard + authenticated SSE live log (T3.1), filterable findings table + detail drawer + verify/false-positive/needs-evidence actions with notes + WCAG AA contrast (T3.2), LLM provider settings + per-task models + test connection (T3.3), live dashboard with real counts + responsive chart + recent assessments (T3.4), report generation + authenticated download (T3.5). Additive enhancement (2026-11-12): searchable `ModelPicker` dialog (`src/components/model-picker.tsx`), model-aware reasoning effort control driven by the live catalog (`src/lib/model-effort.ts`), shadcn `Switch`/`Checkbox` primitives and modernized AI settings UI (`src/pages/settings.tsx`, `src/pages/settings-tasks.tsx`), verified in dark and light themes. Log: `docs/member-logs/m3-frontend.md`. |
| **M4** Findings & reports | done | T4.0-T4.5 shipped: verification state machine, evidence upload/download, OWASP risk mapping, Jinja2 + Playwright PDF (202 -> poll -> download), auth hardening. Log refreshed to final state: `docs/member-logs/m4-findings-reports.md`. M3 hand-off spec: `docs/m3-findings-page-spec.md`. |
| **M5** Docs/QA/deploy | in progress | Router hand-offs merged (T5.4 partial). Tool dependencies pending install (Nmap, OWASP ZAP, Playwright Chromium). Evidence pack & rehearsal pending. |

Verification on this snapshot: `npm run build` passes (0 errors), `npm run lint` reports 0 errors / 8 warnings,
`pytest tests -q` reports **166 passed**; live smoke test returned 200 for `/health`, login, and all list endpoints.
The model catalog, model-aware effort levels and settings UI were also verified in the running app in both themes.
All M1-M4 modules are code complete; backend and frontend are ready for integration waves I1-I4 (`TASK_PLAN.md`).

**Next up, in order:**
1. **M5 T5.1** — install Nmap, the OWASP ZAP daemon, and Playwright Chromium (`PLAN.md` §11). None are
   installed yet: the ZAP runner degrades gracefully and the report job fails with an actionable log
   line until they are.
2. **Integration waves I1-I4 rehearsal** (`TASK_PLAN.md` §9) and the M5 evidence pack.
3. **M5 documentation** — `docs/proposal.md`, `docs/system-design.md`, `docs/qa-checklist.md`, `scripts/setup-dev.ps1`.

**Known integration blockers:**
- **Resolved:** `GET /api/assessments/{id}/events` SSE authentication: solved with fetch-based streaming in `src/lib/scan-events.ts`.
- **Resolved:** Authenticated binary report download: solved with fetch-based blob download in `src/pages/assessment-reports.tsx`.
- **Resolved:** `src/mocks/data.ts` task name drift: fixed with real `LLMTask` enum values.
- Still open: Evidence binary download from the detail drawer (currently displays uploaded file metadata; download wiring can be added when needed).
- Frontend has no automated test harness (Vitest/Playwright config pending). Verified by live browser runs and build/lint.
