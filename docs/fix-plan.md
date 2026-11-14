# Fix plan — M1–M4 audit findings

Author: M1 · Date: 2026-11-14 · Status: **W0–W5 landed · 05/06/07/09 accepted · 08 fallback only**

## Wave status

| Wave | State | Verification |
|---|---|---|
| W0 | **landed 2026-11-14** | `pytest` 188 passed (178 + 10 regressions); `npm run build` 0 errors; lint 0 errors / 8 warnings (baseline); dark + light + 720px visual checks passed |
| W1 | **quick wins landed; decision gate still open** | `pytest` 190 passed (+2); build 0 errors; lint 0 errors / **7 warnings** (one fewer, as predicted); reconnect proven by forcing 5 aborted `/events` attempts then restoring the route and observing a 200 |
| W2a | **landed 2026-11-14** — scope & authorization contract | `pytest` 211 passed (+14); build 0 errors; lint 0 errors / 7 warnings; live checks: missing `authorization_ref` 422, bad `base_url` 422, assessor `full_intrusive` 403 (create and patch), partial PATCH preserves scope, `PUT` now 405, assessor UI shows the option disabled |
| W2b | **landed 2026-11-14** — host guard + secret handling | `pytest` 237 passed (+26); build 0 errors; lint 0 errors / 7 warnings; live: a target with the host *outside* `in_scope_assets` has dns and prober refuse with a HostBlocked message while one with the host *in* scope completes; provider create returns 400 for a local URL without `local_endpoint`, 201 with it, 400 for public http and for embedded credentials |
| W3 | **landed 2026-11-14** | `pytest` 197 passed (+7); build 0 errors; lint 0 errors / 7 warnings; live cancel run ended `cancelled` with jobs `cancelled` (not `failed`), and the happy path still ends `completed` |
| W4 | **landed 2026-11-14** — truthful totals, persistence, lifecycle | `pytest` 261 passed (+24); build 0 errors; lint 0 errors / 7 warnings; live: `X-Total-Count: 7` with `limit=2` returned 2 rows, filtered total tracked the filter, `limit=501` → 422, CORS exposes the header, `PRAGMA journal_mode` = `wal`, evidence DELETE 204 unlinked the blob, SSE returned snapshot + terminal event |
| W5 | **landed 2026-11-14** — audit close-out | `pytest` 268 passed (+7); build 0 errors; lint 0 errors / 7 warnings; live: after a password change both pre-change sessions returned 401 "Session revoked", a fresh login returned 200 with `tv: 1`, and the admin session stayed valid. F-35's lost update reproduced deterministically (no lock error), F-34's query-count test fails without the fix, F-19 stays parked |

W0 note: F-22 (JobTimeline) needed a second correction during visual verification. The first attempt
included `now` in the axis max unconditionally, which stretched a *finished* run's axis from its end date
to today and crushed every bar to a sliver. The landed fix includes `now` only while `runFinishedAt` is
null. Recorded here because it is the kind of regression a build cannot catch.

W1 as-built notes:

- **F-30 shipped as idempotency, not a 409.** A second POST for the same assessment now returns the
  existing `pending` row with the same 202 instead of creating a duplicate render. That is additive — no
  new response status, no proposal needed. A stale `pending` row is settled first so a wedged row cannot
  make report generation permanently unavailable. **Residual gap, filed as F-40 in §2:** two requests that
  arrive inside the same pre-check window can still both insert, because SQLite has no row lock here. The
  real fix is a partial unique index (`ON reports(assessment_id) WHERE status = 'pending'`) plus an
  `IntegrityError` fallback, which needs a dedup step for databases that already contain duplicates. That
  is W4 work, deliberately not bundled into a quick win.
- **F-23 reconnects but does not replay.** Log lines emitted during a disconnect are lost; the API sends no
  event ids or backfill. The `snapshot` event on reconnect restores job/assessment state, so progress and
  status recover even though the log has a gap. Worth stating in the QA checklist (M5).

W3 as-built notes:

- **All five W3 fixes are internal.** No schema change, no new status codes, no response-shape change — which
  is why W3 could run while the proposals are still open. `JobStatus.cancelled` and the `assessment` SSE event
  type already existed; the bugs were in which of them the orchestrator chose.
- **F-04 also covers the missing-row case.** The original finding was `assessment.target is None`. The
  pipeline can equally be handed an id whose assessment row is gone entirely; both now broadcast a terminal
  `failed` event so an SSE subscriber cannot hang on keep-alives.
- **F-17 changed a test, not just code.** `test_get_settings_creates_default_task_configs` asserted the bug
  (a GET creating rows). It is now `test_get_settings_returns_seeded_task_configs`, and the autouse fixture
  seeds the rows itself to model startup. `_ensure_task_configs(db)` survives as a non-committing helper for
  the `PUT /tasks/{task}` write path, so that endpoint still self-heals a missing row.
