# Finding Q&A ("Ask the Analyst") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an evidence-grounded analyst assistant for individual security findings using shadcn AI Elements patterns, DeepSeek-R1 / reasoning model support, and strict redaction.

**Architecture:** A FastAPI endpoint `POST /api/findings/{id}/qa` loads finding details and attached evidence, runs them through redaction, queries the assigned reasoning/chat model via `ai_client.chat(db, LLMTask.qa, ...)`, records the conversation into `ai_outputs`, and returns markdown answers with inline evidence citations. The React frontend presents a threaded chat interface inside the Finding Detail view with quick prompt chips, user/assistant message bubbles, collapsible reasoning blocks, and evidence citation tags.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, Pydantic v2, pytest with `httpx.MockTransport`; React 19, TypeScript, Tailwind CSS v4, shadcn/ui primitives.

**Spec:** `docs/superpowers/specs/2026-11-16-finding-qa-design.md`

## Global Constraints

- **Python:** SQLAlchemy 2.0 typed mappings; enums with `native_enum=False`; all request/response shapes through Pydantic v2 schemas at the API boundary.
- **Redaction:** Every text payload leaving the host to an LLM must pass through `app.ai.redaction.redact_all(...)` with the assessment target's deny-list terms.
- **Human Verification:** Q&A interaction must never mutate the finding's verification status (`status` remains `ai_candidate`, `verified`, or `false_positive`).
- **Role Enforcement:** `POST /api/findings/{id}/qa` requires `Role.assessor` or `Role.admin`; `viewer` is 403.
- **UI Constraints:** shadcn/ui + Tailwind v4; support both light and dark themes; no em-dashes in UI copy.
- **Verification Gates:** `pytest tests -q` must pass; `npm run build` must pass with 0 errors; `npm run lint` must report 0 errors.

## Review Focus

1. **Missing or Disabled AI Provider**: If no provider is configured or enabled for `LLMTask.qa`, the API returns a descriptive HTTP 400 with guidance to configure one in Settings, rather than a 500.
2. **Secret Leakage Prevention**: If an assessor's question or the finding's attached evidence contains session tokens, authorization keys, or target secrets, `redact_all` scrubs them before the provider transport receives them.
3. **Reasoning Model Compatibility**: Reasoning models emitting chain-of-thought in `reasoning_content` have their reasoning extracted cleanly into the `reasoning` field while the answer remains clean Markdown.
4. **Citation Extraction Accuracy**: Citations formatted as `[Evidence #<id>]` are parsed via regex and validated against the finding's actual attached evidence IDs; invalid or non-existent IDs are dropped.
5. **Viewers Blocked from Token Expenditure**: A user logged in as `viewer` attempting to call the endpoint is blocked with 403; the UI displays a disabled input state with an explanatory badge.

---

### Task 1: Pydantic Schemas & AI Grounded Logic (`backend/app/schemas/findings.py` & `backend/app/ai/qa.py`)

**Files:**
- Modify: `backend/app/schemas/findings.py:60-65`
- Create: `backend/app/ai/qa.py`
- Create: `backend/tests/test_finding_qa.py`

**Interfaces:**
- Consumes: `app.ai.client.chat`, `app.models.llm.LLMTask.qa`, `app.models.llm.AIOutput`, `app.ai.redaction.redact_all`, `app.models.finding.Finding`, `app.models.evidence.Evidence`
- Produces: `answer_finding_question(db: Session, finding: Finding, question: str, history: list[dict[str, str]] | None, deny_list: list[str] | None, transport: httpx.BaseTransport | None) -> dict`

- [ ] **Step 1: Write the failing unit tests for schemas and domain logic in `backend/tests/test_finding_qa.py`**

```python
import json
import httpx
import pytest
from app.ai.qa import answer_finding_question
from app.models import Assessment, Evidence, EvidenceKind, Finding, FindingStatus, LLMProvider, LLMTask, LLMTaskConfig, Severity, Target
from app.database import SessionLocal

def test_answer_finding_question_success(db_session, test_finding):
    ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python -m pytest backend/tests/test_finding_qa.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.ai.qa'`

