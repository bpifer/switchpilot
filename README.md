# SwitchPilot

Self-hosted switch management for your homelab. One dashboard for your **Cisco**
(IOS / IOS-XE / NX-OS), **MikroTik** (RouterOS), and **Aruba Instant On**
switches — no cloud, no licensing, no vendor controller needed.

Cisco and MikroTik are managed over SSH. Aruba Instant On switches use SNMP
(Q-BRIDGE / IF-MIB writes) since Aruba's consumer line doesn't expose SSH in a
useful way — no credentials to store, just a community string.

---

## What it does

**Inventory & onboarding.** Add a switch by picking its vendor, entering
connection details, and clicking "Connect & verify" — SwitchPilot probes the
device, shows you exactly what it found (hostname, model, OS version, SSH host-key
fingerprint), and only commits it to the database after you confirm. Cisco and
MikroTik onboarding can optionally push a baseline config (neighbor discovery,
syslog forwarding, SNMP). After that, model, version, serial, uptime, CPU, memory,
and temperature are polled automatically.

**Ports.** A graphical front panel that mirrors the real switch: RJ45 jacks and
SFP cages, ports colored by live link speed (10G blue, 1G green, 10/100 orange).
Click any port to see its full state, then act on it:

- Enable / disable admin status
- Bounce the port (shut + no shut) without touching anything else
- PoE power-cycle — reboots a frozen AP or camera without pulling a cable
- Cable test (Cisco TDR) to diagnose bad runs
- Access or trunk VLAN config — for Cisco and RouterOS this goes through a
  before/after diff with safety guardrails; for Aruba Instant On it applies
  directly via SNMP
- SFP optical diagnostics (DDM: temperature, Tx/Rx power, vendor)
- Link-aggregation groups (LACP or static — Cisco EtherChannel, RouterOS bonding)

Any config push that would cut SwitchPilot's own management path (disabling SSH,
locking the VTYs, removing the management IP) is refused server-side unless you
explicitly override it. The optional safe-apply mode arms a device-side auto-revert:
RouterOS does a scheduled backup restore; Cisco IOS-XE uses `reload in N` with an
automatic `reload cancel` + `write memory` once confirmed reachability is back.

**Tools.** A device tools tab gives you direct access to the most common ops work:
reboot the device (type REBOOT to confirm), bounce a specific port, run a cable
test, and launch on-box network diagnostics — ping, traceroute, and IP scan — all
from the browser. Output streams back to a terminal pane.

**Config management.** Scheduled and on-demand backups, each committed to a local
git repo with author and reason. Browse per-device history, diff any two versions,
roll back to any previous config (Cisco), and download the whole fleet's latest
configs as one file. Drift detection against a pinned baseline.

**Compliance.** Per-vendor rule packs (line/regex checks) scored per device and
across the fleet, with one-click remediation. Ships with Cisco CIS-style and
RouterOS hardening rules. Auto-remediation skips devices in maintenance windows.

**Monitoring & alerts.** Continuous polling (online/offline, CPU, memory, temp,
port flapping, interface errors) plus event-driven syslog and SNMP-trap ingest
(linkUp/Down, coldStart, auth failures) for Cisco and RouterOS. Per-device 30-day
availability, TLS certificate-expiry warnings, alerts with maintenance windows, and
real-time push to the UI. A composite fleet health score (reachability + compliance + open criticals) sits on the dashboard. Notify via email, Slack, Teams, Discord,
ntfy, Gotify, Telegram, Pushover, or generic signed webhooks.

**Endpoints.** Every MAC on the network with IP, OUI vendor, reverse-DNS, and the
switch + port + VLAN it was seen on. Search by IP / MAC / hostname, and
Wake-on-LAN any endpoint with one click.

**Homelab integrations.**
- **Prometheus / Grafana** — `GET /metrics` exposes per-device and per-port gauges
  (up, cpu, mem, temp, PoE watts, port bps/errors) labeled by device / port / vendor / site.
- **Home Assistant (MQTT)** — set `MQTT_URL` and your switches appear in HA via
  MQTT discovery (online, cpu/mem/temp, connected ports). Commands let HA enable or
  disable a port, PoE-cycle, or send Wake-on-LAN.
- **NetFlow / IPFIX** — set `NETFLOW_ENABLED` and point your switches' flow export
  (Cisco NetFlow, MikroTik traffic-flow) at the built-in collector; the Traffic
  page shows top talkers, per-application breakdowns, and bytes over time.

**Also included.** Topology from CDP/LLDP/MNDP with manual link drawing and
persistent node positions, a PoE budget dashboard, a per-device activity timeline
(config changes, alerts, jobs, and audited actions in one feed), a PoE energy +
cost estimate, a visual rack view, Cisco lifecycle (EoS/EoL) tracking, ring-based
firmware rollouts, scheduled and event-triggered automation, site grouping, dark
mode, an installable PWA for phone / rack use, and an optional off-box mirror of
the config-history git repo for DR.