- **Cancelled-before-start jobs have no log line.** `_mark_cancelled` only flips status; the `[cancelled]`
  message is written by `_run_job` when a job was already running. Both are correct, they just describe
  different moments.

W2a as-built notes (scope & authorization, not the SSRF guard):

- **Two deviations from the plan.** (1) `--` was **not** added before the nmap target: rejecting a
  leading-dash hostname closes the injection completely, and nmap's own parser does not document `--`, so
  inserting it risked breaking every scan. (2) The host-level SSRF guard is **not** in this wave — it is
  accepted policy but unimplemented, and it is the first item of W2b.
- **Pydantic does not run field validators on defaults.** `authorization_ref` inherited `""` from
  `TargetBase`, so the validator was skipped and an empty reference was accepted. It had to be redeclared
  without a default in `TargetCreate` to become required. Worth remembering for any "make this required"
  change on an inherited field.
- **`PUT` → `PATCH` was safe** because nothing called it: the frontend only POSTs and GETs `/api/targets`.
  Verified by grep before changing the verb; it now returns 405.
- **The UI had to move with the contract**, or the change would have been a trap: the authorization field is
  now `required`, and the `full_intrusive` option is disabled for non-admins instead of letting them submit
  and collect a 403.
- **Downgrade notes are appended, not assigned.** The first attempt set `assessment.notes` before the run
  and the "Pipeline complete; ..." line overwrote it; the downgrade note is now composed into the final
  string.

W2b as-built notes (host guard + secret handling):

- **The guard resolves, it does not string-match.** `http://localhost`, `http://127.0.0.1` and a DNS name
  pointing at `10.0.0.5` are the same target, so `check_host` resolves first and classifies the address.
  `classify_address` is shared with the LLM-provider validation, so there is one definition of "safe to
  talk to", not two.
- **Redirects are covered by an httpx request hook**, verified empirically before relying on it: a 302
  chain fires the hook once per hop (2 firings for 2 requests). A public, authorized target can no longer
  bounce the prober onto an internal address.
- **ZAP is the exception.** It crawls and attacks on its own, so its hops cannot be policed — the target
  URL is checked before being handed over, and that limit is documented in the module.
- **A test was asserting the vulnerability again.** `test_acknowledgment_is_sticky_on_later_updates`
  required that rotating a key or repointing a provider reuse the old acknowledgement. It is now
  `test_acknowledgment_covers_a_no_op_update` plus `test_changing_the_endpoint_re_requires_the_acknowledgment`.
- **The UI had to move with the contract, again.** The Ollama preset points at `http://localhost:11434`,
  which now needs `local_endpoint`. Rather than add a second thing to tick, the flag is derived from the
  URL the admin already chose (`isLocalEndpointUrl`), and the form explains it.
- **`local_endpoint` is not persisted.** There is no column for it; it only gates the write. The
  acknowledged-at timestamp already records consent. Persisting the acknowledged host would be a nicer
  audit trail and is left as a W4 candidate.
- **Disabled providers are exempt from the re-ack.** A disabled provider sends nothing, so storing a key
  for later is not a disclosure; enabling it re-enters the gate.

W4 as-built notes (truthful totals, persistence, lifecycle):

- **P06 chose the header.** `GET /api/findings` keeps the `list[FindingOut]` body, gains `limit`/`offset`
  (default 200, max 500) and always sends `X-Total-Count` computed from the same filtered query. CORS
  exposes it for the Vite origin. The dashboard reads four `limit=1&status=…` totals instead of deriving a
  percentage from the capped sample; the severity and per-run charts keep the caveat because they still
  sample.
- **F-39 enabled WAL, not foreign keys.** `journal_mode=WAL`, `busy_timeout=5000`,
  `synchronous=NORMAL` are set on connect. `PRAGMA foreign_keys` is deliberately **not** enabled: the
  declared FKs have no cascade rules, so switching it on would turn target deletion into a 500 instead of
  the current silent orphaning. That remains the documented blocker.
- **The SSE endpoint snapshots, closes, then streams.** `_detail()` and the terminal line are materialised
  before `db.close()`, so a long stream no longer holds a read transaction while workers try to commit.
  `get_db`'s finalizer closes the already-closed session, which SQLAlchemy treats as a no-op.
- **`EVENT_QUEUE_SIZE = 500` drops the oldest, never the terminal event.** The terminal `assessment` event
  is always the last broadcast, so a full queue can only shed older lines; the snapshot recovers state for a
  client that fell too far behind.
