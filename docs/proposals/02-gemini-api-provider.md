# Proposal: first-class Google Gemini provider

Proposed by: AI assistant, on behalf of the team · Date: 2026-11-12 · Status: accepted

## The idea

Add a "Google Gemini" provider preset to AI settings so an admin can paste a Google AI Studio key and use
Gemini models directly, instead of only reaching them through OpenRouter. The preset points at Google's
official OpenAI-compatible REST surface, `https://generativelanguage.googleapis.com/v1beta/openai`.
Extends M2 T2.2 (provider settings) and M3 T3.3 (settings UI); no existing request or response shape
is changed, and no Gemini-specific branch is added to the backend.

## Why

- **Demo value:** a second real, well-known provider is configurable with one key and no extra SDK.
- **Rubric:** validates the PLAN.md decision of a provider-agnostic OpenAI-compatible client rather than
  bolting on a vendor-specific code path.
- **Learning value:** shows how an official compatibility layer maps onto our existing chat, catalog and
  redaction plumbing.
- **Speed:** offline model presets plus key auto-detection mean the admin does not type an endpoint by hand.

## Cost

One short session. Additive frontend data only: one `ProviderPreset` entry, one key-detection rule, a
decision record and four backend regression tests. No DB column, no migration, no Pydantic/TS type
change, no new dependency, and nothing required from another member. Rename-resistant: preset matching
also falls back to the base URL.

## Risk

- **Compatibility layer is beta:** Google documents it as beta while feature support expands. Fallback is
  the existing "Custom (OpenAI-compatible)" preset, or OpenRouter for the same models.
- **Model IDs rotate quickly:** the live `GET /models` catalog is authoritative; the ModelPicker keeps a
  custom model ID field and falls back to the offline presets when the catalog is unreachable.
- **Non-chat models in the catalog:** the catalog already filters embedding/audio IDs. If Google lists
  image or video models without architecture metadata they may appear as selectable; choosing a custom
  chat model ID or an offline preset is the workaround. Worth revisiting in the catalog normalizer.
- **Secret exposure:** unchanged. The key is Fernet-encrypted at rest, decrypted only for the outbound
  request, sent as a Bearer token, and redaction still runs before every chat call. Pinned by tests.
- **Main stays green:** `pytest tests -q`, `npm run build`, `npm run lint`. A concurrent session was
  editing shared AI files, so this change deliberately touches only `frontend/src/lib/llm-presets.ts`
  plus new files.

## Decision

Accepted 2026-11-12. Use the official OpenAI-compatible endpoint rather than building a native
`generateContent` adapter: it satisfies the requirement with no frozen-contract change and keeps one chat
client for every provider. A native adapter remains an option if Gemini-only features (thinking budget,
safety settings, caching) are ever needed.

## Configuration

1. In AI settings choose **Add provider**, select **Google Gemini** (or paste an `AIza...` key, which
   selects the preset automatically).
2. Create the key in Google AI Studio and paste it. The endpoint is prefilled with
   `https://generativelanguage.googleapis.com/v1beta/openai`.
3. Enable the provider with the external-processing acknowledgment, assign a model to a task, then use
   **Test connection**. Current stable presets: `gemini-3.8-flash`, `gemini-4-carbon`, `gemini-4-argon`,
   `gemini-3.6-flash`, `gemini-3.5-flash-lite`. Use **Browse models** for the live catalog.
