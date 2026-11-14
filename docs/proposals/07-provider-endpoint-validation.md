# Proposal: LLM provider endpoint validation & re-acknowledgement

Proposed by: M1 (draft) · Owner: M2 · Date: 2026-11-14 · Status: **accepted 2026-11-14**

> Accepted by the repo owner (acting steward). Local-endpoint question resolved under Decision; logged in
> `docs/TASK_PLAN.md` § Adopted changes.

## The idea

`base_url` on an LLM provider is a free `String(2048)` with no scheme, host or allowlist validation
(`api/settings_llm.py:150-176`). `ai/client.py:105` and `ai/catalog.py:96` decrypt the stored API key and
send it as `Authorization: Bearer …` to whatever host is configured. Because `api_key` is write-only
(an empty value on PUT means "leave the stored key untouched"), changing only `base_url` on an existing
provider silently redirects a real credential to a new destination. The discretion acknowledgement
(`acknowledged_external_processing`) is checked when the provider is **enabled** and then never again,
so a URL or key change never re-prompts the admin. `GET /providers/{id}/models` is viewer-reachable
(`settings_llm.py:216`) and will trigger that outbound request.

Three changes:

1. Validate `base_url`: require `https://` (allow `http://` only for explicit loopback/local dev), reject
   loopback, link-local, private and cloud-metadata ranges unless the admin explicitly marks the provider
   as a local endpoint, and refuse userinfo/embedded credentials in the URL.
2. Re-require the discretion acknowledgement whenever `base_url` or `api_key` changes, not only on enable.
   Record the acknowledged URL alongside the timestamp so the UI can show "acknowledged for <host>".
3. Never attach `Authorization` to a host that has not passed validation, in both `client.py` and
   `catalog.py`.

## Why

- **Hard rule:** AGENTS.md's "secret redaction" and the discretion gate exist precisely so scan data and
  credentials do not leak to an unapproved third party. A mutable, unvalidated destination defeats both.
- **Security:** this is a credential-exfiltration path with a low bar (one admin action, or a hijacked
  admin session), and the key is never displayed again so the admin cannot notice the change.
- **Auditability:** "which endpoint did we consent to" should be a stored fact, not an inference from a
  timestamp.

## Cost

Roughly half a session in M2 files (`api/settings_llm.py`, `ai/client.py`, `ai/catalog.py`,
`models/llm.py` for the additive acknowledged-host column) plus 4–5 tests (private host rejected, URL
change without ack rejected, key change without ack rejected, no Authorization header on a rejected host,
viewer-triggered catalog fetch). `models/llm.py` column is nullable-with-default — additive per the
Wave-1 rule, using the existing `ensure_sqlite_columns` migration path.

**Contract change.** New 400s on provider create/update and a new required acknowledgement on mutation.
Response shapes stay the same except for one additive field. Steward should update the Wave-1 settings
API sketch on acceptance.

**Needs from another member:** M5 for the API sketch; M3 only if the settings UI wants to surface the
acknowledged host (optional, can be W4).

## Risk

- **Local LLM endpoints (Ollama, LM Studio) are a legitimate use case.** A blanket private-IP ban would
  break them. Mitigation: an explicit "local endpoint" flag on the provider keeps `http://127.0.0.1:11434`
  usable while still requiring a conscious admin choice. **Please confirm at the sync that local
  providers are in scope for the demo.**
- **Existing providers become non-compliant on next edit:** validate on write, not on read, so current
  rows keep working until an admin edits them.
- **Re-ack friction:** an admin rotating a key must tick the box again. That is intentional — a key
  rotation is exactly the moment to re-confirm where the credential goes.
- **Main stays green:** `pytest tests -q` (currently 190), `npm run build` before push; the existing
  `test_settings_llm.py` suite covers the create/update paths and will be extended, not rewritten.
- **Fallback:** keep today's free-form `base_url` and enable-only acknowledgement. W2 then ships only the
  defensive "never attach credentials to a non-allowlisted host" check with a static allowlist, which
  does not need a contract change.

## Decision

**Accepted 2026-11-14** by the repo owner (acting steward).

**Local-endpoint question — resolved:** local LLM endpoints (Ollama, LM Studio, vLLM) stay in scope. The
same policy as proposal 05 applies: a loopback / private `base_url` is allowed, but the admin must set the
explicit local-endpoint flag **and** the discretion acknowledgement is re-required whenever `base_url` or
`api_key` changes. Cloud-metadata ranges remain blocked even with the flag set.

**Contract impact acknowledged:** new 400s on provider create/update and a re-required acknowledgement on
mutation. Response shapes are unchanged except for one additive field recording the acknowledged host.