- [ ] **Step 3: Define Q&A schemas in `backend/app/schemas/findings.py`**

Add `FindingQAMessage`, `FindingQARequest`, and `FindingQAResponse`:
```python
class FindingQAMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)

class FindingQARequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    history: list[FindingQAMessage] = Field(default_factory=list, max_length=6)

class FindingQAResponse(BaseModel):
    answer: str
    reasoning: str | None = None
    model: str
    grounded_evidence_ids: list[int] = Field(default_factory=list)
    created_at: datetime
```

- [ ] **Step 4: Implement `backend/app/ai/qa.py`**

Implement:
1. `_build_qa_messages(finding: Finding, question: str, history: list[FindingQAMessage]) -> list[dict[str, str]]`:
   - System prompt defining strict evidence grounding, instruction to cite evidence items as `[Evidence #<id>]`, and refusing to speculate.
   - Context block with Finding properties (title, category, severity, cvss score, description) and attached evidence items (`id`, `kind`, `label`, `content` truncated to 4,000 chars; text file reading for `upload` kinds).
   - Injects history turns (capped at last 6).
   - Appends current user question.
2. `answer_finding_question(db: Session, finding: Finding, question: str, history=None, deny_list=None, transport=None) -> dict`:
   - Applies `redact_all` with target deny-list terms to messages.
   - Invokes `ai_client.chat(db, LLMTask.qa, redacted_messages, max_tokens=2000, timeout=60.0, transport=transport)`.
   - Extracts `reasoning_content` if present into `reasoning`.
   - Parses `[Evidence #(\d+)]` with regex and filters against `finding.evidence` IDs.
   - Writes `AIOutput` record (`task=LLMTask.qa`, `assessment_id=finding.assessment_id`, `model=result.model`).
   - Returns dict matching `FindingQAResponse`.

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `.venv\Scripts\python -m pytest backend/tests/test_finding_qa.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/findings.py backend/app/ai/qa.py backend/tests/test_finding_qa.py
git commit -m "feat(ai): implement finding Q&A domain logic and schemas"
```

---

### Task 2: API Endpoint & Role Guard (`backend/app/api/findings.py`)

**Files:**
- Modify: `backend/app/api/findings.py`
- Modify: `backend/tests/test_finding_qa.py`

**Interfaces:**
- Consumes: `app.ai.qa.answer_finding_question`, `app.schemas.findings.FindingQARequest`, `app.schemas.findings.FindingQAResponse`, `require_role(Role.assessor, Role.admin)`
- Produces: `POST /api/findings/{finding_id}/qa`

- [ ] **Step 1: Write integration tests for `POST /api/findings/{id}/qa` in `backend/tests/test_finding_qa.py`**

Tests:
1. Assessor role returns 200 with `FindingQAResponse`.
2. Viewer role returns 403 Forbidden.
3. Unconfigured `LLMTask.qa` returns 400 Bad Request with guidance.
4. Non-existent finding ID returns 404.
5. Injected secrets in question or evidence are redacted before reaching MockTransport.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python -m pytest backend/tests/test_finding_qa.py -k "endpoint" -v`
Expected: FAIL with 404 Not Found (route not registered).

- [ ] **Step 3: Register `POST /{finding_id}/qa` in `backend/app/api/findings.py`**

```python
@router.post("/{finding_id}/qa", response_model=FindingQAResponse)
def ask_finding_qa(
    finding_id: int,
    body: FindingQARequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(Role.assessor, Role.admin)),
):
    finding = _get_finding_or_404(db, finding_id)
    try:
        ai_client.resolve_task_config(db, LLMTask.qa)
    except ai_client.NoProviderConfigured as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No AI provider or model is configured for Finding Q&A. Configure one in Settings.",
        ) from exc
    # Extract deny list from target
    deny_list = []
    if finding.assessment and finding.assessment.target:
        target = finding.assessment.target
        deny_list = [target.name, target.base_url]
        if target.authorization_ref:
            deny_list.append(target.authorization_ref)
    result = answer_finding_question(
        db,
        finding,
        body.question,
        history=body.history,
        deny_list=deny_list,
    )
    return FindingQAResponse(**result, created_at=utcnow())
