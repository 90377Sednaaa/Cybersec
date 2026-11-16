# Dual Mode (Automated + Manual Scan Import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to either run automated scanning or manually import external Nmap (XML) and OWASP ZAP (JSON) scan outputs, which are then normalized, interpreted by AI, triaged, and compiled into PDF reports.

**Architecture:** A new multipart endpoint `POST /api/assessments/import` accepts an uploaded Nmap XML or ZAP JSON file for a designated target. It parses the tool output into Aletheia's standard `raw_output` format, stores a completed `Job` and `Assessment`, and routes the data through the existing M1 normalizer and M2 AI interpreter. The frontend provides a polished "Import scan" dialog beside "New assessment" adhering to the Impeccable design system.

**Tech Stack:** FastAPI, Python 3.13, SQLAlchemy 2.0, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query.

**Spec:** Path C approved design: dual-mode scanning supporting both in-process automated tool execution and offline/manual file ingestion.

## Global Constraints

- **Python / DB:** SQLAlchemy 2.0 typed mappings; Pydantic v2 schemas; no breaking changes to existing `AssessmentDetail` response format.
- **Security:** Scans can only be imported for registered targets; target intensity restrictions (`passive_safe`) must be enforced for intrusive ZAP findings.
- **Frontend:** Follow the `impeccable` design floor (Operate mode: precision, clean paddings, 4.5:1 contrast, dark/light theme support, no em-dashes in UI copy).
- **Verification:** `pytest tests -q` must pass; `npm run build` and `npm run lint` must pass with zero errors.

## Review Focus

1. **Malformed File Handling:** Invalid XML or corrupt JSON must fail gracefully with HTTP 422 and a helpful error message, never a 500 server crash.
2. **Target Scope / Authorization:** Ensure the target exists and the user is authenticated as `admin` or `assessor`.
3. **ZAP JSON Variations:** ZAP exports can come in different JSON wrappers (e.g. `{"alerts": [...]}` or `{"@generated": ..., "site": [{"alerts": [...]}]}`); the parser must handle standard ZAP report formats cleanly.
4. **Deduplication:** Normalizer must avoid duplicate findings when imported data shares titles with prior runs.
5. **AI Interpretation Resilience:** If no LLM provider is active, scan import must still succeed and complete with rule-based deterministic findings.

---

### Task 1: Backend Parsers and Ingestion Endpoint

**Files:**
- Create: `backend/app/scanner/importer.py`
- Modify: `backend/app/api/assessments.py`
- Test: `backend/tests/test_import_scan.py`

**Steps:**
- [x] Write failing test in `backend/tests/test_import_scan.py` testing `POST /api/assessments/import` with mock Nmap XML and ZAP JSON fixtures.
- [x] Implement `parse_zap_json(json_content: str)` and `parse_imported_file(tool: str, content: str)` in `backend/app/scanner/importer.py` leveraging existing `parse_nmap_xml`.
- [x] Add `POST /api/assessments/import` endpoint to `backend/app/api/assessments.py` accepting `target_id`, `tool`, and `file: UploadFile`.
- [x] Wire deterministic normalization (`normalize_assessment`) and background AI interpretation (`interpret_assessment`).
- [x] Run `pytest tests/test_import_scan.py` to make sure tests pass.
- [x] Run full test suite: `.venv\Scripts\python -m pytest tests -q`.
- [x] Commit: `feat(api): add manual scan import endpoint for nmap and zap`.

---

### Task 2: Frontend "Import Scan" Dialog with Impeccable Polish

**Files:**
- Create: `frontend/src/components/import-scan-dialog.tsx`
- Modify: `frontend/src/pages/assessments.tsx`
- Modify: `frontend/src/lib/api.ts` (if needed for multipart upload)

**Steps:**
- [x] Create `frontend/src/components/import-scan-dialog.tsx` featuring:
  - Target selection with base URL and intensity badge.
  - Tool selection (Nmap XML vs OWASP ZAP JSON) with tabbed or segmented controls.
  - CLI command reference snippet showing the exact command to produce the file.
  - Drag-and-drop / click-to-upload file picker with clean border, hover state, file name display, and clear button.
  - Proper padding, label associations, accessibility attributes, and dark/light mode tokens.
- [x] Integrate the dialog into `frontend/src/pages/assessments.tsx` alongside the "New assessment" button.
- [x] Verify `npm run build` and `npm run lint`.
- [x] Run impeccable design detector: `impeccable.cmd detect --json frontend/src/components/import-scan-dialog.tsx`.
- [x] Commit: `feat(ui): add manual scan import dialog in assessments page`.

---

### Task 3: End-to-End Verification & Documentation Update

**Files:**
- Modify: `AGENTS.md` (Milestone status & current state)
- Modify: `docs/member-logs/m1-scan-engine.md`

**Steps:**
- [x] Run end-to-end backend and frontend test checks.
- [x] Test importing a sample Nmap XML and sample ZAP JSON through the running server / API.
- [x] Update `AGENTS.md` and log entry documenting the dual-mode capability.
- [x] Commit: `docs: update milestone and log for manual scan ingestion`.
