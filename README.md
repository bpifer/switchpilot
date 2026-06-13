# SwitchPilot - Cisco Switch Management Platform

A self-hosted, enterprise-grade management dashboard for Cisco Catalyst and Nexus switches.
Communicates directly over **SSH and SNMP** - no Cisco DNA Center, no Meraki licensing, no cloud dependency.

---

## Features

### Device Management
- **Inventory** - hostname, model, serial, IOS/NX-OS version, uptime, CPU/memory/temperature, PSU & fan status, stack members
- **Auto-detection** - SSH/SNMP probing resolves capabilities from a built-in model database (gates commands per model + OS version)
- **NX-OS support** - Nexus 3K/5K/7K/9K: skips enable mode, uses `copy running-config startup-config`, NX-OS-aware parsers for `show version`, `show environment`, `show system resources`, MAC table `*`-prefix rows
- **Sites** - group devices by physical location for rollup reporting
- **Bulk CSV import** - onboard many switches at once from a spreadsheet

### Configuration
- **Backup & restore** - scheduled automatic backups, on-demand, restore any snapshot
- **Git versioning** - every backup commits to a local git repo (`/data/config-history`), laid out as `configs/<site>/<hostname>.cfg`; the commit **author** is the user who triggered it and **Reason** / **Ticket** are recorded as commit trailers for audit. Browse the per-device history timeline, view config at any commit, and diff any two versions in the UI (or via `GET /api/devices/:id/config/git-log`, `…/git-show/:sha`, `…/git-diff`). The repo is auto-`gc`'d nightly.
- **Diff** - compare any two backups or a backup against live running config
- **Push & templates** - send arbitrary config lines or render reusable templates (VLANs, interfaces, port security, QoS, ACLs, trunks, STP, SNMP, NTP, AAA)
- **Rollback** - one-click restore of any historical git commit onto the device (current config snapshotted first, so rollbacks are themselves reversible) - Git for switches
- **Drift detection** - compare running config to a pinned baseline; optional auto-remediation
- **Compliance engine** - define rules (line/regex present/absent) scoped to all devices or a site; every device's latest config is scored against them. Fleet + per-device compliance %, per-rule pass/fail rollup, severity-weighted critical-failure flags, and one-click **remediation** that pushes a rule's fix lines. Seeded with a best-practice ruleset (NTP, AAA, TACACS+, syslog, SNMPv3-only, no-telnet, enable secret). Evaluated on the compliance cron and on demand.

### Port Management
- **Graphical front-panel** - port status, VLAN, speed, PoE watts
- **Actions** - enable/disable, bounce (shutdown/no shutdown), cable test (TDR)
- **Historical metrics** - per-port bandwidth and error counters over time

### Monitoring & Alerting
- **Continuous polling** - online/offline, CPU, memory, temperature, PSU/fan, port flapping, interface errors
- **Syslog ingest** - UDP syslog receiver (port 514); parses link-down, config-change, PoE-fault, and hardware-error events from IOS and NX-OS
- **Config-change alerting** - scheduler detects changed backups and raises a `config_changed` alert
- **Notifications** - Email (SMTP), Microsoft Teams webhook, Slack webhook
- **Maintenance windows** - suppress alerts for planned outages; scoped to all devices or a specific list
- **Real-time push** - authenticated WebSocket endpoint streams alerts to the dashboard instantly via Redis pub/sub (scales across multiple API replicas). The upgrade is authorized by a 30-second single-purpose nonce from `POST /api/auth/ws-token`, so the session JWT never appears in a URL or proxy log
- **Prometheus metrics** - `GET /metrics` exposes process defaults plus SwitchPilot gauges (devices by status, open alerts by severity, job queue depth) and an HTTP latency histogram, ready to scrape into Grafana/Datadog
- **Distributed tracing (opt-in)** - set `OTEL_EXPORTER_OTLP_ENDPOINT` and the API auto-instruments HTTP, Postgres, Redis, and DNS spans via OpenTelemetry (OTLP/HTTP export to Jaeger, Tempo, etc.)