- **Log commits are batched, not the log.** `emit_log`/`emit_progress` still mutate the ORM row and
  broadcast immediately (the SSE stays live); `_CommitBatcher` flushes every 20 records or 2 seconds, and
  `_run_job`'s `finally` commits whatever is left.
- **F-40 needed a dedup step, not just an index.** A partial unique index
  (`WHERE status = 'pending'`) makes the race impossible going forward, but a database that already had two
  pending rows would fail the index build. `ensure_sqlite_indexes` settles duplicates first (keeps
  `MAX(id)`, marks the rest `failed`), then creates the index; `create_report` still returns the winner
  with 202 when `IntegrityError` fires.
- **F-32 shares the unlink helpers.** `unlink_evidence_file` and `unlink_report_file` live beside their
  routers and are called by both the DELETE endpoints and target deletion. Rows orphaned by a target
  delete are still left in place — the same foreign-key blocker as above.
- **F-16 records every answer, including failures.** Interpretation writes one `AIOutput` row per provider
  attempt (success or error) with the redacted prompt/response, and none when no provider is configured, so
  the audit table matches what `models/llm.py` promises.
- **F-31's "use the total in the report" needed no change.** `build_report_context` was already uncapped;
  the bug was only that the API capped silently. It now carries a comment saying so, and a test asserts the
  API header and the report context count agree.

W5 as-built notes (audit close-out):

- **F-35 was a lost update, not a lock error.** The probe opened two sessions on one finding: SQLite did not
  raise "database is locked", and SQLAlchemy only wrote the dirty columns, so both commits succeeded. Two
  assessors who both loaded `ai_candidate` could therefore record opposing decisions and the second one
  silently won. The endpoint now compare-and-swaps on the status it validated
  (`UPDATE ... WHERE id = ? AND status = <read status>`); no row matched means the caller gets a 409 and
  reloads. No version column and no contract change. Field-only patches (notes, severity, score) stay
  last-write-wins on purpose - there is no state machine to protect.
- **F-34's test asserts statements, not seconds.** `selectinload(Finding.evidence)` turns one SELECT per
  finding into one batched SELECT; the regression test counts `FROM evidence` statements during
  `build_report_context` and fails when the option is removed (verified by temporarily removing it).
- **F-38 costs every live session once.** `users.token_version` is stamped into the JWT as `tv`, the claim
  is required, and change-password increments the column. Tokens issued before the deploy carry no `tv` and
  are rejected, so the first boot after this change logs everyone out - that is the feature, not a
  regression, and it is recorded in `docs/auth-checklist.md`. Role changes need no bump because
  `get_current_user` reloads the row every request.
- **F-19 stays parked.** Diagnosing whether a non-OpenAI endpoint rejects `reasoning_effort` needs a live
  provider key, and the database has none. Gating it on catalog metadata without that evidence risks
  dropping effort for models whose metadata is incomplete; the honest state is "documented, unverified".

Source: read-only audit of 2026-11-13 (five parallel module audits, each claim re-verified against  
source). This is a working plan, not a decision record: `docs/PLAN.md` and `docs/TASK_PLAN.md` are  
unchanged and stay frozen until the steward logs accepted proposals.

> Note to M5 (steward): this is a new additive file in your area, filed as a working plan rather than a  
> decision record. The four proposals it schedules (`05`–`08`) still go through your adopted-changes table.



---

## 1. Scope and guardrails

**In scope:** defects in M1–M4 implementation code. **Out of scope:** everything M5 — tool installs  
(Nmap / ZAP / Playwright Chromium), QA harness, evidence pack, deployment, documentation deliverables,  
and the frontend test-harness gap. The committed default `SECRET_KEY` / `admin123` bootstrap, rate  
limiting, security headers and CORS hardening are also parked as M5 deploy hardening. Where a fix has  
both a code half and a config half, only the code half is scheduled here (see F-37, F-20).

**Non-negotiable hard rules** (AGENTS.md): human verification, intensity gate, authorized targets only,  
secret redaction. No fix may weaken any of them. In particular, AI-generated findings stay  
`ai_candidate`; the only path to `verified` remains the assessor/admin PATCH in `findings.py`.

**Ownership.** The matrix in `docs/TASK_PLAN.md` assigns accountability, not exclusivity. M1 fixes M1  
files directly (`scanner/**`, `api/assessments.py`). M2/M3/M4 fixes are **assigned to their owners**;  
if M1 lands any of them as a minimal unblock, the commit is `fix(<module>): ...` with a `Note to Mx`  
hand-off. Files not covered by the matrix (`schemas/common.py`, `schemas/assessment.py`, `core/deps.py`,  
`core/security.py`, `database.py`, `config.py`, `reporting.py`, `evidence_capture.py`) are grouped as  
**Shared core (unassigned)**; the steward should assign them, and this plan proposes M1 for the backend  
ones. That assignment is itself a governance gap worth resolving at the first sync.

