# System review — 31 October 2026

This is a bounded source review and regression run, not a certification that the
whole application has no defects. No real account was changed for testing.

## Authentication fixes

- Access tokens have an explicit purpose. Remembered-device tokens can no longer
  authenticate protected API requests as bearer tokens. Previously both shared
  a signing format and the bearer reader did not check purpose.
- Tokens expire at their expiry second, including remembered-device tokens.
- Password verification rejects malformed hashes and plaintext fallback values.
- MFA accepts only six ASCII digits (spaces may separate digits). Corrupt secrets
  and non-ASCII digits fail verification rather than raising server errors.
- A missing MFA code requests the code; a supplied wrong code reports an error.
- Local attempt limits apply to login identifiers and MFA management (10/minute),
  and source addresses for login (60/minute). Excess requests receive HTTP 429
  with Retry-After. Both successful and failed attempts count. State is bounded
  and protected by a lock; it is in memory and resets on server restart.

Restart the backend to load changes. Previously issued access tokens will require
sign-in again. Accounts with legacy plaintext password values need a password
reset/migration; they are no longer accepted as password hashes. Normal PBKDF2
accounts retain their passwords. No password migration was run on real data.

## Verification

- Backend/lab suite, including OCR and upload regressions.
- Frontend TypeScript check, production build, ESLint and 14 Node regression tests.
- Authentication tests execute actual function bodies and original FastAPI route
  definitions using synthetic users and a database stub. HTTP tests cover login,
  protected setup, enabling MFA, required codes, remembered-device token rejection
  as bearer credentials, disabling MFA, and revocation after logout.
- Other auth tests cover a TOTP reference vector, malformed inputs, expired and
  tampered tokens, account approval and role rejection, and rate-limit expiry.

These tests do not validate PostgreSQL persistence, multi-worker behavior, a live
browser session, or a physical authenticator app. Importing the full main module
performs database setup; isolated tests intentionally omit those startup writes.

## Remaining issues and limits

- Mistral and local OCR still misread handwriting. Cloud extraction still lacks
  a complete unified inventory mapping. Candidates must remain subject to review.
- TOTP codes may be reused within the accepted time window; single-use counter
  persistence is not implemented. Existing sessions are not all revoked when MFA
  is enabled, and MFA setup currently relies on an authenticated session without
  a fresh password challenge. These need a coordinated session/schema change.
- MFA recovery codes and a recovery workflow are absent. The current setup UI
  provides a manual secret and URI, not a QR code.
- Multiple backend workers need a shared rate limiter; the local in-memory
  limiter does not coordinate across processes. Avoid treating it as distributed
  abuse protection.
- The production build reports a large main JavaScript bundle (about 1.43 MB
  minified). It builds successfully, but loading performance needs profiling.

## Browser and phone test

Use a test account. In Profile, start MFA setup. Add the displayed secret manually
to a time-based authenticator account; do not share it in chat. Enter the current
six-digit code to enable MFA. Sign out, then sign in with remember-device unchecked
to verify the code challenge. Check a wrong code and a current code. Finally,
disable MFA using a current code if the test account should return to its original
state. Keep server and phone clocks synchronized.
