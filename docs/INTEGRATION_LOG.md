# Integration Log - Aletheia

**M5 task T5.4 (stewardship).** One row per integration wave, with a logged pass/fail. `TASK_PLAN.md` §9
requires I1 -> I2 -> I3 -> I4 strictly sequential: a failing step blocks the next, and no feature work merges
into `main` during the waves without the steward.

> This log is being started on 2026-11-15. It does **not** retroactively invent pass results. Code-level and
> live-server verification that already happened is recorded separately in §2 with its source. The formal
> wave rehearsals I1-I4 are **NOT RUN**; they need the T5.1 tool installs and a real LLM provider key.

---

## 1. Wave register

| Wave | Integration | Participants | Pass condition (`TASK_PLAN.md` §9) | Result | Date | Evidence |
|---|---|---|---|---|---|---|
| **I1** | Assessments live | M1 + M3 | Create assessment in UI -> pipeline runs -> SSE progress + logs visible -> cancel works | **NOT RUN** (blocked: Nmap not installed; full live run pending T5.1) | - | - |
| **I2** | Findings + verification | M1 + M4 + M3 | Orchestrator emits candidates -> findings page lists them marked `ai_candidate` -> assessor verifies one with evidence -> status persists | **NOT RUN** (blocked by I1) | - | - |
| **I3** | AI wiring | M2 + M1 + M4 + M3 | Post-scan interpretation produces candidates automatically (redaction on); settings page configures a real key; report includes AI summary + verified findings | **NOT RUN** (blocked by I2 and by missing provider key) | - | - |
| **I4** | Full rehearsal | All + M5 | The brief's 8-step demo: scope -> recon -> scan -> assessment -> AI analysis -> human verification -> risk -> PDF report, executed live from a clean shell | **NOT RUN** (blocked by I1-I3 and missing Playwright Chromium) | - | - |

**Current blocker chain:** T5.1 installs (Nmap, ZAP daemon, Playwright Chromium) -> I1 -> I2 -> provider key
-> I3 -> I4 -> evidence capture -> final report. `AGENTS.md` "Next up" carries the same order.

---

## 2. Verification evidence that already exists (source-cited, not a wave pass)

These are real results recorded elsewhere in the repository. They support readiness for I1-I4 but are not
substitutes for the rehearsals.

| What | Result | Source |
|---|---|---|
| Backend tests | 268 passed | `AGENTS.md` snapshot 2026-11-14 |
| Frontend build | `npm run build` 0 errors | `AGENTS.md` snapshot 2026-11-14 |
| Frontend lint | 0 errors / 7 known warnings | `AGENTS.md` snapshot 2026-11-14 |
| Live smoke test | 200 for `/health`, login, and all list endpoints | `AGENTS.md` snapshot 2026-11-14 |
| Wave 4 live-server checks | `X-Total-Count` matched the filtered set with `limit=2`; `limit=501` -> 422; CORS exposed the header; `PRAGMA journal_mode` = `wal`; evidence DELETE -> 204 and unlinked blob; SSE returned a snapshot plus a terminal `assessment` event | `AGENTS.md` snapshot 2026-11-14 |
| M1-M4 module status | all code complete; contracts frozen; audit W0-W5 closed | `AGENTS.md`, `docs/fix-plan.md`, `docs/member-logs/` |
| Hard-rule tests | intensity gate 409, viewer 403, illegal transition 409, redaction scrub, SSRF host guard | `backend/tests/` |
| Known blockers resolved | SSE authentication via fetch streaming; authenticated PDF blob download; mock task-name drift | `AGENTS.md` "Known integration blockers" |

---

## 3. How to log a wave (template)

Copy this block into §1's row and into a new dated section below. Never mark PASS without the artifact.

```
### I<N> - <name> - <YYYY-MM-DD>

- Participants:
- Environment: backend :8000 / frontend :5173 / Juice Shop :3000 / ZAP :8080 / provider: <model>
- Pass condition: <verbatim from TASK_PLAN.md §9>
- Result: PASS | FAIL
- Steps executed: <numbered, with observed result>
- Evidence: docs/evidence/<stage>/<file>
- Deviations / defects found: <list or "none">
- Follow-up owner and task: <name / task id>
- Steward sign-off: <name>
```

A FAIL keeps the wave open. Fix, re-run the wave from the beginning, and log the re-run as a new dated
section. Do not skip ahead to the next wave while one is failing.

---

## 4. Stewardship notes

- Router hand-offs (T5.4 partial) were merged earlier: `app/main.py` registers all nine routers, and
  `app/models/__init__.py` imports every model so `Base.metadata` sees all tables. `AGENTS.md` records
  "Router hand-offs merged (T5.4 partial)".
- Shared touchpoints (`main.py`, `models/__init__.py`, `frontend/src/App.tsx`) are steward-owned. Any change
  to them is a small hand-off from the owning module, never a drive-by edit.
- `README.md` build-order table and the `AGENTS.md` status snapshot must be refreshed in the same commit as
  any milestone that changes them.
- This log is owned by M5. Other members add evidence paths and defect notes, but the PASS/FAIL call and
  sign-off belong to the steward.
