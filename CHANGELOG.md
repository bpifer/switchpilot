# Changelog

Notable changes to SwitchPilot. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.
Upgrading: pull the new images and restart — database migrations apply
automatically when the API starts. Take a database backup first
(Users page → Database backup, or see `docs/DISASTER-RECOVERY.md`).

## [Unreleased]

### Security
- **Fastify 5 migration** — clears a critical `fast-jwt` advisory chain
  (including a JWT auth-bypass variant) and high-severity `fast-uri` issues in
  Fastify core; also bumps `nodemailer` past several SMTP-injection advisories
  and `node-cron`/`uuid`. `npm audit --omit=dev` is now clean.
- The API now refuses to start in production with the `.env.example`
  placeholder `JWT_SECRET` (or any value under 16 chars), and with a
  `CREDENTIAL_KEY` that isn't 64 hex chars — a copied example file can no
  longer ship forgeable logins.

### Added
- `npm run reset-password -- <user> [--clear-mfa]` — audited break-glass
  recovery for a locked-out account (one-time password, forced change at
  next login).
- **Demo mode** — `DEMO_MODE=true` seeds a fake 4-device fleet (Cisco 9300 +
  2960X, MikroTik CRS326, Aruba Instant On 1930) with ports, PoE, endpoints,
  topology, 48h of metrics history, alerts, and config diffs, so the app can
  be evaluated with zero hardware. Demo devices are never polled and refuse
  live actions.

### Fixed
- `show interfaces status` rows whose port description contains a status word
  ("kept down") no longer misparse into the wrong state/VLAN columns.
- Aruba Instant On device pages now say CPU/memory/temperature are "not
  reported by this platform" (confirmed by probing a live 1930 — it exposes
  no health OIDs) instead of hiding the row like a polling failure.

## [1.0.0] - 2026-07-10

First tagged release. Highlights of what the platform does at 1.0:

### Vendors
- **Cisco IOS / IOS-XE** over SSH — hardware-validated on Catalyst 2960X
  (15.2) and 9300 (17.x). NX-OS support is **beta** (parsers written to
  documented output, not yet validated on hardware).
- **MikroTik RouterOS** over SSH — hardware-validated on CRS326 (7.x).
- **Aruba Instant On** over SNMP (no CLI on these devices) — read and write
  (port admin/bounce/description, access + trunk VLANs via Q-BRIDGE),
  hardware-validated on a 1930-24G.

### Core
- Guided two-step onboarding wizard with vendor selection, connect-and-verify
  probe, SSH host-key fingerprint display, optional SPAdmin account creation
  and baseline push, and credential-profile quick-pick.
- Graphical front panel per device; per-port enable/disable, bounce, PoE
  power-cycle, TDR cable test, VLAN config with preview/diff, SFP DDM optics,
  LAG create/delete. Uplink guard refuses actions that would cut the
  management path unless explicitly overridden.
- Config management: scheduled/on-demand backups into a local git repo,
  history, diffs, rollback (Cisco), baseline + drift detection with optional
  auto-remediation, fleet config bundle download. Aruba devices get synthetic
  SNMP-state snapshots feeding the same history/diff/compliance engine.
- Safe apply: device-side auto-revert (Cisco `reload in` / RouterOS scheduler)
  with an optional manual accept ("test mode") window.
- Compliance rule packs per vendor (Cisco CIS-style, RouterOS hardening,
  Aruba Instant On) with dry-run and one-click/scheduled remediation.
- Monitoring: polling + syslog + SNMP traps, port-flap detection, availability
  tracking, TLS cert expiry, maintenance windows, fleet health score; alerts
  to email/Slack/Teams/Discord/ntfy/Gotify/Telegram/Pushover/webhooks.
- Endpoints (MAC/IP/port tracking, OUI vendor, reverse DNS, Wake-on-LAN),
  topology from CDP/LLDP/MNDP with manual links, NetFlow/IPFIX traffic
  analytics, PoE budget + energy estimate, rack view, firmware library with
  ring-based rollouts, RouterOS staged upgrades, scheduled + event-driven
  automation, per-device diagnostics bundle for bug reports.
- Integrations: Prometheus `/metrics`, Home Assistant via MQTT discovery,
  installable PWA, REST API with `sp_` keys and Swagger UI at `/docs`.

### Security
- RBAC (4 roles), local + LDAP auth, TOTP MFA with recovery codes,
  AES-256-GCM credential vault with key rotation, SSH host-key pinning
  (trust-on-first-use), hash-chained tamper-evident audit log, signed
  webhooks, API rate limiting. Self-audit in `docs/SECURITY-AUDIT.md`.

[Unreleased]: https://github.com/bpifer/switchpilot/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/bpifer/switchpilot/releases/tag/v1.0.0
