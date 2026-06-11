# SwitchPilot — Cisco Switch Management Platform

A self-hosted, enterprise-grade management dashboard for Cisco Catalyst and Nexus switches.
Communicates directly over **SSH and SNMP** — no Cisco DNA Center, no Meraki licensing, no cloud dependency.

---

## Features

### Device Management
- **Inventory** — hostname, model, serial, IOS/NX-OS version, uptime, CPU/memory/temperature, PSU & fan status, stack members
- **Auto-detection** — SSH/SNMP probing resolves capabilities from a built-in model database (gates commands per model + OS version)
- **NX-OS support** — Nexus 3K/5K/7K/9K: skips enable mode, uses `copy running-config startup-config`, NX-OS-aware parsers for `show version`, `show environment`, `show system resources`, MAC table `*`-prefix rows
- **Sites** — group devices by physical location for rollup reporting
- **Bulk CSV import** — onboard many switches at once from a spreadsheet

### Configuration
- **Backup & restore** — scheduled automatic backups, on-demand, restore any snapshot
- **Git versioning** — every backup commits to a local git repo (`/data/config-history`), laid out as `configs/<site>/<hostname>.cfg`; the commit **author** is the user who triggered it and **Reason** / **Ticket** are recorded as commit trailers for audit. Browse the per-device history timeline, view config at any commit, and diff any two versions in the UI (or via `GET /api/devices/:id/config/git-log`, `…/git-show/:sha`, `…/git-diff`). The repo is auto-`gc`'d nightly.
- **Diff** — compare any two backups or a backup against live running config
- **Push & templates** — send arbitrary config lines or render reusable templates (VLANs, interfaces, port security, QoS, ACLs, trunks, STP, SNMP, NTP, AAA)
- **Drift detection** — compare running config to a pinned baseline; optional auto-remediation

### Port Management
- **Graphical front-panel** — port status, VLAN, speed, PoE watts
- **Actions** — enable/disable, bounce (shutdown/no shutdown), cable test (TDR)
- **Historical metrics** — per-port bandwidth and error counters over time

### Monitoring & Alerting
- **Continuous polling** — online/offline, CPU, memory, temperature, PSU/fan, port flapping, interface errors
- **Syslog ingest** — UDP syslog receiver (port 514); parses link-down, config-change, PoE-fault, and hardware-error events from IOS and NX-OS
- **Config-change alerting** — scheduler detects changed backups and raises a `config_changed` alert
- **Notifications** — Email (SMTP), Microsoft Teams webhook, Slack webhook
- **Maintenance windows** — suppress alerts for planned outages; scoped to all devices or a specific list
- **Real-time push** — WebSocket endpoint (`/ws`) streams alerts to the dashboard instantly via Redis pub/sub (scales across multiple API replicas)

### Endpoint Tracking
- **Endpoint Inventory** — MAC table + ARP correlation gives you every endpoint: IP, MAC, vendor (150+ OUI prefixes), reverse-DNS hostname, port, switch, VLAN; export to CSV
- **Endpoint Locator** — search by IP, MAC (any format), or hostname; returns Switch, Port, VLAN, CDP/LLDP Neighbor, Site instantly
- **Client history** — track every port and switch a MAC address has been seen on over time

### Network Intelligence
- **Topology** — Layer-2 maps built from CDP/LLDP neighbor data
- **ARP/IP correlation** — layer-3 switches supply IP→MAC mapping; populates `ip_address` on every tracked endpoint
- **CDP/LLDP discovery** — suggests unmanaged neighbors as onboarding candidates
- **VLAN visualization** — per-device VLAN table with port membership

### PoE Dashboard
- Per-switch utilization: used watts, total budget, remaining headroom
- Per-site rollup cards color-coded by utilization (green / amber / red)
- Fleet-level totals across all PoE-capable switches

### Switch Lifecycle Tracking
- End-of-Sale and End-of-Life dates for 50+ Cisco Catalyst and Nexus model families, stored in an editable **`lifecycle_catalog`** table (longest-prefix match)
- Populated automatically at each device refresh
- Dashboard shows switches nearing or past EOL; recommended IOS/NX-OS release per platform
- Super Admins can add/edit/delete catalog entries in the UI — correct dates or add new models without a code release (ready for a future Cisco EoX feed import)

### Firmware Management
- **Image upload** — server-side MD5 verification; images served for `copy http:` transfers
- **Compliance tracking** — set a target version per platform family; report which devices are behind
- **Ring-based campaigns** — staged rollouts across Pilot / Production / Critical rings with configurable wait days between rings; manual or automatic advancement

### Automation
- **Scheduled jobs** — one-shot or recurring (cron expressions); config push, backup, compliance check, firmware upgrade, port bounce, custom commands
- **Cluster-safe job engine** — jobs are claimed atomically with Postgres `FOR UPDATE SKIP LOCKED`, so any number of API/worker replicas can run side-by-side with no double execution. Running jobs heartbeat; a reaper requeues work orphaned by a crashed worker. Failed jobs retry with exponential backoff (`maxAttempts`), and the Jobs page streams **live per-device progress** over WebSocket with a one-click **retry failed**.
- **Event triggers** — device_offline, cpu_high, temp_high, psu_fail, fan_fail, port_down, port_flapping, config_drift → notify / restore baseline / run template / disable port

### Security & Access Control
- **RBAC** — Super Admin / Network Admin / Help Desk / Read Only
- **Auth** — local accounts, LDAP/Active Directory, TOTP MFA
- **Credential vault** — AES-256-GCM encrypted SSH and SNMP credentials
- **Audit log** — every write action recorded with username and IP
- **Full REST API** — OpenAPI/Swagger docs at `/docs`

---

## Quick Start (Docker Compose)

```bash
git clone https://github.com/bpifer/switchpilot.git
cd switchpilot
cp .env.example .env      # set POSTGRES_PASSWORD, JWT_SECRET, CREDENTIAL_KEY
docker compose up -d --build
```

Open **http://localhost:8080**

Default credentials: `admin` / `ChangeMe123!` — you are prompted to change the password on first login.

API docs: **http://localhost:3000/docs**

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | `switchpilot` | **Required in production** |
| `JWT_SECRET` | `dev-only-secret` | **Required in production** — 32+ random chars |
| `CREDENTIAL_KEY` | `00…00` (32 bytes hex) | AES-256-GCM key for credential encryption |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `FIRMWARE_DIR` | `/data/firmware` | Where IOS image files are stored |
| `CONFIG_HISTORY_DIR` | `/data/config-history` | Git repo for config version history |
| `SYSLOG_PORT` | `514` | UDP syslog receive port |
| `SMTP_HOST` | — | SMTP server for email alerts |
| `TEAMS_WEBHOOK_URL` | — | Microsoft Teams incoming webhook |
| `SLACK_WEBHOOK_URL` | — | Slack incoming webhook |
| `LDAP_URL` | — | LDAP/AD server (e.g. `ldap://dc.corp.local`) |

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
│   │   └── 005_job_reliability_lifecycle_catalog.sql
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