### Endpoint Tracking
- **Endpoint Inventory** - MAC table + ARP correlation gives you every endpoint: IP, MAC, vendor (150+ OUI prefixes), reverse-DNS hostname, port, switch, VLAN; export to CSV
- **Endpoint Locator** - search by IP, MAC (any format), or hostname; returns Switch, Port, VLAN, CDP/LLDP Neighbor, Site instantly
- **Client history** - track every port and switch a MAC address has been seen on over time

### Network Intelligence
- **Topology** - Layer-2 maps built from CDP/LLDP neighbor data
- **ARP/IP correlation** - layer-3 switches supply IP→MAC mapping; populates `ip_address` on every tracked endpoint
- **CDP/LLDP discovery** - suggests unmanaged neighbors as onboarding candidates
- **VLAN visualization** - per-device VLAN table with port membership

### PoE Dashboard
- Per-switch utilization: used watts, total budget, remaining headroom
- Per-site rollup cards color-coded by utilization (green / amber / red)
- Fleet-level totals across all PoE-capable switches

### Switch Lifecycle Tracking
- End-of-Sale and End-of-Life dates for 50+ Cisco Catalyst and Nexus model families, stored in an editable **`lifecycle_catalog`** table (longest-prefix match)
- Populated automatically at each device refresh
- Dashboard shows switches nearing or past EOL; recommended IOS/NX-OS release per platform
- Super Admins can add/edit/delete catalog entries in the UI - correct dates or add new models without a code release (ready for a future Cisco EoX feed import)

### Firmware Management
- **Image upload** - server-side MD5 verification; images served for `copy http:` transfers
- **Compliance tracking** - set a target version per platform family; report which devices are behind
- **Ring-based campaigns** - staged rollouts across Pilot / Production / Critical rings with configurable wait days between rings; manual or automatic advancement

### Automation
- **Scheduled jobs** - one-shot or recurring (cron expressions); config push, backup, compliance check, firmware upgrade, port bounce, custom commands
- **Cluster-safe job engine** - jobs are claimed atomically with Postgres `FOR UPDATE SKIP LOCKED`, so any number of API/worker replicas can run side-by-side with no double execution. Running jobs heartbeat; a reaper requeues work orphaned by a crashed worker. Failed jobs retry with exponential backoff (`maxAttempts`), and the Jobs page streams **live per-device progress** over WebSocket with a one-click **retry failed**.
- **Horizontal scaling** - job execution is distributed across all replicas, while the device-polling/backup/compliance cron sweeps run on a single **leader** elected via a Postgres advisory lock (auto-failover if the leader dies). The API Deployment ships with `replicas: 2`.
- **Event triggers** - device_offline, cpu_high, temp_high, psu_fail, fan_fail, port_down, port_flapping, config_drift → notify / restore baseline / run template / disable port

### Security & Access Control
- **RBAC** - Super Admin / Network Admin / Help Desk / Read Only
- **Auth** - local accounts, LDAP/Active Directory, TOTP MFA with 8 single-use **recovery codes** issued at enrollment (shown once, stored hashed)
- **Sliding sessions** - the UI silently exchanges its token for a fresh one every 30 minutes (`POST /api/auth/refresh`), so open dashboards never hit a mid-session expiry
- **Configurable security policy** (Super Admin) -
  - **Password complexity** - min length + upper/lower/digit/symbol requirements, enforced on every password set
  - **Password expiry** - optional max age forces a change at next login
  - **Account lockout** - lock after N failed attempts for a configurable window; one-click unlock
  - **MFA enforcement** - require TOTP enrollment org-wide or for specific roles; users are gated into a forced enrollment screen until compliant
