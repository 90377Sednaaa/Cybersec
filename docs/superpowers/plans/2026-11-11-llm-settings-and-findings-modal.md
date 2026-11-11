# LLM Provider Presets & Findings Center Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve LLM provider setup with pre-filled provider presets, model selection dropdowns, and semantic temperature options, while transforming the findings detail panel from a side sheet into a spacious, readable center modal dialog.

**Architecture:** 
1. Create a shared `src/lib/llm-presets.ts` holding curated presets (OpenRouter, DeepSeek, OpenAI, Groq, Ollama, Custom), known models per provider, and semantic temperature levels (`Precise 0.0`, `Balanced 0.4`, `Creative 0.7`).
2. Integrate provider presets into `src/pages/settings.tsx` so selecting a preset auto-fills name and base URL, leaving only API key entry.
3. Integrate model dropdown and temperature presets into `src/pages/settings-tasks.tsx` for each task row.
4. Convert `FindingDetailSheet` in `src/pages/finding-detail.tsx` to `FindingDetailModal` using `Dialog` with `sm:max-w-3xl` and scrollable contents for optimal log and evidence readability.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui (Radix Dialog, Select, Tabs, Button, Input), TanStack Query.

**Spec:** Brainstorming discussion on 2026-11-11 agreeing on preset base URLs, curated model dropdowns, semantic temperature levels, and center modal layout for finding technical evidence.

## Global Constraints

- **No em-dashes:** Never use `"—"` in UI copy; use standard hyphens `"-"` or en-dashes per AGENTS.md.
- **Theme support:** All additions must look clean in both dark (default) and light themes.
- **Contract integrity:** Backend DB and API schemas (`/api/settings/llm/*`, `/api/findings/*`) remain untouched; all changes are frontend UX enhancements.
- **Build & Lint Gate:** `npm run build` and `npm run lint` must pass with 0 errors.

## Review Focus

1. **Custom Base URL Flexibility:** Selecting a preset pre-fills the URL, but the input remains editable so users with local proxies or custom ports can still adjust it.
2. **Custom Model Fallback:** In the model dropdown, users can choose "Custom model..." to type any model ID, avoiding lock-in when new models release.
3. **Reasoning Model Notes:** Explain semantic temperature values (e.g. `0.0` for Scan Interpretation to avoid hallucinations).
4. **Evidence Code Blocks:** The center modal dialog must provide `max-w-3xl` / `max-h-[85vh]` with `overflow-y-auto` so multi-line HTTP transcripts and tool outputs render without excessive wrapping.
5. **Keyboard & Esc Behavior:** Pressing `Esc` or clicking outside the Dialog closes the modal cleanly and resets selection state.

---

### Task 1: Create LLM Presets & Configuration Helpers

**Files:**
- Create: `frontend/src/lib/llm-presets.ts`

**Interfaces:**
- Produces:
  - `PROVIDER_PRESETS`: array of `{ id, name, baseUrl, defaultModels, placeholderKey, note }`
  - `TEMPERATURE_PRESETS`: array of `{ id, label, value, hint }`
  - `getPresetForBaseUrl(url: string)`: helper to match an existing provider to a preset
  - `getModelsForProvider(providerName: string, baseUrl: string)`: helper returning recommended model strings

- [x] **Step 1: Write `frontend/src/lib/llm-presets.ts`**
- [x] **Step 2: Verify TypeScript compilation**

---

### Task 2: Update Provider Form with Presets

**Files:**
- Modify: `frontend/src/pages/settings.tsx`

**Interfaces:**
- Consumes: `PROVIDER_PRESETS` from `@/lib/llm-presets`

- [x] **Step 1: Add Preset Selector in `ProviderForm`**
- [x] **Step 2: Run verification**

---

### Task 3: Update Task Models & Semantic Temperature Configuration

**Files:**
- Modify: `frontend/src/pages/settings-tasks.tsx`

**Interfaces:**
- Consumes: `TEMPERATURE_PRESETS`, `getModelsForProvider` from `@/lib/llm-presets`

- [x] **Step 1: Upgrade Model & Temperature inputs in `TaskRow`**
- [x] **Step 2: Run verification**

---

### Task 4: Convert Finding Detail from Side Sheet to Center Modal Dialog

**Files:**
- Modify: `frontend/src/pages/finding-detail.tsx`
- Modify: `frontend/src/pages/findings.tsx`

**Interfaces:**
- Consumes: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription` from `@/components/ui/dialog`
- Produces: `FindingDetailModal` (aliased as `FindingDetailSheet` for backward compatibility)

- [x] **Step 1: Replace Radix Sheet with Dialog in `finding-detail.tsx`**
- [x] **Step 2: Update `findings.tsx` trigger**
- [x] **Step 3: Run full verification suite**

---

### Task 5: Commit and Upkeep Documentation

**Files:**
- Modify: `docs/member-logs/m3-frontend.md`
- Modify: `.workbuddy-ai/reports/m3-frontend-audit-2026-11-11.md`
- Modify: `.workbuddy-ai/memory/2026-11-11.md`

- [x] **Step 1: Refresh documentation**
- [ ] **Step 2: Commit and push via Conventional Commit**

```bash
git add frontend/src/lib/llm-presets.ts frontend/src/pages/settings.tsx frontend/src/pages/settings-tasks.tsx frontend/src/pages/finding-detail.tsx frontend/src/pages/findings.tsx docs/
git commit -m "feat(ui): add LLM provider presets, semantic temperature, and center finding modal"
git push origin main
```
