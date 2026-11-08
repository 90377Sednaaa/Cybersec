# Auth hardening checklist (M4 T4.5)

Audit of every endpoint's role enforcement (server-side, via `require_role` /
`get_current_user` in `backend/app/core/deps.py`), the self-service password
change, team account policy, and known auth limitations.

## 1. Endpoint x role matrix

Roles: **admin** > **assessor** > **viewer**. "any" = any authenticated role
(there is no anonymous access except the two public rows). Mutating rows are
the security-relevant ones; viewers are read-only by design.

| Endpoint | Method | Allowed | Enforced by |
|---|---|---|---|
| `/health` | GET | public | no auth (liveness probe only, returns no data) |
| `/api/auth/login` | POST | public | credential check (bcrypt verify) |
| `/api/auth/change-password` | POST | any | `get_current_user` + current-password re-check |
| `/api/auth/me` | GET | any | `get_current_user` |
| `/api/users` | GET | admin | `require_role(admin)` |
| `/api/users` | POST | admin | `require_role(admin)` |
| `/api/targets` | GET | any | `get_current_user` |
| `/api/targets` | POST | admin, assessor | `require_role(admin, assessor)` |
| `/api/targets/{id}` | GET | any | `get_current_user` |
| `/api/targets/{id}` | PUT | admin, assessor | `require_role(admin, assessor)` |
| `/api/targets/{id}` | DELETE | admin | `require_role(admin)` |
| `/api/assessments` | POST | admin, assessor | `require_role` **+ intensity gate 409** (server-side) |
| `/api/assessments` | GET | any | `get_current_user` |
| `/api/assessments/{id}` | GET | any | `get_current_user` |
| `/api/assessments/{id}/events` | GET (SSE) | any | `get_current_user` |
| `/api/assessments/{id}/cancel` | POST | admin, assessor | `require_role(admin, assessor)` |
| `/api/findings` | GET | any | `get_current_user` |
| `/api/findings/{id}` | GET | any | `get_current_user` |
| `/api/findings/{id}` | PATCH | admin, assessor | `require_role` **+ state machine 409** (viewer 403, tested) |
| `/api/findings/{id}/evidence` | GET | any | `get_current_user` |
| `/api/findings/{id}/evidence` | POST | admin, assessor | `require_role` (viewer 403, tested) |
| `/api/evidence/{id}/download` | GET | any | `get_current_user` |
| `/api/assessments/{id}/report` | POST | admin, assessor | `require_role` *(T4.4, landing next)* |
| `/api/reports/{id}` | GET | any | `get_current_user` *(T4.4)* |

Audit method: every row above was read from the route decorators in
`backend/app/api/*.py` on 2026-11-09 and cross-checked against the tests in
`backend/tests/` (viewer-role 403 is asserted for findings mutations and
evidence upload; the M1 suite asserts viewer 403 on assessment creation).

## 2. Change-own-password

`POST /api/auth/change-password` — any logged-in user, self-service only
(there is no admin-resets-password endpoint; an admin creates accounts with a
known password and the owner changes it on first login). The current password
must be supplied and is re-verified, so a stolen unattended session cannot
lock the real owner out. New password floor: 8 chars (same as `UserCreate`).
Tested in `backend/tests/test_auth_hardening.py`: wrong current password ->
401, short new password -> 422, success -> old password rejected at login and
new one accepted, works for viewer accounts too.

## 3. Team accounts

- No public registration (PLAN.md decision) — the admin creates every account
  through `POST /api/users` with the teammate's real email; each member logs
  in with their own account and **their own GitHub identity for commits**
  (individual-contribution rubric).
- Bootstrap admin: seeded on first startup from `ADMIN_EMAIL`/`ADMIN_PASSWORD`
  (`backend/.env`). For anything beyond local dev, change it via the users API
  or set the env vars **before** first start — the default `admin123` is a
  development credential only and is logged as a warning by the seeder.
- Account roles used in the demo: one admin (team lead), assessors for
  everyone who verifies findings, viewer for the read-only demo login.

## 4. Known limitations (honest list)

1. **No login rate limiting yet.** `POST /api/auth/login` can be retried
   without throttling, which is a brute-force window. Mitigation planned for
   the deployment stage: per-IP + per-account throttling (e.g. slowapi or a
   reverse-proxy limit). Not shipped in the dev demo because the deployment
   story is single-machine native Windows (PLAN.md §1); recorded here so it
   is stated before the examiners find it.
2. **JWTs are stateless — a password change does not revoke existing tokens.**
   Tokens carry user id + role until expiry (default session lifetime in
   `app/core/security.py`). A leaked token cannot be individually revoked;
   full revocation would need a token-version column checked per request
   (additive change; noted as future work).
3. **Bootstrap admin seeding logs a warning** — the default password is
   printed to the log on first start (intentional, so dev setups notice).
4. **No 2FA / password complexity rules** beyond the 8-char floor — accepted
   scope for a university demo, listed for completeness.

## 5. Hard rules this checklist protects

- Findings are confirmed by humans only (`verified` is unreachable without an
  authenticated assessor/admin PATCH — the state machine is server-side).
- Viewers cannot mutate anything (403 on every write path, tested).
- Secrets never enter the API surface: LLM keys stay behind M2's settings API
  (write-only, encrypted at rest), evidence files download through the M4
  endpoint, never as static paths.
