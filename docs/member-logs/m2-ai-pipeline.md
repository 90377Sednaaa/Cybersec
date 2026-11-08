# Member Log M2 — AI Pipeline

> Build log for M2 (owner: member 2). Written at the end of the M2 build session (2026-11-08).
> Purpose: document what was built, the approach taken, every decision made and why, and the verification
> evidence — so the owning member can explain and defend each choice in the final presentation and oral
> defense (rubric: "Understanding of individual contribution", "Understanding of AI integration and
> limitations", "Security methodology and framework references").

## What was built (per task)

| Task | Delivered | Files |
|---|---|---|
| T2.0 Contract | Settings API shapes (`GET/POST/PUT /api/settings/llm`, `POST /api/settings/llm/test`), interpretation JSON schema, redaction spec; LLM schemas committed | `app/schemas/common.py` (`LLMProviderIn/Out`, `LLMTaskOut/Update`, `LLMSettingsOut`, `LLMTestConnectionIn/Out`) |
| T2.1 Provider client | OpenAI-compatible chat client, per-task model/temperature, Fernet-decrypted key from DB, timeout + 1 retry, `reasoning_content` handling, Ollama fallback (no-auth) profile, mock-transport test seam | `app/ai/client.py` |
| T2.2 Settings backend | Provider CRUD (key write-only, never returned), per-task config, test-connection endpoint returning model + latency, admin-only mutations, discretion gate | `app/api/settings_llm.py`, `app/main.py` (router registration) |
| T2.3 Redaction | Pattern scrub (passwords, tokens, auth/cookie headers, private keys, `.env` contents, JWTs, high-entropy hex) + per-target deny list; applied before every LLM call | `app/ai/redaction.py` |
| T2.4 Interpreter | Raw tool results → `ai_candidate` findings via normalizer dedup, JSON-schema-constrained output with validate-retry, confidence score, wired as the orchestrator's post-normalize step | `app/ai/interpret.py`, `app/scanner/orchestrator.py` (hook) |
| T2.5 Summarizer | Executive summary + per-finding explanation/remediation from **verified** findings, persisted in the new `ai_outputs` audit table | `app/ai/summarize.py`, `app/models/llm.py` (`AIOutput`) |
| Discretion (agreed) | Enabling a provider requires `acknowledged_external_processing=true` (400 otherwise); auditable `acknowledged_external_at` timestamp | `app/models/llm.py`, `app/schemas/common.py`, `app/api/settings_llm.py` |

Supporting: `backend/tests/test_llm_client.py` (11), `test_redaction.py` (24), `test_settings_llm.py` (14), `test_interpret.py` (11), `test_summarize.py` (7) = 67 AI-specific tests, all passing.

## The approach (how it was actually built)

Built AI-assisted ("vibecoding") in one session, task by task following `docs/TASK_PLAN.md`. Working method:

1. **Ethics gate first.** T2.3 redaction was built and proven *before* the interpreter existed, so no code path that calls an LLM could ever be written without the redaction layer already in place. The client composes redaction on every send — there is no "raw" call path.
2. **Mock-first verification.** Every LLM test runs against an `httpx.MockTransport` (a fake OpenAI-compatible responder in-process) via a `transport=` seam in `chat()`. No network, no cost, deterministic. One optional synthetic-data smoke test at the end (no key provided this session).
3. **Degrade, don't fail.** `NoProviderConfigured` (missing/disabled model) and `LLMRequestError` (provider down, unparseable output) are caught at the orchestrator boundary: the assessment always completes with the rule-based candidates, and the skip is appended to `assessment.notes`. AI is an add-on, never a blocker.
4. **Human in charge, mechanically.** The interpreter can only ever insert `ai_candidate` rows with `verified=False`; verified status is M4's state machine and role-guarded. The summarizer reads only `FindingStatus.verified` rows — unverified candidates are filtered out of the prompt before any model call.

## Key decisions and trade-offs (defense talking points)

1. **httpx, not the openai SDK.** The brief asks for an OpenAI-compatible client; one dependency already present (`httpx`) covers it, and a direct POST to `/chat/completions` keeps retry/timeout/transport behavior fully under our control and trivially testable via `MockTransport`.
2. **Fernet key derived from `SECRET_KEY`** (`app/models/llm.py:26-36`) — no separate key file to manage, rotates with the app secret. Key is write-only: `LLMProviderOut` exposes `has_api_key` only; tests assert no key substring appears in any response body.
3. **Redaction is two-layered and adversarial-tested.** Pattern table (compound credential identifiers caught by a suffix-style regex because plain alternation misses `secret_token`) plus per-target deny list (case-insensitive, short terms ignored to avoid mangling). 20 adversarial cases assert the secret substring never survives.
4. **Discretion gate (new, agreed).** Enabling a provider requires `acknowledged_external_processing=true` (400 otherwise) with an auditable `acknowledged_external_at` timestamp — the admin's explicit, recorded consent that redacted scan data may leave the machine. Disabling never requires it; acknowledgment is sticky once recorded.
5. **Interpreter augments, never replaces.** Rule-based candidates (missing header, exposed file, banner) stay with `ai_confidence=1.0`; the interpreter adds non-deterministic findings on top; dedup is by `(assessment, title)` so both sources coexist. Confidence < 0.3 dropped; invalid severity clamped to `low`.
6. **Reasoning-tier model for summaries.** `task=summary` uses the reasoning model (longer 120s timeout); `reasoning_content` is captured separately and never leaks into stored summaries (asserted).
7. **Audit trail.** Every AI output is stored in `ai_outputs` (task, model, assessment/finding, content, timestamp) — the "AI outputs" evidence deliverable and a full record of what the model said, kept separate from human-verified findings.
8. **Orchestrator hook is a minimal, protected cross-module tweak.** `run_pipeline` composes its pipeline summary note first, then `_run_interpret` appends its outcome (never overwrites); wrapped so AI failure never fails a completed scan; `job_id=None` on SSE log lines; target-derived deny list (name, base_url, authorization ref, scope assets).

## Verification evidence

- `pytest`: **134 passed** (3 warnings) — 11 client + 24 redaction + 14 settings + 11 interpret + 7 summarize + 67 pre-existing; full suite green.
- `uvicorn app.main:app` boots clean with the settings router registered; `GET /api/settings/llm` returns default task configs for all four tasks.
- Frontend `npm run build` passes (M2 touched no frontend code; contract hand-off noted for M3).

## Hand-offs

- **M3 (frontend):** Settings dialog copy (discretion notice above the key field: key stored encrypted at rest, redacted scan data may be sent to the chosen provider, AI output is always `ai_candidate` until an assessor verifies); bind the acknowledgment checkbox to `acknowledged_external_processing`; endpoints are `POST/PUT /api/settings/llm/providers`, `PUT /api/settings/llm/tasks/{task}`, `POST /api/settings/llm/test`. `GET /api/settings/llm` for the page load.
- **M4 (findings/reports):** `ai_outputs` (task=summary) rows are the source for the report's AI narrative; `verified_findings_for(assessment_id)` loads the verified set; `summarize_assessment()` returns the stored dict. Interpreter output already lands as `ai_candidate` findings.
- **M5 (steward):** one-line router registration in `main.py` already merged (`app.include_router(settings_llm.router, prefix="/api")`); additive nullable column `llm_providers.acknowledged_external_at` and new table `ai_outputs` — both additive, M2-scoped, no contract break.

## Honest limitations (say these before the examiner finds them)

- **No live LLM call was made this session.** All M2 verification is mock-server; the one synthetic live smoke test (provider key + fixture data) was deferred until a key is configured. The real-provider path (auth, rate limits, reasoning-model behavior) is therefore unproven end-to-end — this is the first thing to validate in I3.
- The redaction layer is pattern-based: it cannot catch a secret that doesn't match a known shape or the per-target deny list. A human review of the redacted prompt before any live run is the belt-and-suspenders (planned for I3).
- The interpreter caps at 10 findings and 6k chars/job of raw output; very large scans will be truncated. Retry is 2 attempts; unparseable output is dropped, not repaired indefinitely.
- `AIOutput.content` stores JSON as text; M4 will parse it. No dedicated "AI outputs" read endpoint yet — M4 reads the table directly (or via a small endpoint added then).
- The Ollama fallback profile is untested against a real daemon (none installed).

## Self-review findings (same day, post-build)

| # | Severity | Defect found | Fix |
|---|---|---|---|
| 1 | High | `LLMProviderOut` (Pydantic) could not serialize the SQLAlchemy row because `has_api_key` is a derived field with no source column — every settings response failed validation. | Added a `model_validator(mode="before")` that derives `has_api_key` from `api_key_encrypted` before field validation. |
| 2 | Medium | `_request_json` in the interpreter was written around a non-existent `cfg_provider_session` shim and a `feedback` parameter that never threaded through; first run produced 0 findings. | Rewrote to take `db` directly and thread `feedback` through the retry loop; `_strip_fences` rewritten with a regex to handle fenced JSON. |
| 3 | Medium | The orchestrator hook's `_interpret` returned a string it never used and could clobber the pipeline summary note if it ran before commit. | Split into `_run_interpret` that appends to `assessment.notes` (never overwrites) and runs in a worker thread; pipeline summary composed first. |
| 4 | Low | `test_pipeline_completes_when_ai_is_down` failed because the first provider reply "no JSON" was parsed as a provider error only after a retry; the note assertion needed the skip message. | Confirmed the graceful-degradation path records "AI interpretation failed" in notes; test passes. |
| 5 | Low | Test fixtures reused the global `viewer@example.com` account, colliding with other test modules' cleanup. | Renamed to `m2-viewer@example.com` in the settings tests. |
| 6 | Low | `httpx` import left in `test_settings_llm.py` after monkeypatching replaced the send function; harmless but noisy. | Removed the unused import. |

Known remaining weaknesses (accepted, documented): redaction is pattern-based; no live provider call yet; `ai_outputs` has no read endpoint (M4 will add or read the table directly); per-finding summary rows are written per verified finding (N+1 inserts inside one transaction — fine for assessment scale).
