# Proposal: token revocation on password change

Proposed by: M1 (audit F-38) · Owner: Shared core · Date: 2026-11-14 · Status: **accepted 2026-11-14 (shipped in W5)**

> Decision 3 in `docs/fix-plan.md` §7. The W5 session chose the token-version
> option over keeping the documented 12 h window.

## The idea

Every user row gets a `token_version` integer. Login stamps it into the JWT as
a `tv` claim, and `get_current_user` rejects a token whose `tv` no longer
matches the row. Changing the password increments the column, so every session
issued under the old password dies immediately. No revocation table, no
per-request storage beyond one integer already loaded with the user.

This closes the gap documented in `docs/auth-checklist.md` §4.2: "a password
change does not revoke existing tokens".

## Why

- **It is the one remaining high-value security gap** from the audit that can be
  closed without a live provider or a schema negotiation.
- **Cheap:** one column, one claim, one comparison, one increment. The frontend
  needs no change because it has no password-change form yet (the endpoint is
  API-only), and the shared 401 handler already handles a rejected session.
- **Defensible:** "we can revoke sessions" is a better answer at the defense
  than "we accept a 12 h window", and the mechanism is small enough to explain
  in one slide.

## Cost

Half a session including tests. Additive column via the existing
`ensure_sqlite_columns` startup migration (`DEFAULT 0`), so no manual
migration. `create_access_token` gains a required `token_version` argument; the
only production caller is login. The token claim set grows from
`{sub, role, exp}` to `{sub, role, tv, exp}`.

**Deliberate cost:** tokens issued before the deploy carry no `tv`, so the
claim is required and every existing session is logged out once. That is the
point of the change, not an accident. The demo has a handful of accounts.

## Risk

- **Over-tightening:** if `tv` were optional, a stolen pre-deploy token would
  keep working forever. It is in the required-claims list, and a test asserts a
  token without it is rejected.
- **Role changes:** this revokes on password change only. Changing a user's
  role already takes effect immediately because `get_current_user` reloads the
  row; a role change does not need a token bump.
- **Fallback:** do nothing and keep the 12 h stateless window. The code change
  is isolated to `models/user.py`, `core/security.py`, `core/deps.py`,
  `api/auth.py` and `database.py`, so reverting is a five-file change.

## Decision

**Accepted 2026-11-14** (W5). Shipped as described: `token_version` column with
a startup `ALTER TABLE ... DEFAULT 0`, required `tv` claim, mismatch → 401
"Session revoked", increment in change-password. Recorded in
`docs/TASK_PLAN.md` § Adopted changes.
