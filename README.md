# SwitchPilot — Cisco Switch Management Platform

A self-hosted, Meraki-style management dashboard for traditional Cisco Catalyst switches.
Manages devices directly over **SSH, SNMP, RESTCONF, and NETCONF** — no Meraki licensing required.

## Features

- **Device inventory** — hostname, model, serial, IOS version, uptime, CPU/memory/temperature, PSU & fan status, stack members
- **Onboarding** — manual model selection or auto-detection via SSH/SNMP; a model **capability database** gates which features/commands are exposed per model + IOS version
- **Configuration management** — view running/startup config, diff, automatic backups, restore, push, scheduled & bulk changes, reusable templates (VLANs, interfaces, port security, QoS, ACLs, trunks, STP, SNMP, NTP, AAA)
- **Port management** — graphical switch front-panel view, port status/VLAN/PoE, enable/disable, bounce, cable test (TDR), learned MAC addresses
- **Monitoring & alerts** — online/offline, CPU, memory, interface errors, port flapping, temperature, PSU/fan failures; alerts to Email, Teams, Slack, generic webhooks
- **Topology** — automatic Layer-2 maps from CDP/LLDP neighbor data
- **Firmware management** — image upload, MD5 verification, scheduled upgrades, compliance tracking
- **RBAC** — Super Admin / Network Admin / Help Desk / Read Only; local accounts + LDAP/Active Directory; TOTP MFA
- **Automation engine** — scheduled jobs, compliance/drift checks with auto-remediation, event-triggered actions
- **Full REST API** with OpenAPI/Swagger docs at `/docs`
- **Security** — HTTPS, AES-256-GCM credential storage, audit logging, config change history

## Quick start (Docker Compose)

```bash
cp .env.example .env        # edit secrets!
docker compose up -d --build
```

Then open `http://localhost:8080` (put a TLS-terminating proxy in front for production).
Default login: `admin` / `ChangeMe123!` — you are forced to change it on first login.

API docs: `http://localhost:3000/docs`

## Repository layout

| Path | Purpose |
|---|---|
| `backend/` | Fastify + TypeScript API, Cisco communication engine, scheduler |
| `frontend/` | React + TypeScript + Tailwind dashboard |
| `backend/migrations/` | PostgreSQL schema |
| `docs/` | Architecture, deployment, database docs |
| `deploy/` | Kubernetes manifests |

## Development

```bash
# backend
cd backend && npm install && npm run dev      # needs Postgres + Redis (docker compose up db redis)
# frontend
cd frontend && npm install && npm run dev     # proxies /api to :3000
# tests
cd backend && npm test
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
