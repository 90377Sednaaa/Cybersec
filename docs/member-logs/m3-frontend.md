# Member Log M3 — Frontend

> Build log for M3 (owner: Matthew). Started 2026-11-09, written *as the module is built* —
> at the end it is the oral-defense script (approach, decisions, verification evidence, honest
> limitations), mirroring the structure of the M1 log.

**Status: done.** Task order: T3.0 → T3.1 → T3.2 → T3.3 → T3.4 → T3.5.

## What was built (per task)

| Task | Delivered | Files | Status |
|---|---|---|---|
| T3.0 Contract | Types mirroring the backend schemas (assessments/jobs/SSE events, findings/evidence/reports, LLM settings), component conventions, mock data | `src/lib/types.ts`, `frontend/CONVENTIONS.md`, `src/mocks/data.ts` | done |

| T3.1 Assessments page | List with live status polling, new-assessment dialog (server-enforced intensity gate mirrored in the UI), run detail panel with per-job progress cards, authenticated SSE live log, cancel button | `src/pages/assessments.tsx`, `src/pages/assessment-run.tsx`, `src/lib/scan-events.ts` | done |

| T3.2 Findings page | Filterable findings table, detail panel (overview / evidence / remediation tabs), assessor verify / false-positive / needs-evidence actions with notes | `src/pages/findings.tsx`, `src/pages/finding-detail.tsx`, `src/pages/finding-review.tsx`, `src/lib/finding-style.ts` | done |

| T3.3 Settings page | Provider management, per-task models, test connection | `src/pages/settings.tsx`, `src/pages/settings-tasks.tsx` | done |

| T3.4 Dashboard live data | Real counts, severity chart, recent assessments | `src/pages/dashboard.tsx` | done |

| T3.5 Report trigger UI | Generate button + download link | `src/pages/assessment-reports.tsx` | done |

## The approach

- **Contract first.** TypeScript types were written by translating the backend's Pydantic schemas
  (`schemas/assessment.py`, `schemas/findings.py`, `schemas/common.py`) so field names and enum values
  match the API exactly. Enum values were taken from `app/models/`.
- **Mock-first.** `src/mocks/data.ts` holds fake data typed with the real types, so pages can be built
  before the live backend is wired in; TypeScript flags any mock that drifts from the contract.
- **Shared conventions.** `CONVENTIONS.md` fixes how all pages handle loading, empty and error states,
  severity colors, and read-only UI for viewers.

## Key decisions and trade-offs (defense talking points)

- The action buttons mirror the backend's ALLOWED_TRANSITIONS table so only legal moves are offered, but the server stays the authority (illegal moves return 409; viewers get 403).
- Verifier identity is never sent by the browser: the server stamps verified_by/verified_at from the login token, so a verified finding always names a human.
- AI-produced findings are shown as "AI candidate (unconfirmed)" everywhere until an assessor verifies them.

- The SSE endpoint needs the Authorization header, which the browser's `EventSource` cannot send, so `scan-events.ts` reads the stream with `fetch` + `ReadableStream` and parses the `data:` blocks itself.
- Scan log lines are rendered as plain text (never HTML) so scan output cannot inject markup into the page.
- The Cancel button is hidden for viewers; the backend also enforces this with a 403.


- `ScanEvent` is a TypeScript discriminated union (by `type`) instead of one object with optional
  fields as in the Python schema. Same payloads, but the compiler knows which fields exist for each event type.
- Types are named `Assessment`/`Job`/`Finding` (not `...Out`) to follow the existing `Target` naming.
- (add more as T3.1+ land)

## Verification evidence

- `npm run build` (tsc + vite) passes after each change; commits pushed to `main`:
  `6f97ea0` (assessment types), `5b56443` (remaining types + conventions), `a72b371` (mocks).
- (add screenshots and test results per task as they land)

## Honest limitations

- Mock data values (e.g. LLM task names, model names) are placeholders, not taken from the live API.
- (filled in as the module matures)