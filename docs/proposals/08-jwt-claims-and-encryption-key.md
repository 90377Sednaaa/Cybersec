# Proposal: JWT claim requirements & encryption-key separation

Proposed by: M1 (draft) · Owner: M1 (Shared core) · Date: 2026-11-14 · Status: **open**

> Wave 1 decision gate. W2's key-lifecycle work depends on this being accepted.

## The idea

Two linked problems in the auth / at-rest-encryption core:

1. `core/security.py:30` calls `jwt.decode(token, key, algorithms=[…])` with no `require` options. PyJWT
   verifies `exp` **if present** but does not require it, so a correctly signed token with no `exp` is valid
   forever. `create_access_token` always sets `exp`, so no legitimate token is affected — but with the
   committed default `SECRET_KEY` (see the M5 exclusion note below) a forged token is trivial to produce.
   Wave 0 already fixed the companion bug: `int(payload["sub"])` outside the `try` used to turn a
   malformed signed token into a 500 (`core/deps.py`), it is now a clean 401.
2. `models/llm.py:28-30` derives the Fernet key as an unsalted `sha256(settings.secret_key)` — the
   **same** value used to sign JWTs. Any rotation of `secret_key` (which is the correct fix for a leaked
   signing key) instantly makes every `api_key_encrypted` row undecryptable. `decrypt_secret` then raises
   `cryptography.fernet.InvalidToken`, which is not caught by `client.py`, `catalog.py`,
   `settings_llm.py:287` or `interpret.py` — so `/test` and `/models` 500, and AI silently stops on scans.

Four changes:

1. `jwt.decode(..., options={"require": ["exp", "sub"]})`. Purely a hardening of token acceptance; no
   legitimately issued token changes.
2. Introduce a separate, versioned `ENCRYPTION_KEY` (or domain-separated HKDF from `secret_key`) so
   signing and encryption keys can rotate independently. Store a key-version prefix on each encrypted
   value so multiple generations can be read during a cutover.
3. Catch `InvalidToken` explicitly everywhere a stored key is decrypted and return a clean "stored key is
   unreadable" state — never a 500. This part is a straight bug fix and could ship even if (2) is rejected.
4. A one-time re-encrypt migration for existing provider rows, run before the new key becomes active.

**Out of scope (M5, deliberately):** the committed default `SECRET_KEY` / `admin123` bootstrap, login
rate limiting, security headers, CORS tightening, token revocation on password change. Those are deploy
hardening and were excluded from this fix plan. This proposal only covers the code-level defects.

## Why

- **Security:** one secret serving two purposes means the blast radius of either a leak or a rotation is
  both authentication and stored credentials.
- **Reliability:** today the documented incident response ("rotate the key") silently bricks every
  configured AI provider. A rotation that cannot be performed is not a rotation policy.
- **Correctness:** an unhandled `InvalidToken` contradicts the `/test` and `/models` contract that they
  never 500 on upstream failure.

## Cost

Roughly one session: `core/security.py`, `core/deps.py`, `models/llm.py`, `ai/client.py`, `ai/catalog.py`,
`api/settings_llm.py`, `config.py`, plus a migration script and 5–6 tests (no-exp token rejected,
no-sub token rejected, `InvalidToken` degrades cleanly on all three call sites, old-version row still
readable during cutover, round-trip under the new key).

**Contract change.** No HTTP shape changes, but the encrypted-at-rest format changes and every existing
token without `exp`/`sub` stops being accepted. Steward should note the cutover in the Wave-1 sketch.

**Needs from another member:** M5 to coordinate a maintenance window and to assign `core/**`,
`config.py`, `database.py` in the ownership matrix (currently uncovered — decision 5 in
`docs/fix-plan.md`). **An explicit decision on who runs the re-encryption and when is required before W2.**

## Risk

- **Migration is the whole risk.** If the cutover runs before the re-encrypt, every stored key is lost.
  Mitigation: versioned values so old and new keys are both readable during the window; a dry-run script
  that verifies every row decrypts under the new key before the old key is removed; an explicit rollback
  (keep the old key derivation available for one release).
- **Active sessions:** requiring `exp`/`sub` invalidates forged/legacy tokens immediately. All tokens
  issued by `create_access_token` already carry both, so real users are unaffected — but pin that with a
  test.
- **Dev databases:** the test suite sets `SECRET_KEY` in `conftest.py`, so a new `ENCRYPTION_KEY` needs a
  matching test default or the Fernet round-trip tests will fail in CI.
- **Main stays green:** `pytest tests -q` (currently 190), `npm run build` before push.
- **Fallback:** ship only items (1) and (3) — require `exp`/`sub` and catch `InvalidToken`. That removes
  the 500s and the forever-token without any migration. Key separation then becomes a separate later
  decision with its own cutover.

## Decision

Filled in at the daily sync: accepted / rejected, one-line reason, and the steward's note about contract
or timeline impact. If accepted, please name the cutover owner and window; W2 cannot start without them.