- **Forced security gate** - users with a pending password change or MFA enrollment cannot use the app until they complete it
- **Credential vault** - AES-256-GCM encrypted SSH and SNMP credentials
- **Tamper-evident audit log** - every write action recorded with username and IP, and each entry is **hash-chained** to the previous one; a one-click integrity check detects any edit, deletion, or reordering
- **Site scoping** - a Meraki-style site selector in the sidebar scopes devices, topology, alerts, logs, clients, PoE, lifecycle, and compliance to one site (jobs, templates, and firmware stay fleet-wide; the alert bell always shows all sites)
- **Full REST API** - OpenAPI/Swagger docs at `/docs`

---

## Quick Start (Docker Compose)

```bash
git clone https://github.com/bpifer/switchpilot.git
cd switchpilot
cp .env.example .env      # set POSTGRES_PASSWORD, JWT_SECRET, CREDENTIAL_KEY
docker compose up -d --build
```

Open **http://localhost:8080**

Default credentials: `admin` / `ChangeMe123!` - you are prompted to change the password on first login.

API docs: **http://localhost:3000/docs**

---

## Switch Prerequisites

SwitchPilot needs SSH access to manage a switch. Everything else can be configured
by SwitchPilot itself.

Required on the switch before onboarding:

```
hostname SW-EXAMPLE
ip domain-name example.local
crypto key generate rsa modulus 2048
ip ssh version 2
username <user> privilege 15 secret <password>
line vty 0 15
 login local
 transport input ssh
```

Recommended (SwitchPilot can push these for you - tick "Apply baseline config" when
adding the device, or use the "Baseline config" button on the device page):

| Config | Enables |
|---|---|
| `lldp run` | Discovery of non-Cisco neighbors (UniFi, servers, APs) in Topology and Discovery. CDP is on by default but only sees Cisco gear. |
| `logging host <switchpilot-ip>` + `logging trap informational` | Real-time alerts from syslog: link flaps, config changes, errdisable, PSU events. |
| `snmp-server community <ro-community> RO` | Fast status polling over SNMP instead of opening an SSH session each sweep. Uses the community from the device's credential profile. |

For firmware upgrades, set `PLATFORM_URL` in `.env` to a URL reachable from the
switch management network - switches download images from
`PLATFORM_URL/api/firmware/files/<name>` during upgrade jobs.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | `switchpilot` | **Required in production** |
| `JWT_SECRET` | `dev-only-secret` | **Required in production** - 32+ random chars. With `NODE_ENV=production` the API **refuses to start** if left at the default. |
| `CREDENTIAL_KEY` | `00…00` (32 bytes hex) | AES-256-GCM key for credential encryption. Same hard-fail in production if left at the default. |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `DB_POOL_MAX` | `10` | Max Postgres connections per API instance |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | - | Set to enable OpenTelemetry tracing (e.g. `http://jaeger:4318`) |
| `ALLOWED_ORIGINS` | - | Comma-separated CORS allow-list (e.g. `https://switchpilot.corp`). Unset reflects any origin (dev only). |
| `ENABLE_API_DOCS` | `true` | Serve Swagger UI at `/docs`. Set `false` to hide the API schema in production. |
| `FIRMWARE_DIR` | `/data/firmware` | Where IOS image files are stored |
| `CONFIG_HISTORY_DIR` | `/data/config-history` | Git repo for config version history |
| `SYSLOG_PORT` | `514` | UDP syslog receive port |
| `SMTP_HOST` | - | SMTP server for email alerts |
| `TEAMS_WEBHOOK_URL` | - | Microsoft Teams incoming webhook |
| `SLACK_WEBHOOK_URL` | - | Slack incoming webhook |
| `LDAP_URL` | - | LDAP/AD server (e.g. `ldap://dc.corp.local`) |

---

## Repository Layout

