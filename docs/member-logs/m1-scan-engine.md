# Member Log M1 — Scan Engine & Orchestration

> Build log for M1 (owner: member 1). Written at the end of the M1 build session (2026-11-08).
> Purpose: document what was built, the approach taken, every decision made and why, and the verification
> evidence — so the owning member can explain and defend each choice in the final presentation and oral defense
> (rubric: "Understanding of individual contribution", "Understanding of AI integration and limitations").

## What was built (per task)

| Task | Delivered | Files |
|---|---|---|
| T1.0 Contract | Assessment/job API schemas, SSE event schema, `KNOWN_CATEGORIES` list | `app/schemas/assessment.py` |
| T1.1 Runner interface | `BaseRunner` ABC, `ScanContext` (log/progress/cancel callbacks), `RunnerError`, tool registry with `@register` decorator | `app/scanner/base.py`, `app/scanner/registry.py` |
| T1.2 Nmap runner | Subprocess wrapper, XML streaming parse, intensity profiles, graceful "nmap not installed" failure | `app/scanner/nmap_runner.py`, `tests/fixtures/nmap_localhost.xml` |
| T1.3 DNS runner | A/AAAA via `getaddrinfo` (hosts-file aware), MX/NS/TXT via dnspython, gated subdomain wordlist | `app/scanner/dns_runner.py` |
| T1.4 HTTP prober | Our own check engine: security headers, cookie flags, banner/tech disclosure, TLS certificate facts (expiry, self-signed), gated directory probing | `app/scanner/prober/__init__.py`, `app/scanner/prober/checks.py` |
| T1.5 ZAP runner | Daemon client: spider always, active scan only at full intensity, alerts normalization, graceful degradation when daemon is down | `app/scanner/zap_runner.py` |
| T1.6 Orchestrator | Pipeline assembly + background task, job state machine persisted to DB, SSE event bus with snapshot + heartbeat, cancel support, normalizer (rule-based results → `ai_candidate` findings) | `app/scanner/orchestrator.py`, `app/scanner/normalize.py`, `app/api/assessments.py` |
| T1.7 Intensity gate | Server-side 409 in `POST /api/assessments` when requested intensity exceeds the target's authorization + re-check at scheduling time | `app/api/assessments.py`, orchestrator |

Supporting: `app/api/findings.py` (minimal read-only list **seeded for M4** — M4 owns this file from Wave 2),
`backend/requirements-dev.txt` (pytest), test suite `backend/tests/` (7 tests).

## The approach (how it was actually built)

Built AI-assisted ("vibecoding") in one session, task by task following `docs/TASK_PLAN.md`. The working method
that made this fast *and* defensible:

1. **Contract first.** Before any runner code, the API shapes were written down as Pydantic schemas
   (`schemas/assessment.py`) — these are the frozen Wave-1 contract that M3 mirrors into TypeScript and M2/M4
   build against. The UI will never need to change because an internal implementation changed.
2. **Interface before implementations.** `ScanContext` + `BaseRunner` were designed before any tool wrapper,
   so every runner is structurally identical: get context → do async IO → log/progress → store JSON output.
   Adding a tool is one `@register("name")` line.
3. **Each runner tested against reality, not mocks alone.** The prober was tested against a real local HTTP
   server that deliberately lacks security headers and contains a planted `/backup.zip`; the orchestrator was
   tested end-to-end including the *failure* path (nmap missing → job fails gracefully, assessment still
   completes).
4. **Fail-soft pipeline.** One missing binary or unreachable daemon marks a job `failed` with an actionable log
   line ("nmap executable not found — see PLAN.md §11") and the assessment continues. A security assessment
   that dies because one tool is absent is a broken assessment.

## Key decisions and trade-offs (defense talking points)

1. **In-process async worker instead of Celery/Redis** (PLAN.md decision): jobs are persisted to the DB so the
   UI survives refreshes, but a server restart kills a running task and leaves the assessment `running` in the
   DB until re-launched. Accepted because the demo is single-machine; the `ScanRunner` boundary means a Celery
   swap touches only the orchestrator.
2. **Deterministic findings bypass the AI.** Missing-header and exposed-file checks are unambiguous rules, so
   the normalizer inserts them directly as `ai_candidate` findings with `ai_confidence = 1.0`. The AI
   interpreter (M2) adds the *non-deterministic* findings on top. Dedup is by (assessment, title), so both
   sources coexist. This shows AI is used where it adds value, not where a regex is more reliable.
3. **`ai_candidate` is a workflow state, not a claim about origin.** Rule-based and AI-sourced findings both
   start unverified; only a human assessor moves them to `verified`. The normalizer physically cannot create a
   verified finding (the state machine is M4's and role-guarded).
4. **Intrusiveness is data, not code.** Intensity is an enum on the target/assessment; the orchestrator's
   `plan_tools()` and every runner branch on it. The gate returns **409** server-side — the UI disabling a
   button is not security.
5. **SSE with snapshot-then-live.** A fresh subscriber immediately receives a full state snapshot, then live
   events, with 15-second heartbeat comments to survive proxies. `EventSource` reconnects land on the same
   snapshot handler, so refresh-mid-scan just works.
6. **DNS via `getaddrinfo` first.** Juice Shop runs as `localhost`, which dnspython would not resolve (it
   ignores the hosts file); `getaddrinfo` handles both real domains and localhost.
7. **Job rows are created synchronously in the POST endpoint** so the 201 response already contains the full
   run plan (`running` + pending jobs) — M3's wizard navigates to a run view that is never empty.

## Verification evidence

- `pytest`: **7 passed** — fixture-based Nmap XML parsing, registry completeness, pure header/cookie/disclosure/TLS
  checks, full prober run against a live local server (planted `/backup.zip` found), intensity-gate 409,
  viewer-role 403, and the full pipeline end-to-end including the graceful nmap-failure path.
- Live smoke run via `uvicorn` + `curl`:
  - `POST /api/assessments` (passive target) → `201` with `running` + 3 pending jobs;
  - full intensity against a `passive_safe` target → **409 "Intensity gate"**;
  - pipeline completed: dns `completed`, nmap `failed (executable not found)`, prober `completed`;
  - normalizer emitted **7 `ai_candidate` findings** with correct severities (CSP=high, HSTS=medium, banner=info);
  - SSE `/events` served the snapshot then live events; cancel returned `202`, in-flight job finished, remaining
    jobs `cancelled`.

## What remains for the owner (Wave 2/3)

- Install **Nmap + ZAP** on the dev machine (M5.1 script) and re-run an assessment: nmap job should complete
  against Juice Shop; ZAP runner needs a live daemon test (`full_intrusive`).
- Tune the prober wordlist and severity mapping with real Juice Shop results.
- Wire the M2 interpreter as the post-normalize step (contract already in place).
- M3 integration (I1): assessment wizard + SSE live view — the endpoints are ready.

## Honest limitations (say these before the examiner finds them)

- The event bus is in-process: it does not survive a server restart and requires single-worker uvicorn.
  Documented trade-off, isolated in `orchestrator.py`.
- ZAP active-scan is only as good as ZAP's policy defaults; no custom scan policy yet.
- The nmap progress estimate is bytes-streamed heuristic, not true phase progress.
- Directory probing is a fixed wordlist, not a fuzzer — deliberate (safe-by-default, demo-scoped).
