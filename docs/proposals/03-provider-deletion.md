# Proposal: delete an AI provider

Proposed by: M1 (90377Sednaaa) · Date: 2026-11-13 · Status: open (implemented, pending team review)

## The idea

Add `DELETE /api/settings/llm/providers/{id}` (admin only, 204) plus a Delete action in AI settings, so an
admin can actually remove a provider instead of leaving it disabled forever. The endpoint clears
`llm_task_configs.provider_id` and `model` for every task that pointed at the row, then deletes the provider
and invalidates its cached model catalog.

Today providers can only be created (`POST`) and edited (`PUT`). `DELETE` is the only verb missing from the
module, and it is the only delete in the whole API besides `DELETE /api/targets/{id}`.

## Why

- **Real gap, not a nicety:** a mis-typed provider stays in the settings list permanently. Disabling it leaves
  dead weight in the UI and in the `llm_providers` table, and there is no way to clear a stored key at all
  (`PUT` with `api_key: ""` means "leave untouched").
- **Rubric:** a complete CRUD admin surface is easier to defend than "you can add but never remove".
- **Demo value:** cleaning up after a provider experiment currently needs a database edit.

## Cost

Roughly one short session. Additive contract: one new endpoint, no existing request or response shape
changed. Touches M2 (`app/api/settings_llm.py`) and M3 (`src/pages/settings.tsx`). Ships with 3 new backend
tests and a clean `npm run build`.

## Risk

- **Dangling task references:** SQLite foreign keys are **not enforced** in this app (no
  `PRAGMA foreign_keys=ON`, no SQLAlchemy listener), so a naive `db.delete(provider)` would leave
  `llm_task_configs.provider_id` pointing at a row that no longer exists. A task would look configured in the
  UI while `resolve_task_config` silently refuses to run it. Mitigation: clear the reference in the same
  transaction, and cover it with a test.
- **Lost model assignment:** the model ID is cleared with the provider, since a model without its provider is
  not a usable configuration. Admins re-pick a model after adding a replacement. The confirmation dialog says so.
- **Accidental deletion:** destructive and irreversible, so the UI requires an explicit confirm step naming the
  provider, and the button is admin-only (403 for viewer/assessor, pinned by a test).
- **Main stays green:** `pytest tests -q` and `npm run build` both pass with the change.

## Out of scope

Deleting assessments, findings, evidence, reports or users. Findings in particular carry the verification
audit trail (`ai_candidate -> verified / false_positive`) that the platform's premise depends on, so they stay
undeletable by design.

## Decision

Filled in at the daily sync: accepted / rejected, one-line reason, and the steward's note about contract or
timeline impact.