**Contract changes go through proposals, never drive-by edits.** Four are needed (`05`–`08`, §4).  
Wave 1 is a decision gate: no Wave 2 code lands before those proposals are accepted or rejected.

**Assumption to confirm:** each owner implements their own wave, with M1 covering M1 and Shared core.  
If the team would rather have M1 land all fixes as minimal cross-module edits, the wave ownership column  
stays the same but the commit protocol in §6 changes.

---

## 2. Finding register

Severity: **H** high / **M** medium / **L** low. Size: **S** isolated (≈1–10 lines) / **M** localized  
refactor / **L** multi-file or contract-level. `P` = needs a proposal. `V` = needs live verification  
before it can be called a bug.

Two M2 findings were omitted from the audit's chat summary and are restored here: **F-18** (provider  
`base_url` SSRF / ack not re-required) and **F-20** (Fernet `InvalidToken` on secret rotation).

| ID   | Sev | Owner       | Finding                                                                                                                    | Files                                                                                                                             | Size | Wave    | P        |
| ---- | --- | ----------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | -------- |
| F-01 | H   | M1          | nmap calls `.decode()` on a decoded `str`; every successful run crashes                                                    | `scanner/nmap_runner.py:154`                                                                                                      | S    | W0      |          |
| F-02 | H   | M1 + Shared | Intensity gate self-authorized, never re-checked; `base_url` unvalidated, authorization optional                           | `api/assessments.py:48`, `api/targets.py:30,56,62`, `schemas/common.py:47-51`, `scanner/orchestrator.py:37`, `scanner/base.py:59` | L    | W2      | P05      |
| F-03 | M   | M1          | Cancel during AI interpretation is ignored; assessment still written `completed`                                           | `scanner/orchestrator.py:91-104`                                                                                                  | S    | W3      |          |
| F-04 | M   | M1          | Early `return` leaves assessment `running` forever, no terminal SSE event                                                  | `scanner/orchestrator.py:69-70`                                                                                                   | S    | W3      |          |
| F-05 | M   | M1          | Cancelled runner is recorded `failed`, not `cancelled`                                                                     | `scanner/orchestrator.py:189-190`                                                                                                 | S    | W3      |          |
| F-06 | M   | M1          | TLS expiry checks are dead code (`not_after` string vs `not_after_dt` datetime)                                            | `scanner/prober/checks.py:122,218`, `prober/__init__.py:54`                                                                       | S    | W0      |          |
| F-07 | M   | M1          | DNS runner ignores cancellation; `getaddrinfo` has no timeout                                                              | `scanner/dns_runner.py:35,57-85`                                                                                                  | M    | W2      |          |
| F-08 | M   | M1          | No guard against two concurrent assessments on one target                                                                  | `api/assessments.py:37-81`                                                                                                        | S    | W2      |          |
| F-09 | L   | M1          | Unbounded SSE queue + a `db.commit()` per log line                                                                         | `scanner/orchestrator.py:51,165`                                                                                                  | M    | W4      |          |
| F-10 | L   | M1          | Leading-dash hostname is parsed as an nmap option                                                                          | `scanner/nmap_runner.py:36-46,109`                                                                                                | S    | W2 (V)  |          |
| F-11 | M   | M1 ↔ M4     | `capture_http_transcript` has no pipeline call site; `http_transcript` evidence never produced                             | `evidence_capture.py:8-9`, `scanner/normalize.py`                                                                                 | S    | W4      |          |
| F-12 | M   | M2          | `_parse_summary` strips only the opening code fence; fenced JSON always fails                                              | `ai/summarize.py:101-107`                                                                                                         | S    | W0      |          |
| F-13 | M   | M2          | Redaction misses bare `AIza…` / generic base64 tokens; truncates multi-word secrets                                        | `ai/redaction.py:49-85`                                                                                                           | M    | W2      |          |
| F-14 | M   | M2          | Catalog stale-write race defeats `invalidate()` during an in-flight fetch                                                  | `ai/catalog.py:109-126`                                                                                                           | S    | W3      |          |
| F-15 | M   | M2          | Provider error body (may echo the key) reaches notes, SSE logs and `/test`                                                 | `ai/client.py:153`, `ai/interpret.py:106`, `api/settings_llm.py:288`                                                              | S    | W2      |          |
| F-16 | M   | M2          | Interpretation writes zero `AIOutput` rows; promised audit trail does not exist                                            | `ai/interpret.py`, `models/llm.py:71-75`                                                                                          | M    | W4      |          |
| F-17 | L   | M2          | `_ensure_task_configs` writes on a viewer GET; concurrent first-load insert can 500                                        | `api/settings_llm.py:115,131`                                                                                                     | S    | W3      |          |
| F-18 | H   | M2          | Unvalidated provider `base_url` sends the decrypted key to any host; base_url change does not re-prompt the discretion ack | `api/settings_llm.py:150-176,241`, `ai/client.py:105`, `ai/catalog.py:96`                                                         | M    | W2      | P07      |
| F-19 | L   | M2          | `reasoning_effort` sent for any model with a saved effort, despite a comment saying otherwise                              | `ai/client.py:88-90`, `lib/model-effort.ts:43`                                                                                    | S    | W5 (V)  |          |
| F-20 | H   | M2 + Shared | Rotating `secret_key` makes every stored key undecryptable; `InvalidToken` unhandled → 500 on `/test` and `/models`        | `models/llm.py:28-30`, `ai/client.py:105`, `api/settings_llm.py:287`                                                              | M    | W2      | P08      |
| F-21 | H   | M3          | Logout does not clear the TanStack Query cache; next user sees prior user's data                                           | `lib/auth.tsx:38-41`                                                                                                              | S    | W0      |          |
| F-22 | H   | M3          | JobTimeline axis freezes at the last finished job; running bar is clipped at 100%                                          | `pages/assessment-run.tsx:81`                                                                                                     | S    | W0      |          |
| F-23 | H   | M3          | SSE stream never reconnects; live log dies permanently on a mid-stream drop                                                | `lib/scan-events.ts:29-83`                                                                                                        | M    | W1      |          |
| F-24 | M   | M3          | 401 handler excludes a nonexistent `/auth/token` path; wrong current password logs the user out and hard-redirects         | `lib/api.ts:37`                                                                                                                   | S    | W0      |          |
| F-25 | M   | M3          | Shortcuts fire inside dialogs; armed `g` leaks across typing and route changes                                             | `lib/shortcuts.ts:28-33,89-113`                                                                                                   | S    | W0      |          |
| F-26 | M   | M3          | "N of M findings reviewed" uses the 200-cap as M, with no caveat                                                           | `pages/dashboard.tsx:119,233`                                                                                                     | S    | W1 + W4 | P06      |
| F-27 | L   | M3          | Report download uses raw `fetch`, bypassing the 401 session handler                                                        | `pages/assessment-reports.tsx:33-47`                                                                                              | S    | W4      |          |
| F-28 | L   | M3          | Delete mutation's stale error is shown in the next dialog                                                                  | `pages/assessment-reports.tsx:87-94,206`                                                                                          | S    | W0      |          |
| F-29 | M   | M4          | `db.commit()` outside `try` leaves a report `pending` forever — and `pending` is undeletable (409)                         | `reporting.py:187-202`, `api/reports.py:98`                                                                                       | S    | W0      |          |
| F-30 | M   | M4          | No pending/idempotency guard; double-submit creates duplicate PDFs                                                         | `api/reports.py:32-46`                                                                                                            | S    | W1      |          |
| F-31 | M   | M4          | `limit(200)` with no pagination metadata; UI and PDF disagree on totals                                                    | `api/findings.py:55`, `reporting.py:53-54`                                                                                        | M    | W4      | P06      |
| F-32 | L   | M4          | No evidence DELETE route; uploaded blobs and failed-report PDFs accumulate                                                 | `api/evidence.py`, `api/targets.py:69-79`, `reporting.py:192`                                                                     | M    | W4      |          |
| F-33 | L   | M4          | Raw Playwright error (with local paths) reflected to the client                                                            | `api/reports.py:70`, `reporting.py:167-170`                                                                                       | S    | W0      |          |
| F-34 | L   | M4          | N+1 in report context building                                                                                             | `reporting.py:57,71,90`                                                                                                           | S    | W5      |          |
| F-35 | M   | M4          | No optimistic concurrency on finding PATCH; overlapping decisions lost                                                     | `api/findings.py:94-119`                                                                                                          | M    | W5 (V)  |          |
| F-36 | M   | Shared      | `int(payload["sub"])` outside `try` → unhandled 500 on a malformed signed token                                            | `core/deps.py:24-27`                                                                                                              | S    | W0      |          |
| F-37 | M   | Shared      | `jwt.decode` does not require `exp`/`sub`; a signed token with no `exp` never expires                                      | `core/security.py:30`                                                                                                             | S    | W2      | P08      |
| F-38 | M   | Shared      | Password change does not revoke existing 12h JWTs (documented, deliberate)                                                 | `api/auth.py:47-48`                                                                                                               | L    | W5      | decision |
| F-39 | M   | Shared      | No WAL / `busy_timeout`; SSE holds a DB session for the whole stream while workers commit                                  | `database.py:11-14,36-41`, `api/assessments.py:104-143`                                                                           | M    | W4      |          |
| F-40 | L   | M4          | Report idempotency is a pre-check only; two requests inside the same window can both insert                              | `api/reports.py` create_report, needs a partial unique index                                                                      | S    | W4      |          |

