# Proposal: live model catalog in AI settings

Proposed by: AI assistant, on behalf of the team · Date: 2026-11-12 · Status: open

## The idea

Replace the hardcoded model dropdown in Settings with a searchable browser backed by each provider's live
`/models` catalog. Adds one additive, read-only endpoint `GET /api/settings/llm/providers/{id}/models` and a
`ModelPicker` dialog with search, free/paid pricing, context length, reasoning and structured-output filters,
plus OpenRouter's zero-data-retention filter. The same payload exposes each model's real
`reasoning.supported_efforts` (Gemini: low/medium/high; Claude: low/medium/high/xhigh/max), so the effort control
adapts to the selected model instead of showing one global list. Extends M2 T2.2 (provider settings) and M3 T3.3
(settings page); no existing request or response shape is changed.

## Why

- **Demo value:** shows 380+ real chat models with prices instead of 7 hardcoded IDs, three of which were already
  retired from the OpenRouter catalog.
- **Rubric:** implementation depth plus a genuinely usable admin surface, with an honest offline fallback.
- **Learning value:** provider-agnostic response normalization, TTL caching, and server-side secret handling.
- **Speed:** admins find a valid model in seconds instead of typing IDs blind and discovering failures at scan time.

## Cost

Roughly one working session. Additive contract only: one new GET endpoint, new response schemas, one additive
`LLMTaskConfig.effort` column backfilled to `""` by an idempotent startup migration, and an optional `effort`
field on `LLMTaskUpdate` / `LLMTaskOut`. No change to provider shapes. Needs nothing from another member.
Ships with 10 new backend tests, a clean `npm run build`, and dark/light verification in the running app.

## Risk

- **Provider offline or no `/models` endpoint:** returns `source="unavailable"` with an empty list; the UI falls
  back to the existing static presets and a custom model ID field. The baseline hardcoded dropdown is the fallback.
- **Secret exposure:** the key is decrypted only for the outbound GET, never logged and never returned; pinned by tests.
- **Stale pricing / catalog:** 10 minute in-memory TTL, invalidated on provider create and update.
- **Main stays green:** `pytest tests -q` (160 passed), `npm run build` (0 errors), `npm run lint` (0 errors).

## Decision

Filled in at the daily sync: accepted / rejected, one-line reason, and the steward's note about contract or
timeline impact.