```

- [ ] **Step 4: Run tests to verify all tests pass**

Run: `.venv\Scripts\python -m pytest backend/tests/test_finding_qa.py -v`
Expected: PASS

- [ ] **Step 5: Run full backend test suite to ensure no regression**

Run: `.venv\Scripts\python -m pytest backend/tests -q`
Expected: 280+ passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/findings.py backend/tests/test_finding_qa.py
git commit -m "feat(api): add POST /api/findings/{id}/qa endpoint with assessor role guard"
```

---

### Task 3: Frontend Types & Model Configuration (`frontend/src/lib/types.ts`)

**Files:**
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- Produces: `FindingQAMessage`, `FindingQARequest`, `FindingQAResponse`

- [ ] **Step 1: Add Q&A interfaces to `frontend/src/lib/types.ts`**

```typescript
export interface FindingQAMessage {
  role: "user" | "assistant"
  content: str
}

export interface FindingQARequest {
  question: string
  history?: FindingQAMessage[]
}

export interface FindingQAResponse {
  answer: string
  reasoning?: string | null
  model: string
  grounded_evidence_ids: number[]
  created_at: string
}
```

- [ ] **Step 2: Verify frontend type compilation**

Run: `npm run build`
Expected: PASS with 0 errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat(types): add Finding Q&A types to frontend"
```

---

### Task 4: Frontend UI: Finding Q&A Component (`frontend/src/components/finding-qa-panel.tsx` & integration)

**Files:**
- Create: `frontend/src/components/finding-qa-panel.tsx`
- Modify: `frontend/src/pages/finding-detail-page.tsx`
- Modify: `frontend/src/pages/finding-detail.tsx`

**Interfaces:**
- Consumes: `FindingDetail`, `api`, `useAuth`, `sonner.toast`
- Produces: `<FindingQAPanel finding={data} />`

- [ ] **Step 1: Create `frontend/src/components/finding-qa-panel.tsx`**

Implement shadcn AI Elements pattern:
1. **Header**: "Ask the Analyst" with Sparkles icon and badge showing assigned model / task tier.
2. **Suggested Prompt Chips**:
   - "Is this exploitable without auth?"
   - "What specific evidence proves this?"
   - "Provide web server config remediation"
   - "What false-positive conditions could apply?"
3. **Chat Thread**:
   - Analyst user message bubble (brand blue accent).
   - Assistant message card with Markdown formatting.
   - Collapsible reasoning block (`Reasoning / Thinking Process`) when `reasoning` is returned.
   - Grounded evidence badge linking or highlighting the referenced evidence.
   - Copy response button.
4. **Prompt Input**:
   - Shadcn textarea with Enter-to-send (Shift+Enter for newline).
   - Send button with loading spinner when mutation is pending.
   - Clear history button.
   - Disabled with tooltip if user is `viewer`.
   - Error banner with link to `/settings` if no AI provider is configured.

- [ ] **Step 2: Mount `<FindingQAPanel />` in `frontend/src/pages/finding-detail-page.tsx`**

Mount below the Evidence section and above Assessor Notes.

- [ ] **Step 3: Run `npm run build` and `npm run lint`**

Run: `npm run build && npm run lint`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/finding-qa-panel.tsx frontend/src/pages/finding-detail-page.tsx
git commit -m "feat(ui): add Finding Q&A panel with shadcn AI Elements pattern"
```

---

### Task 5: End-to-End Verification & Documentation Refresh

**Files:**
- Modify: `AGENTS.md` (record the new feature and test counts)

- [ ] **Step 1: Run full backend test suite**

Run: `.venv\Scripts\python -m pytest backend/tests -q`
Expected: All tests pass (0 failures).

- [ ] **Step 2: Run frontend build and linter**

Run: `npm run build && npm run lint`
Expected: Build passes with 0 errors; 0 lint errors.

- [ ] **Step 3: Update `AGENTS.md` snapshot**

Update the snapshot in `AGENTS.md` noting the addition of Finding Q&A (T2.6).

- [ ] **Step 4: Commit and push**

```bash
git add AGENTS.md
git commit -m "docs(agents): update status snapshot for Finding Q&A completion"
git push
```
