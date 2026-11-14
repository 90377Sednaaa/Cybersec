# Proposal: findings list totals & pagination

Proposed by: M1 (draft) · Owner: M4 · Date: 2026-11-14 · Status: **open**

> Wave 1 decision gate. W4's "real total" work depends on this being accepted.

## The idea

`GET /api/findings` hardcodes `.limit(200)` and returns a bare `list[FindingOut]` with no offset, no
`total` and no `has_more` flag (`api/findings.py:55`). Callers cannot tell the result was truncated.
With more than 200 findings the UI silently drops the rest, and `build_report_context` (`reporting.py:53`)
loads **all** findings uncapped — so the dashboard, the findings table and the PDF can disagree about
the same assessment.

Add bounded `limit` / `offset` query parameters and an `X-Total-Count` response header. **The response
body stays exactly `list[FindingOut]`** — no envelope, no new field, no frontend type change. Alternatively
add a separate `GET /api/findings/stats` returning counts; either shape is acceptable, the requirement is
just an authoritative total.

W1 has already shipped the honest stopgap: the dashboard's "Verification progress" card now says
"Counts cover the 200 newest." W4 replaces that caption with the real total once an endpoint exists.

Extends `TASK_PLAN.md` T4.1 / the Wave-1 findings API sketch.

## Why

- **Truthfulness:** a security tool must not present a truncated list as a complete one. The percentage
  "N of M findings reviewed" is currently computed against a cap, not against reality.
- **Consistency:** UI and PDF should count the same findings for the same assessment.
- **Rubric / demo value:** aggregate counts are easier to defend in an evidence pack than "we show the
  first 200".

## Cost

Roughly half a session in `api/findings.py` plus 3–4 tests (offset past the end, cap enforcement,
`X-Total-Count` matches the uncapped count, existing filters still apply). M3 needs one small change in
`pages/dashboard.tsx` to read the header (W4). No change to `schemas/findings.py`.

**Contract change, but additive.** New optional query params and one new response header. Existing callers
sending nothing get byte-identical response bodies and the same default 200-row cap. No migration, no
DB change. Steward should still add the params/header to the Wave-1 API sketch on acceptance so the
documented contract stays accurate.

**Needs from another member:** M5 to update the API sketch; M3 to consume the header in W4.

## Risk

- **Hidden cost of `COUNT(*)`:** negligible at this scale (SQLite, single table), but it is one extra
  query per list call. If it ever matters, cache it per request or move it into the same statement with a
  window function.
- **Filters and total:** the header must reflect the *filtered* count, not the whole table, or the
  dashboard will show a total that contradicts the visible filters. Pin this with a test.
- **Frontend compatibility:** a header is invisible to `api()`'s JSON helper, so M3 must read
  `Response.headers` directly. That is a small wrapper change, not a rewrite.
- **Main stays green:** `pytest tests -q` (currently 190) and `npm run build` before push; the existing
  findings tests assert on the body, which does not change.
- **Fallback:** keep `limit(200)` and the W1 "Counts cover the 200 newest" caption. That is honest, just
  less useful; W4's real-total work is then dropped rather than deferred.

## Decision

Filled in at the daily sync: accepted / rejected, one-line reason, and the steward's note about contract
or timeline impact. If accepted, please also choose `X-Total-Count` vs a `/stats` endpoint so M3 builds
against the right shape.