```
cisco-switch-manager/
├── backend/
│   ├── migrations/          # PostgreSQL schema (applied at startup)
│   │   ├── 001_init.sql
│   │   ├── 002_analytics.sql
│   │   ├── 003_maintenance_cron_arp.sql
│   │   ├── 004_lifecycle_rings_inventory.sql
│   │   ├── 005_job_reliability_lifecycle_catalog.sql
│   │   ├── 006_compliance_engine.sql
│   │   ├── 007_security_hardening.sql
│   │   └── 008_mfa_backup_codes.sql
│   └── src/
│       ├── cisco/           # SSH client, SNMP, parsers, capability DB, OUI, lifecycle
│       ├── routes/          # Fastify route handlers
│       ├── services/        # Monitor, alert, config, firmware, job, syslog services
│       └── index.ts         # App entrypoint
├── frontend/
│   └── src/
│       ├── pages/           # Dashboard, Devices, Topology, Alerts, PoE, Lifecycle, Campaigns …
│       ├── components/      # Shared UI primitives
│       └── hooks/           # useWebSocket (real-time alert push)
├── docs/                    # Architecture, deployment, database docs
└── deploy/                  # Kubernetes manifests
```

---

## Development

```bash
# Start dependencies only
docker compose up -d db redis

# Backend (hot-reload)
cd backend && npm install && npm run dev

# Frontend (Vite dev server, proxies /api → :3000)
cd frontend && npm install && npm run dev

# Tests
cd backend && npm test
```

### Testing

The backend suite (Vitest) runs without any hardware or database:

- **Pure parsers** - `show version/interfaces/mac/cdp/vlan/arp/power/env` across IOS, IOS-XE and NX-OS samples
- **Mock Cisco SSH device** (`tests/helpers/mockCiscoDevice.ts`) - a fake IOS device (shell channel, enable mode, config mode, canned `show` output) that the **real** `CiscoSshSession` connects to over loopback, exercising the prompt/read loop, exec extraction and config-error handling end-to-end
- **Compliance evaluator, security policy, RBAC, capability DB, OUI/lifecycle** - pure-function coverage

With a Postgres available (`RUN_DB_TESTS=1`, as in CI), the suite also runs:

- **HTTP route tests** via Fastify `inject` - auth (lockout, throttling, password policy), the full MFA cycle including recovery codes, token refresh, ws-token nonces, and RBAC enforcement
- **Audit chain tamper tests** - modifying or deleting a committed audit row must fail verification at exactly that entry

The frontend has its own Vitest + React Testing Library suite (`npm test` in `frontend/`) covering the login and MFA-enrollment flows.

CI (`.github/workflows/ci.yml`) typechecks both halves, runs backend tests with coverage against a Postgres service, runs the frontend component tests, and builds both Docker images on every push.

---

## Supported Hardware

| Family | Models | Notes |
|---|---|---|
| Catalyst 2960/2960X/2960L | WS-C2960-*, WS-C2960X-*, WS-C2960L-* | Access layer |
| Catalyst 3560/3560CX | WS-C3560-*, WS-C3560CX-* | Access/distribution |
| Catalyst 3750/3750X | WS-C3750-*, WS-C3750X-* | Stackable access |
| Catalyst 3850/3650 | WS-C3850-*, WS-C3650-* | StackWise |
| Catalyst 4500 | WS-C4500X-*, WS-C4507R, … | Distribution/core |
| Catalyst 6500 | WS-C6504/6506/6509/6513 | Core (legacy) |
| Catalyst 9200/9300/9400/9500/9600 | C9200-*, C9300-*, … | Modern IOS-XE |
| Nexus 3000 | N3K-C3* | NX-OS |
| Nexus 5000/5500/5600 | N5K-C5*, N55-*, N56-* | NX-OS (EOS) |
| Nexus 7000 | N7K-C7* | NX-OS |
| Nexus 9000 | N9K-C9* | NX-OS |

Any IOS/IOS-XE/NX-OS device reachable over SSH will work; unsupported models fall back to a safe common feature set.