---

## Security

RBAC (Super Admin / Network Admin / Help Desk / Read Only), local + LDAP auth,
TOTP MFA with single-use recovery codes, and an AES-256-GCM credential vault
with key rotation (`npm run rotate-key`) and owner password recovery
(`npm run show-credential`).

SSH host-key pinning works on trust-on-first-use: a changed key is refused before
authentication happens, so credentials are never sent to an impersonated switch.
Aruba's SNMP community string is stored with the same encryption as SSH passwords.

The audit log is hash-chained for tamper-evidence; config changes record the
device's command output with secrets redacted. `sp_`-prefixed API keys are
available for scripts. A recent self-audit lives in
[`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md).

---

## Quick start

```bash
git clone https://github.com/bpifer/switchpilot.git
cd switchpilot
cp .env.example .env     # set POSTGRES_PASSWORD, JWT_SECRET, CREDENTIAL_KEY
docker compose up -d --build
```

Open **http://localhost:8080**. Default login `admin` / `ChangeMe123!` — you are
prompted to change it on first login. API docs at `/docs`.

---

## Onboarding a switch

Click **+ Add switch**, pick your vendor, and follow the two-step wizard. The first
step connects to the device and confirms it's really there; the second lets you set
the site, location, and any Cisco-specific options (SPAdmin account, baseline push).

**Cisco** — needs SSH v2, a `privilege 15` user, and `transport input ssh` on the
VTYs. SwitchPilot can create a dedicated `SPAdmin` account during onboarding so
platform actions show up under their own name in the switch's own logs.

**MikroTik** — any RouterOS admin user over SSH. No enable mode, no extra prep.

**Aruba Instant On** — SNMP community string only, no SSH credentials needed or
stored. Make sure SNMP is enabled on the switch and the community string matches
before onboarding.

For firmware fetches and syslog forwarding, set `PLATFORM_URL` to an address the
switch management network can reach.

---

## Key environment variables

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | required |
| `JWT_SECRET` | required; the API refuses to start on the default value in production |
| `CREDENTIAL_KEY` | 32-byte hex for credential encryption; same hard-fail |
| `PLATFORM_URL` | reachable-from-switch URL (firmware downloads + syslog target) |
| `MQTT_URL` | enables the Home Assistant / MQTT bridge |
| `NETFLOW_ENABLED` | `true` starts the UDP NetFlow/IPFIX collector (Traffic page) |
| `CONFIG_HISTORY_REMOTE` | optional git remote to mirror config history off-box |
| `METRICS_TOKEN` | optional bearer token guarding `GET /metrics` |
| `ALLOWED_ORIGINS` | CORS allow-list; unset in production means the API blocks cross-origin (fail-closed) |
| `ENABLE_API_DOCS` | `false` to hide the Swagger UI at `/docs` |
| `SMTP_HOST`, `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `NTFY_URL`, `GOTIFY_URL`, `TELEGRAM_BOT_TOKEN`, `PUSHOVER_TOKEN` | alert channels (each optional) |
| `LDAP_URL` | optional directory auth |

Full list in `.env.example`.

---

## Supported hardware

- **Cisco** Catalyst 2960 / 3560 / 3750 / 3850 / 3650 / 4500 / 9000-series and
  Nexus 3K / 5K / 7K / 9K (IOS, IOS-XE, NX-OS)
- **MikroTik** RouterOS switches — CRS3xx series tested; CSS and other models use
  the same driver
- **Aruba Instant On** — 1930-series tested via SNMP

Any SSH-reachable IOS / IOS-XE / NX-OS or RouterOS device should work; unknown
models fall back to a safe common feature set. Adding another SSH-managed vendor is
a self-contained driver (see `backend/src/drivers/` and
`docs/PLAN-multi-vendor.md`).

---

## Development

```bash
docker compose up -d db redis            # dependencies only
cd backend  && npm install && npm run dev
cd frontend && npm install && npm run dev
cd backend  && npm test                  # Vitest, no hardware needed
```

The backend suite covers the Cisco and RouterOS parsers, drivers, NetFlow decoder,
SNMP-trap classifier, device-tool command building, compliance evaluator, job
retry/backoff, device health alerting, credential-key crypto, RBAC, and auth flows.
CI typechecks both halves, runs the tests, and builds both Docker images on every
push.

---

## License

SwitchPilot is free software, licensed under the
**GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later) —
see [LICENSE](LICENSE).

You can use, study, modify, and redistribute it freely. If you run a modified
version as a network service (the AGPL's key difference from the GPL), you need to
offer its source code to the people who use that service. The login screen links
back to this repository to cover that for unmodified deployments; if you fork it,
point that link at your fork.

Copyright (C) 2025-2026 Brendon Pifer
