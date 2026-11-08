# Member Onboarding — start here

One page. Do these steps in order; ~30 minutes to a working dev environment.

## 1. Get access & clone (5 min)

- Accept the GitHub collaborator invite (check your email / github.com notifications).
- Use **your own GitHub account** for everything — your commits are the evidence for the
  individual-contribution rubric. Never share logins.
- Clone, then set pull-rebase once:

```bash
git clone https://github.com/90377Sednaaa/Cybersec.git
cd Cybersec
git config pull.rebase true
```

## 2. Set up your environment (10 min)

Backend (Python 3.13):

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\python -m pytest tests -q        # must pass: currently 9 tests
.venv\Scripts\python -m uvicorn app.main:app --port 8000   # http://127.0.0.1:8000/docs
```

Frontend (Node 24):

```bash
cd frontend
npm install
npm run build      # must pass
npm run dev        # http://localhost:5173
```

Login (local dev): `admin@example.com` / `admin123`.

## 3. Read, in this order (10 min)

1. **README.md** — what the platform is, the pipeline, the stack.
2. **`docs/TASK_PLAN.md` — your module's section** (M2, M3, M4, or M5) plus the *Waves* intro and the
   *ownership matrix* and *cross-module tweak etiquette* sections. Your tasks have acceptance criteria.
3. **AGENTS.md** — the rules; applies to you *and* to any AI agent you work with (it will read this file itself).
4. **`docs/member-logs/m1-scan-engine.md`** — the example: this is the level of documentation your module log
   should reach (approach, decisions, verification evidence, honest limitations).

## 4. Your working rules (the short version)

- **Pull before you start and before you push** (`git status -sb`, `git pull --rebase`). The repo moves fast.
- **Conventional Commits, push after every finished task**, stage files by explicit path.
- **Verify before claiming done:** backend = pytest passes; frontend = `npm run build` passes; UI changes =
  check both light and dark themes in the running app.
- **Ownership:** build only inside your module's files (matrix in TASK_PLAN.md). Need to touch someone else's
  area? Read the tweak etiquette first; need to change a contract? Proposal, not drive-by.
- **Hard rules that are never negotiable:** findings are only confirmed by a human assessor; the intensity gate
  is never bypassed; secrets are never committed, logged, or sent to an LLM unredacted; only registered targets
  are scanned.

## 5. Start your member log (5 min)

Create `docs/member-logs/m<N>-<module>.md` on day one (copy the structure of the M1 log: What was built /
Approach / Key decisions / Verification evidence / Honest limitations). Write it *as you build* — at the end
it is your oral-defense script.

## 6. Where each module starts

| Module | Owner's first task | Notes |
|---|---|---|
| M1 Scan engine | ✅ built — read its log | Owner's remaining duties: live re-run once Nmap/ZAP installed; brief M2 (raw-output shapes) and M3 (assessment API + SSE) |
| M2 AI pipeline | **T2.0** — freeze the settings + interpreter contract | Interpreter consumes `job.raw_output` (see M1 log); wire-in point: post-normalize step in `orchestrator.run_pipeline`. Build mock-first; OpenRouter key needed only for live verification |
| M3 Frontend | **T3.0** — mirror `app/schemas/assessment.py` into `src/lib/types.ts`, build page mocks | Assessment endpoints are live (`/api/assessments`, SSE `/events`); pair with M1 owner for the walkthrough |
| M4 Findings & reports | **T4.0** — freeze the findings/evidence/report contract | `/api/findings` exists as a seeded read-only list; M4 replaces/extends that file (it is yours) |
| M5 Docs/QA | **T5.0** proposal + **T5.1** setup script | T5.1 installs Nmap + ZAP + Playwright — M1's live paths are waiting on this; also steward `main` and shared files |

## 7. Daily rhythm

15-minute sync (progress, blockers, proposal decisions) → pull → build → verify → push. Proposals via
`docs/proposals/TEMPLATE.md`. Blockers go to the module owner; shared-file changes go to M5 (steward).
