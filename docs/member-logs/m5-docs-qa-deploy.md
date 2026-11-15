# Member Log M5 - Docs, QA & Deployment (integration steward)

> Assembled on branch `m5/docs-qa-deploy` on 2026-11-15. This log was started by an AI agent doing the M5
> documentation tasks; the **M5 owner must review it, add their own decisions in their own words, and keep it
> current** before the oral defense. It is their defense script, not a report written on their behalf.
> Structure follows `docs/member-logs/m1-scan-engine.md`: what was built / approach / key decisions /
> verification evidence / honest limitations.

## What was built (per task)

| Task | Delivered | Files |
|---|---|---|
| T5.0 Proposal | Draft proposal with background, problem, six objectives, in/out scope, brief-feature mapping, stack rationale, framework references, team breakdown, milestones, acceptance criteria, ethics and known limitations | `docs/proposal.md` |
| T5.1 Environment setup | Idempotent PowerShell setup/verification script for venv, npm, Playwright Chromium, Nmap, ZAP daemon with API key, `.env` scaffold and optional Juice Shop; prints the `PLAN.md` §11 checklist | `scripts/setup-dev.ps1` |
| T5.2 System design | Architecture flowchart, ERD for the ten shipped tables, end-to-end sequence diagram, finding state machine, API surface, security design, deployment topology, limitations and a decision-to-code traceability table | `docs/system-design.md` |
| T5.3 QA + evidence | Pre-flight gate, eight-step scripted demo run sheet with stable artifact IDs, rubric traceability table (A4, B1-B7), negative/security checks S1-S8, known failures and a sign-off table; nine evidence stage folders with a README and capture hygiene rules | `docs/qa-checklist.md`, `docs/evidence/README.md`, `docs/evidence/<stage>/.gitkeep` |
| T5.4 Stewardship | Integration log for I1-I4 with an honest NOT RUN status, separately cited verification evidence that already exists, a wave log template and shared-touchpoint notes | `docs/INTEGRATION_LOG.md` |
| T5.5 Final report + presentation | Final report skeleton built around M4's generated PDF, with an AI-limitations section and a per-member contribution appendix; 18-slide presentation skeleton with speaker-note template and per-member sub-slides | `docs/final-report.md`, `docs/presentation-skeleton.md` |

Working branch: `m5/docs-qa-deploy`, in a linked worktree at `D:\Cybersec-m5` so `main`'s working tree stays
untouched while other sessions continue on `main`.

## The approach

1. **Read the decision record first.** `AGENTS.md`, `docs/PLAN.md`, `docs/TASK_PLAN.md`, `docs/fix-plan.md`,
   the four existing member logs, `README.md`, `ONBOARDING.md`, `risk-methodology.md` and
   `auth-checklist.md`. Nothing in the new docs was invented from memory.
2. **Verify against code, not against the plan.** The ERD was built from `backend/app/models/*.py`, the API
   surface from the route decorators in `backend/app/api/*.py`, the workflow from
   `scanner/orchestrator.py`, and the routes from `frontend/src/App.tsx`. Where code and plan disagree, the
   code wins and the difference is written down.
3. **Scaffold, do not fake.** Every document that depends on a live run is explicitly marked as a skeleton:
   I1-I4 are NOT RUN, the evidence folders are empty apart from `.gitkeep`, and every unresolved value is a
   `[TO FILL]` marker rather than a plausible-looking number.
4. **One artifact ID per claim.** `E-01`..`E-16` are shared between the QA checklist, the evidence folder
   map and the presentation deck, so a rubric line can always be traced to a file.

## Key decisions and trade-offs (defense talking points)

1. **Worktree, not a plain branch.** Multiple members and agent sessions push to `main` daily. A linked
   worktree keeps the shared working tree on `main` and avoids another session unexpectedly finding itself
   on a feature branch. The cost is that `node_modules` and `.venv` are not present in the worktree, so
   build/test verification is run from the code-identical `main` tree; M5 is docs-and-scripts only, so this
   is safe.
2. **Do not fabricate evidence.** The acceptance criterion for T5.3 is "every rubric line has an artifact",
   but T5.1 installs and a provider key are prerequisites. Writing "PASS" in the integration log without a
   rehearsal would be a defect, so the log records a blocker chain instead.
3. **Leave other members' logs alone.** `docs/auth-checklist.md` has drifted (`PUT` vs `PATCH`, missing DELETE
   routes), but it is M4-owned. M5 flags the drift in `qa-checklist.md` §5 and `system-design.md` §8 instead
   of rewriting it. Same rule for the four existing member logs.
4. **Provisional rubric labels.** The course brief is not in the repository. The codes A4 and B1-B7 come from
   `TASK_PLAN.md` T5.3; the criterion text beside them is labelled provisional and must be replaced with the
   official wording by the M5 owner.
5. **Setup script verifies as well as installs.** A teammate's clean machine is the acceptance test for T5.1,
   so the script prints a PASS / ACTION REQUIRED line for every `PLAN.md` §11 item instead of exiting
   silently. External installs go through winget with the documented IDs (`Insecure.Nmap`, `ZAP.ZAP`) and
   fall back to manual instructions when winget is unavailable.

## Verification evidence

- Worktree and branch: `git worktree list` shows `D:/Cybersec-m5 [m5/docs-qa-deploy]` alongside
  `D:/Cybersec [main]`; branch pushed with upstream `origin/m5/docs-qa-deploy`.
- All paths in the new docs were checked against the repository: ten model tables, the router list in
  `app/main.py`, the route decorators, `app/scanner/orchestrator.py`, `frontend/src/App.tsx` and
  `frontend/package.json`.
- Winget package IDs confirmed against the official ZAP announcement (`ZAP.ZAP`) and current Windows
  install documentation (`Insecure.Nmap`).
- The setup script was parsed with the PowerShell parser for syntax errors; it was **not executed** because
  the task scope explicitly excluded system installs.
- Backend tests / frontend build: `[TO FILL - run from the main tree and record counts]`.
- I1-I4 rehearsal and evidence capture: **not executed** (blocker chain in `docs/INTEGRATION_LOG.md`).

## Honest limitations

- Proposal, system design, QA checklist, final report and presentation are **drafts/skeletons**. None has
  been submitted to the instructor or reviewed by the other members yet.
- Administrative fields (course code, instructor, member names/IDs, dates) are `[TO FILL]`.
- Rubric criterion wording is provisional until the course brief is pasted in.
- No screenshots, no generated PDF, no AI outputs and no verified-findings export exist yet; the evidence
  pack is an empty scaffold.
- Nmap, ZAP daemon and Playwright Chromium are still not installed, so the app is not yet workable end to
  end on a clean machine. The setup script is written but its installs have not been run.
- `docs/auth-checklist.md` (M4) is out of date relative to the shipped API; flagged, not fixed.
- The M5 owner must add their own voice to this log; an AI-written defense script is not a substitute for a
  member who can explain and defend each decision.