**Discarded as false positives** (do not schedule): `LLMProviderOut` leaking `api_key_encrypted`  
(Pydantic `extra="ignore"`); any AI path auto-verifying a finding; `risk.py` arithmetic; evidence  
path-traversal guards; POST `/report` singular vs GET `/reports` plural; finding-status enum and  
`finding-review` query invalidations. All were re-checked against source.

---

## 3. Wave sequence

Entry condition for W0: this plan reviewed. Each wave exits only when §5's gate is green and its  
commits are pushed. Waves are ordered by dependency, not by severity — W0 buys the most correctness  
per line changed and unblocks honest verification of everything after it.

### W0 — Zero-risk correctness (no contracts, no decisions)

Eleven isolated fixes. Land first so later waves are verified against a correct baseline rather than a
broken one.

**As-built corrections to the original W0 estimate:** ten new backend regression tests were added
(F-01, F-06, F-12, F-29 ×3, F-33 ×2, F-36). The five M3 fixes have **no** automated regression tests
because the frontend has no test harness — that gap is M5-owned and explicitly out of scope. They were
verified by build, lint and live browser checks in dark, light and 720px viewports instead. F-29 also
exceeded the ≤10-line estimate: guarding the final commit plus adding stale-pending recovery in
`api/reports.py` needed a helper and a small API behaviour change (over-age `pending` rows now settle to
`failed` instead of staying undeletable forever).

