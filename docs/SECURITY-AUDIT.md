# Security Audit — SwitchPilot

Date: 2026-06-14. Method: static code review of the auth/crypto/data paths plus
live black/grey-box testing against the deployed instance and both managed
switches. Scope: backend API, auth, secrets, device command paths, frontend.

## Summary

The platform is in good security shape for an internally-hosted tool. The auth
and crypto primitives are done correctly (not the usual AI-codegen weak spots).
**One real vulnerability was found and fixed** (CLI command injection via a port
description). The rest are low-severity hardening items, all deploy-level.

## Findings

### 1. CLI command injection via port description — FIXED (Medium-High)
A port `description` is free text pushed into the device CLI. The lowest role
that can configure a port is `helpdesk`. The description was interpolated into
`description <text>` (Cisco) / `comment="<text>"` (RouterOS) with no newline
handling, and the SSH layer writes `command + "\n"`. A description containing
newlines therefore became multiple CLI commands. On Cisco:
`"lobby\nexit\nusername evil privilege 15 secret p"` creates a privilege-15
admin account on the switch — a helpdesk platform user escalates to full switch
admin. (RouterOS was partly shielded by quote-stripping; newlines still broke
pushes.)

Fix (defense in depth, verified live — injection now returns 400 and never
reaches the device):
- SSH `exec()` (Cisco shell + RouterOS) strips embedded CR/LF from every single
  command — a chokepoint covering any field/code path. Multi-line pushes
  (banners) use separate array elements and are unaffected.
- `driver.portConfig` sanitizes the description per vendor.
- The port-config schema rejects newlines in `description`.

### 2. CORS reflects any origin with credentials — hardening (Low)
`ALLOWED_ORIGINS` is unset, so CORS uses `origin: true, credentials: true`.
Impact is limited because auth is a Bearer token (not a cookie) and the SPA is
same-origin with the API via nginx. Recommendation: set `ALLOWED_ORIGINS` to the
UI origin in production.

### 3. Swagger UI and /metrics are unauthenticated — info disclosure (Low/Info)
`/docs` (full API schema) and `/metrics` (aggregate counts only) are reachable
without auth, and the API is also published directly on `:3000`. No
device/credential data is exposed, but the schema aids enumeration.
Recommendation: `ENABLE_API_DOCS=false` in prod and restrict `:3000`/`/metrics`
to the management network (front only `:8080`/nginx).

### 4. Login user-enumeration via timing — Low
Login only runs bcrypt for existing local users, so a valid username is
distinguishable by response time. Largely mitigated by the 10/min per-IP login
throttle. Optional: run a dummy bcrypt compare for unknown users.

### 5. Onboarding SSRF-ish target — Low/Info
`POST /api/onboarding/*` (netadmin) opens an SSH connection to any IP, usable to
probe internal hosts on :22. SSH-only (no HTTP metadata reach) and netadmin-only.
Optional: restrict onboarding targets to configured subnets.

### 6. JWT has no server-side revocation — Info
Changing a password or disabling a user does not invalidate already-issued JWTs
until they expire (8h). `refresh` re-reads role/enabled, which limits drift.
Acceptable for the threat model; a token denylist would close it fully.

## Verified clean

- **Secrets/keys**: `JWT_SECRET` and `CREDENTIAL_KEY` are custom (64-char) at
  runtime, `NODE_ENV=production`, custom Postgres password. A startup gate
  *crashes* on the dev defaults in production.
- **Crypto**: device credentials use AES-256-GCM (random IV + auth tag, proper
  AEAD); passwords use bcrypt(12); MFA secrets encrypted; backup codes hashed +
  single-use.
- **AuthN**: per-IP login throttle, account lockout, MFA (TOTP + recovery),
  generic error messages.
- **AuthZ**: every route carries `requireRole(...)` with a sane hierarchy;
  `GET /api/credentials` returns no secret material.
- **SQL injection**: queries are consistently parameterized; the only string
  interpolation is fixed table aliases.
- **Secret exposure**: no endpoint returns decrypted device passwords/keys.
- **Path traversal**: firmware upload uses `basename` + charset allowlist; serve
  uses `basename` + a DB filename allowlist.
- **XSS**: no `dangerouslySetInnerHTML`/`eval` in the SPA; React escapes
  rendered device/syslog text.
