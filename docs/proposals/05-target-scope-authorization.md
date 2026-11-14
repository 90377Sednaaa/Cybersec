# Proposal: target scope & authorization contract

Proposed by: M1 (90377Sednaaa) · Owner: M1 (+ Shared core for schemas) · Date: 2026-11-14 ·
Status: **accepted 2026-11-14**

> Accepted by the repo owner (acting steward) with the local-lab policy recorded under Decision. Logged in
> `docs/TASK_PLAN.md` § Adopted changes.

## The idea

Make the "authorized targets only" and "intensity gate" hard rules actually enforceable rather than
self-declared. Today an assessor can register any `base_url` (an unvalidated `str`), set
`allowed_intensity` to `full_intrusive` themselves, leave `authorization_ref` empty and leave both scope
lists empty — then launch ZAP active scans and `nmap -T4` against it. The gate in
`api/assessments.py:48` only compares the requested intensity to the target's own stored value, so it
cannot reject anything the same role just wrote. The docstrings in `assessments.py:3-6` and `targets.py:3-4`
claim the orchestrator re-checks when scheduling intrusive tools; it does not (`orchestrator.py:37`,
`base.py:59` both use `assessment.intensity`, frozen at creation).

This proposal changes the target/scope contract in five additive-or-tightened ways:

1. Split `TargetCreate` into a create schema and a `TargetPatch` (partial update) schema. `PUT /targets/{id}`
   currently mass-assigns a full `TargetCreate`, so a partial body silently resets `authorization_ref`
   and both scope lists to defaults (`targets.py:62`).
2. Validate `base_url` as a real `HttpUrl`; reject loopback / link-local / private / cloud-metadata
   ranges through one shared helper in `scanner/`, reused by `dns`, `nmap`, `prober` and `zap`. Re-validate
   redirects instead of `follow_redirects=True` with no check.
3. Require a non-empty `authorization_ref` and assert the target host appears in `in_scope_assets`.
4. Make escalation of `allowed_intensity` to `full_intrusive` **admin-only**. Assessors may still create
   and run `passive_safe` targets.
5. Re-read `target.allowed_intensity` at job-scheduling time in the orchestrator and skip intrusive tools
   if it was downgraded after the assessment was approved. Add a 409 for a second concurrent `running`
   assessment on one target. Reject leading-dash hostnames / place `--` before the nmap target.

Extends `TASK_PLAN.md` T1.7 (intensity gate) and the Wave-1 target/assessment API sketch.

## Why

- **Hard rule, not a nice-to-have:** AGENTS.md lists "authorized targets only" and "intensity gate" as
  non-negotiable. Both are currently enforceable only by trusting the operator, which is not enforcement.
- **Security:** unvalidated `base_url` plus `follow_redirects=True` is an SSRF path to
  `169.254.169.254`, RFC1918 services and loopback admin panels.
- **Correctness:** the two docstrings describe a control that does not exist; fixing the code makes the
  documentation true.
- **Demo value:** a scope record with an authorization reference is defensible in a report; an empty one
  is not.

## Cost

Roughly one full session, mostly M1 (`scanner/**`, `api/assessments.py`) plus `schemas/common.py` and
`api/targets.py`. Needs one hand-off to M5 for the frozen API sketch and one to M3 if any target form
validation message changes. About 8–10 new tests (private-IP rejection, redirect-to-private, mid-run
intensity downgrade, concurrent create, leading-dash host, partial PATCH preserving scope).

**Contract change — NOT additive.** Making `authorization_ref` required, tightening `base_url` from `str`
to `HttpUrl`, splitting PUT into create/patch schemas, and adding a 409 on duplicate `running`
assessments all change behaviours a client may currently rely on. That is exactly why this is a proposal
and not a drive-by edit. `docs/TASK_PLAN.md` § Wave 1 sketches must be updated by the steward on acceptance.

**Needs from another member:** M5 to update the API sketch and assign `schemas/common.py` (currently
uncovered by the ownership matrix); a decision from the team on the open question below.

## Risk

- **Local lab targets — RESOLVED (see Decision).** The demo target (OWASP Juice Shop) runs on
  `localhost`, so private / loopback hosts are allowed **only** with a non-empty `authorization_ref`
  **and** the host present in `in_scope_assets`. Cloud-metadata ranges are blocked unconditionally and
  every redirect hop is re-validated. This is the shared helper's policy for both targets and LLM
  provider endpoints (see proposal 07).
- **Existing rows become invalid:** tightening validation on write means current targets with an empty
  `authorization_ref` (including the test fixtures) cannot be re-saved unchanged. Mitigation: validate on
  write, not on read; seed data and test fixtures get a non-empty ref in the same commit.
- **Existing assessments keep their frozen intensity:** the re-check applies at scheduling time, so
  already-completed runs are unaffected and their audit trail stays intact.
- **Main stays green:** each of the five items lands as its own M1 commit with tests; `pytest tests -q`
  (currently 190) and `npm run build` must pass before each push.
- **Fallback:** if this is rejected, the baseline T1.7 API-only gate stays as-is. W2 then ships only the
  non-contract parts (redirect validation, `--` before nmap target, concurrent-create 409 are still
  arguable as fixes — flag separately).

## Decision

**Accepted 2026-11-14** by the repo owner (acting steward).

**Local-lab policy — resolved:** allow private / loopback hosts **only** when `authorization_ref` is
non-empty **and** the exact host is listed in `in_scope_assets`. Cloud-metadata ranges (`169.254.169.254`
and friends) are blocked **unconditionally**, even with an authorization record. Every redirect hop is
re-validated against the same rule.

Reason: this is the only option that keeps the localhost OWASP Juice Shop demo working while still
requiring an auditable authorization record for anything non-public. A hard private-IP ban would have
forced the demo onto a public host; blocking metadata only would have left internal admin panels scannable
with no paper trail.

**Contract impact acknowledged:** required `authorization_ref`, `HttpUrl` `base_url`, `TargetPatch`
instead of the PUT mass-assign, and admin-only `full_intrusive` escalation are all non-additive. Existing
targets with an empty `authorization_ref` cannot be re-saved unchanged — validation applies on write, not
on read, so stored rows keep working until edited.

**Scope cut for this wave:** the orchestrator re-check, `--` before the nmap target, the concurrent-run
409 and DNS cancellation ship as ordinary fixes in the same wave; they are not gated on this contract.