| Fix  | Change                                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | `parse_nmap_xml(stdout)` — drop the second `.decode()`. Add a test that runs `NmapRunner.run` against a mocked subprocess returning the XML fixture; current tests only cover `parse_nmap_xml`, which is why 178 pass today. |
| F-06 | `check_tls` reads `cert.get("not_after_dt")`; keep the string form for serialization. Test with an expired cert.                                                                                                             |
| F-12 | Reuse `interpret._strip_fences` (or strip the trailing fence) in `summarize._parse_summary`. Add a test with a fenced JSON response (opening and closing triple backticks).                                                  |
| F-21 | In `logout()`, `cancelQueries()` + `clear()` via `useQueryClient()`. Test by logging in as B after A and asserting no cached findings.                                                                                       |
| F-22 | `const finish = Math.max(latest ?? 0, now ?? 0, origin + 1)`. Add a case with one finished + one running job.                                                                                                                |
| F-24 | Exclude all `/api/auth/*` paths from the forced logout; preserve the backend `detail`; avoid `window.location.href` so router `state.from` survives.                                                                         |
| F-25 | Bail when `event.target.closest('[role="dialog"],[data-radix-popper-content-wrapper]')`; clear `pending` on typing-target keys and on route change.                                                                          |
| F-28 | `remove.reset()` on dialog open/close.                                                                                                                                                                                       |
| F-29 | Wrap the whole `run_report_job` body in `try/except` that always sets `failed` + `finished_at`; also add a pending timeout/heartbeat so a row from a crashed process becomes deletable.                                      |
| F-33 | Return a generic message; keep the detailed error on the row for the `<details>` toggle, sanitized of absolute paths.                                                                                                        |
| F-36 | Move `int(payload["sub"])` inside the `try`, catch `(KeyError, ValueError, TypeError)` → 401.                                                                                                                                |


Exit: `pytest` ≥ 178 + new tests; build/lint at baseline; dark + light visual pass on dashboard, run page and report dialog.

### W1 — Decision gate and quick wins

- **Write proposals `05`–`08`** (§4). Steward records accepted/rejected in `docs/TASK_PLAN.md` §Adopted changes. **No Wave 2 code lands before this.**
- **F-23** SSE reconnect: retry loop with backoff, re-read `getToken()` per attempt, stop on `controller.signal.aborted` or a terminal `assessment` event. This also removes the pre-existing `setState-in-effect` lint warning in `scan-events.ts` — **update the lint baseline from 8 to 7 warnings** in `AGENTS.md`.
- **F-30** Reject with 409 when a `pending` report already exists for the assessment; enforce with a unique partial index, not just a pre-check (two tabs can race).
- **F-26 (stopgap)** Relabel the metric "of the 200 most recent findings" so the dashboard stops lying immediately; W4 replaces it with a real total after P06.

### W2 — Hard-rule security (depends on W1 acceptance)

The largest wave. All four hard rules are touched; treat as one coherent workstream, not four patches.

