# SwitchPilot

Self-hosted switch management for your homelab. One dashboard for your **Cisco**
(IOS / IOS-XE / NX-OS) and **MikroTik** (RouterOS) switches, driven over SSH. No
cloud, no licensing, no vendor controller required.

---

## What it does

**Inventory & onboarding.** Auto-detects vendor, model, version, serial, uptime,
and CPU/memory/temperature on the first SSH connect. Guided onboarding optionally
pushes a baseline (neighbor discovery, syslog forwarding to the platform, SNMP).

**Ports.** A graphical front panel that mirrors the real switch: RJ45 jacks vs
SFP/fiber cages, ports colored by live link speed (10G blue, 1G green, 10/100
orange). Per port: enable/disable, bounce, **PoE power-cycle** (reboot a frozen
AP/camera without unplugging), cable test (Cisco TDR), access/trunk VLAN config
(Cisco switchport and RouterOS bridge-VLAN), and **SFP optical diagnostics**
(DDM: temperature, Tx/Rx power, vendor). Structured edits are **previewed**
(a before/after diff with connectivity and self-lockout guardrails) before applying and **read
back** from the device afterward to confirm they landed.

**Config management.** Scheduled and on-demand backups, each committed to a local
git repo with author and reason. Browse the per-device history, diff any two
versions, roll back (Cisco), and download the whole fleet's latest configs as one
file. Drift detection against a pinned baseline.

**Compliance.** Per-vendor rule packs (line/regex checks) scored per device and
across the fleet, with one-click remediation. Ships with Cisco CIS-style and
RouterOS hardening rules.

**Monitoring & alerts.** Continuous polling (online/offline, CPU, memory, temp,
port flapping, interface errors), plus event-driven **syslog and SNMP-trap
ingest** (linkUp/Down, coldStart, auth failures) for both Cisco and RouterOS.
Per-device 30-day availability, TLS certificate-expiry warnings, alerts with
maintenance windows, and real-time push to the UI. A composite **fleet health
score** (reachability + compliance + open criticals) sits on the dashboard.
Notify via email, Slack, Teams, Discord, ntfy, Gotify, Telegram, Pushover, or
generic signed webhooks.

**Endpoints.** Every MAC on the network with IP, OUI vendor, reverse-DNS,
switch + port + VLAN. Search by IP / MAC / hostname, and **Wake-on-LAN** any
endpoint with one click.

**Homelab integrations.**
- **Prometheus / Grafana** - `GET /metrics` exposes per-device and per-port
  gauges (up, cpu, mem, temperature, PoE watts, port bps/errors) labeled by
  device / port / vendor / site.
- **Home Assistant (MQTT)** - set `MQTT_URL` and your switches appear in HA via
  MQTT discovery (online, cpu/mem/temp, connected ports). Commands let HA
  enable/disable a port, PoE-cycle, or send Wake-on-LAN.
- **NetFlow / IPFIX** - set `NETFLOW_ENABLED` and point your switches' flow export
  (Cisco NetFlow, MikroTik traffic-flow) at the built-in collector; the Traffic
  page shows top talkers, a per-application breakdown, and bytes over time.

**Also included.** On-box network tools (ping, traceroute, IP scan) run from the
switch, topology from CDP/LLDP/MNDP, a PoE budget dashboard, a per-device
activity timeline (config changes, alerts, jobs, and audited actions in one
feed), a PoE energy + cost estimate, Cisco lifecycle
(EoS/EoL) tracking and ring-based firmware rollouts, scheduled and event-triggered
automation, sites for grouping gear by location, an installable PWA for phone /
rack use, and an optional off-box mirror of the config-history git repo for DR.

---

## Security

RBAC (Super Admin / Network Admin / Help Desk / Read Only), local + LDAP auth,
TOTP MFA with single-use recovery codes, an AES-256-GCM credential vault (with
key rotation via `npm run rotate-key`),
**SSH host-key pinning** (trust-on-first-use; a changed key is refused before
authentication, so credentials are never sent to an impersonated switch),
a hash-chained tamper-evident audit log (config changes also record the device's
command output, secret-redacted), and `sp_`-prefixed API keys for scripts.
A recent self-audit lives in [`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md).

---

## Quick start

```bash
git clone https://github.com/bpifer/switchpilot.git
cd switchpilot
cp .env.example .env     # set POSTGRES_PASSWORD, JWT_SECRET, CREDENTIAL_KEY
docker compose up -d --build
```

Open **http://localhost:8080**. Default login `admin` / `ChangeMe123!` (you are
prompted to change it on first login). API docs at `/docs`.

---

## Onboarding a switch

SwitchPilot only needs SSH and an admin login; it can push the rest as a baseline.

- **Cisco**: SSH v2, a `privilege 15` user, and `transport input ssh` on the VTYs.
- **MikroTik**: any RouterOS admin user (SSH is on by default; no enable mode).

For firmware fetches and syslog forwarding, set `PLATFORM_URL` to an address the
switch management network can reach.

---

## Key environment variables

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | required |
| `JWT_SECRET` | required; in production the API refuses to start on the default |
| `CREDENTIAL_KEY` | 32-byte hex for credential encryption; same hard-fail |
| `PLATFORM_URL` | reachable-from-switch URL (firmware downloads + syslog target) |
| `MQTT_URL` | enables the Home Assistant / MQTT bridge |
| `NETFLOW_ENABLED` | `true` starts the UDP NetFlow/IPFIX collector (Traffic page) |
| `CONFIG_HISTORY_REMOTE` | optional git remote to mirror config history to (off-box DR) |
| `METRICS_TOKEN` | optional bearer token guarding `GET /metrics` |
| `ALLOWED_ORIGINS` | CORS allow-list (set this in production) |
| `ENABLE_API_DOCS` | `false` to hide the Swagger UI at `/docs` |
| `SMTP_HOST`, `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `NTFY_URL`, `GOTIFY_URL`, `TELEGRAM_BOT_TOKEN`, `PUSHOVER_TOKEN` | alert channels (each optional) |
| `LDAP_URL` | optional directory auth |

Full list in `.env.example`.

---

## Supported hardware

- **Cisco** Catalyst 2960 / 3560 / 3750 / 3850 / 3650 / 4500 / 9000-series and
  Nexus 3K / 5K / 7K / 9K (IOS, IOS-XE, NX-OS).
- **MikroTik** RouterOS switches (CRS3xx tested; CSS and others use the same
  driver).

Any SSH-reachable IOS / IOS-XE / NX-OS or RouterOS device should work; unknown
models fall back to a safe common feature set. Adding another SSH-managed vendor
is a self-contained driver (see `backend/src/drivers/` and
`docs/PLAN-multi-vendor.md`).

---

## Development

```bash
docker compose up -d db redis            # dependencies only
cd backend  && npm install && npm run dev
cd frontend && npm install && npm run dev
cd backend  && npm test                  # Vitest, no hardware/DB needed
```

The backend suite covers the Cisco and RouterOS parsers, drivers, the NetFlow
decoder and SNMP-trap classifier, device-tool command building, the compliance
evaluator, job retry/backoff, device health alerting, credential-key crypto, RBAC,
and auth flows. CI
typechecks both halves, runs the tests, and
builds both Docker images on every push.