1. **Scope & authorization (P05, M1 + Shared).** Split `TargetCreate` into create + `TargetPatch` (partial) so PUT stops resetting `authorization_ref` and scope lists. Validate `base_url` as `HttpUrl`. Add one shared helper in `scanner/` that resolves the host and rejects loopback / link-local / cloud-metadata ranges, reused by `dns`, `nmap`, `prober`, `zap`. Re-validate redirects instead of blind `follow_redirects=True`. Require a non-empty `authorization_ref` and assert the host is in `in_scope_assets`. Make intensity escalation admin-only. Re-read `target.allowed_intensity` at job-scheduling time in `orchestrator.plan_tools` and skip intrusive tools if it was downgraded. Add `--` before the nmap target and reject leading-dash hostnames (F-10). Add `ctx.cancelled()` checks and a resolver timeout to `dns_runner` (F-07). Add the concurrent-assessment 409 (F-08). Correct the two docstrings in `assessments.py` / `targets.py` that claim a re-check that did not exist.
2. **Secret handling (M2).** Prefix-agnostic base64/entropy scrubbing + wider keyword list + full-value redaction (F-13). Redact or drop `resp.text` in `LLMRequestError` (F-15). Provider `base_url` allowlist and re-acknowledge the discretion gate whenever `base_url` or `api_key` changes (P07 / F-18).
3. **Key lifecycle (P08 / F-20).** Catch `InvalidToken` explicitly in `client.py`, `catalog.py`, `test_connection`; return a clean "key unreadable" state rather than a 500. Separate the Fernet key from the JWT key with a versioned `ENCRYPTION_KEY`, plus a one-time re-encrypt migration for existing rows.
4. **Token claims (P08 / F-37).** `jwt.decode(..., options={"require": ["exp", "sub"]})`. Note this invalidates any token missing those claims — none are issued by `create_access_token`, so impact is limited to forged/legacy tokens.

Verification: new tests for private-IP rejection, redirect-to-private-IP, mid-run intensity downgrade, concurrent create, leading-dash host, fenced summary, redaction of a bare Google key, `InvalidToken` degradation, and a token with no `exp`.

### W3 — State machines and data integrity (independent of W2)

- **M1:** F-03 re-check `cancel_event` after `_run_interpret`; F-04 emit `failed` + a terminal SSE event before the early `return`; F-05 map cancellation to `JobStatus.cancelled` in `_run_job`.
- **M2:** F-14 generation token per provider so an in-flight catalog fetch cannot repopulate a cache that `invalidate()` cleared; F-17 move `_ensure_task_configs` to startup with insert-or-ignore.

### W4 — Truthful UI, persistence, and lifecycle (depends on P06)

- **P06 (M4):** keep the `list[FindingOut]` response shape; add bounded `limit`/`offset` query params and an `X-Total-Count` header (or a separate `/api/findings/stats`). Purely additive — no frontend type break.
- **M3:** F-26 replace the stopgap label with the real total; F-27 route report download through an auth-aware helper.
- **Shared:** F-39 enable WAL + `busy_timeout`, snapshot-and-close the SSE session before streaming, bound the SSE queue (F-09) and batch log flushes (F-09).
- **M1 ↔ M4:** F-11 wire `capture_http_transcript` into `normalize.create_candidate` — a one-line call, with a `Note to M4` in the commit since the helper is M4-owned.
- **M4:** F-32 add `DELETE /evidence/{id}` with the same `is_relative_to` guard as download; unlink files on finding/report/target deletion; F-31 use the new total in `reporting.build_report_context`.
- **M2:** F-16 write an `AIOutput` row for interpretation (and on failure paths), so the audit trail matches `models/llm.py`'s promise.

### W5 — Decision and verification close-out (landed 2026-11-14)

Landed: F-34, F-35 and F-38 (proposal 09). F-19 stays parked until a live provider key exists; the
as-built notes in the wave-status section record why.

- **F-38** token revocation on password change — a `token_version` claim invalidates every current session; decide before designing.
- **F-35** optimistic concurrency on finding PATCH — write a two-overlapping-PATCH test first; SQLite may raise `database is locked` instead of losing an update, so the bug is unconfirmed.
- **F-19** confirm with a live provider whether non-OpenAI endpoints reject `reasoning_effort`; fix only if reproducible.
- **F-34** `selectinload(Finding.evidence)` — pure latency cleanup, no correctness impact.

---

## 4. Proposal pack

Four new files under `docs/proposals/`, using `TEMPLATE.md`. Next free numbers are `05`–`08`.

| #  | Title                                                 | Owner            | Contract change                                                                                                 | Why it needs a proposal                                                                                    |
| -- | ----------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 05 | Target scope & authorization contract                 | M1               | `TargetCreate` split, `base_url` type, required `authorization_ref`, PUT→PATCH, admin-only intensity escalation | Making an optional field required and changing the update verb are **not additive**; needs team consensus. |
| 06 | Findings list totals & pagination                     | M4               | Query params + `X-Total-Count` header (response body unchanged)                                                 | Additive, but changes the API sketch in `TASK_PLAN.md`; steward must update contracts.                     |
| 07 | LLM provider endpoint validation & re-acknowledgement | M2               | New 400s on `base_url`, ack re-required on base_url/key change                                                  | Changes the discretion-gate contract in `settings_llm.py`.                                                 |
| 08 | JWT claim requirements & encryption-key separation    | M1 (Shared core) | `require=["exp","sub"]`, new `ENCRYPTION_KEY`, versioned rows                                                   | Touches auth and at-rest encryption; re-encryption migration needs an agreed cutover.                      |

Each proposal must state its fallback (the current behaviour) and how `main` stays green while it is  
built, per `TEMPLATE.md`. Accepted proposals are logged by the steward in `TASK_PLAN.md` §Adopted  
changes; rejected ones get a one-line reason.

---

## 5. Verification gate (every wave)

1. `cd backend && .venv/Scripts/python.exe -m pytest tests -q` — baseline **178 passed**, monotonically increasing as regression tests land. Any drop blocks the wave.
2. `cd frontend && npm run build` — 0 errors.
3. `npm run lint` — 0 errors; **8 warnings** baseline (all pre-existing in `GradientASCII.tsx` and `scan-events.ts`). W1's SSE work should remove one; re-baseline `AGENTS.md` when it does. Never add a ninth.
4. UI changes verified in the running app in **both dark and light themes**, plus one narrow viewport.
5. Re-refresh `AGENTS.md` "Current state / next up" in the wave's final commit: re-date the snapshot, update the module rows, and record the new build + test counts. Sync `README.md` build-order rows only if a milestone state changes.

Operational gotchas already learned the hard way: restart uvicorn after adding routes (`--reload` did  
not pick them up twice); chain the whole browser flow (login → action → screenshot) in one invocation  
because the automation session does not persist; use `curl http://localhost:PORT` rather than  
`127.0.0.1` (an HTTP proxy in this shell makes the latter return a misleading 502).

---

## 6. Commit and hand-off protocol

- One commit per module per wave, Conventional Commits, detailed bodies. `fix(<module>): ...` for  
  defects, `feat(...)`, only for genuinely additive behaviour.
- Cross-module minimal edits get a `Note to Mx (name)` in the body describing exactly what was touched  
  and what the owner should re-check. M1's edits to M4-owned `evidence_capture.py` wiring, and any  
  M1 edits to `frontend/**`, fall here.
- Stage by explicit path. `git pull --rebase` before every push. Verify `HEAD == origin/main` after.
- Proposals are committed separately from the code they authorise.
- Never commit runtime artefacts: `platform.db`, `backend/evidence/*`, `backend/reports/*`, screenshots.

---

## 7. Open decisions for the next sync

1. **Local lab targets vs SSRF blocking (blocks P05).** The intended demo target (Juice Shop) may run on  
   `localhost` / `127.0.0.1`, so a blanket private-IP ban would break the workflow. Recommendation:  
   allow private/link-local hosts **only** when `authorization_ref` is non-empty **and** the exact host  
   is listed in `in_scope_assets`; block `169.254.169.254` and other cloud-metadata ranges  
   unconditionally. Needs sign-off.
2. **Fernet cutover (blocks P08).** Separating `ENCRYPTION_KEY` requires re-encrypting existing provider  
   rows before the switch. Who runs the migration, and is a one-time maintenance window acceptable?
3. **Token revocation (F-38).** **Decided 2026-11-14:** add `token_version` (invalidates all active sessions
   on deploy) rather than keep the documented 12 h window. Shipped in W5; see
   [proposal 09](proposals/09-token-revocation.md) and `TASK_PLAN.md` § Adopted changes.
4. **Execution scope.** Do owners implement their own waves, or does M1 land all fixes as minimal  
   cross-module edits with hand-off notes? §1 assumes the former.
5. **Shared core ownership.** Assign `core/**`, `schemas/**`, `database.py`, `config.py`, `reporting.py`  
   in the ownership matrix — currently unassigned, which is why F-36/F-37/F-39 have no clear owner.

---

## 8. Explicitly not in this plan

M5 T5.1 tool installs, the evidence pack, `docs/proposal.md`, `docs/system-design.md`,  
`docs/qa-checklist.md`, `scripts/setup-dev.ps1`, a frontend Vitest/Playwright harness, integration-wave  
rehearsal I1–I4, the default `SECRET_KEY`/`admin123` bootstrap, login rate limiting,  
`TrustedHostMiddleware` / security headers, CORS tightening, and startup DDL/seed race hardening.  
These were found by the audit but excluded per the brief.
