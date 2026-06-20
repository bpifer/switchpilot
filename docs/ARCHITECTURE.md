# SwitchPilot Architecture

## Overview

```
┌──────────────┐     HTTPS      ┌─────────────────────────────────────────┐
│   Browser    │ ─────────────▶ │  web (nginx)                            │
│  React SPA   │                │   • serves SPA                          │
└──────────────┘                │   • proxies /api → api:3000             │
                                └──────────────────┬──────────────────────┘
                                                   │
                                ┌──────────────────▼──────────────────────┐
                                │  api (Fastify, Node 20, TypeScript)     │
                                │   • REST API + OpenAPI (/docs)          │
                                │   • JWT auth, RBAC, TOTP MFA, LDAP      │
                                │   • Scheduler (node-cron + intervals)   │
                                │   • Job engine (bulk/scheduled ops)     │
                                │   • Automation rules engine             │
                                │   • Alert dispatch (SMTP/Teams/Slack)   │
                                └───────┬───────────┬──────────┬──────────┘
                                        │           │          │
                              ┌─────────▼──┐  ┌─────▼────┐  ┌──▼───────────────────┐
                              │ PostgreSQL │  │  Redis   │  │ Cisco comm engine    │
                              │ inventory, │  │ cache,   │  │  • ssh2 shell driver │
                              │ configs,   │  │ poll     │  │  • net-snmp (v2c/v3) │
                              │ alerts,    │  │ markers  │  │  • IOS parsers       │
                              │ audit, RBAC│  └──────────┘  │  • capability DB     │
                              └────────────┘                └──┬───────────────────┘
                                                               │ SSH / SNMP /
                                                               │ (RESTCONF, NETCONF on IOS-XE)
                                                  ┌────────────▼────────────┐
                                                  │ Catalyst 2960/3560/3750 │
                                                  │ Catalyst 9200/9300/9400 │
                                                  └─────────────────────────┘
```

## Key design decisions

### Capability database (`backend/src/cisco/capabilities.json`)
Each switch family declares its protocols (SSH/SNMP/RESTCONF/NETCONF), feature
flags (PoE, stacking, layer-3, TDR, install-mode, QoS style, max VLANs) and the
exact CLI commands to use. Model-conditional flags (`"poe": "model"`) are
resolved from the model suffix at onboarding (`resolveCapabilities`). RESTCONF/
NETCONF are additionally gated on IOS-XE ≥ 16.6. The API refuses template
deployments whose `min_capabilities` a target device lacks, so unsupported
commands are never offered.

### SSH driver
`CiscoSshSession` uses an interactive shell channel (not exec) because IOS often
restricts exec channels, and enable/config mode need a persistent session. It
handles `--More--` paging, legacy kex/cipher negotiation for old 2960s,
`terminal length 0`, enable-password escalation, and aborts a config push on
`% Invalid input` style errors.

### Polling model
- **Status poll** (default 60 s): cheap SNMP `sysUpTime` probe, SSH fallback;
  flips devices online/offline and raises/auto-resolves `device_offline`.
- **Metrics refresh** (default 300 s): one SSH session per device collects
  `show version`, CPU/memory, environment, stack, interface status, MAC table,
  PoE, CDP/LLDP — updating inventory, the port table, time-series metrics, and
  the topology graph. Concurrency-capped worker pool (8 devices at a time).
- **Nightly backups** + **drift checks** via cron expressions in `.env`.

### Configuration safety
Every config push or restore takes an automatic pre-change backup. Backups are
deduplicated by SHA-256 of the normalized config (volatile lines stripped).
Baselines enable drift detection; `auto_remediate` replays the baseline.

### Security
- Device credentials encrypted at rest with AES-256-GCM (`CREDENTIAL_KEY`).
- JWT (8 h default) + role hierarchy superadmin > netadmin > helpdesk > readonly.
- TOTP MFA (otplib), LDAP/AD with group→role mapping, JIT provisioning.
- Append-only `audit_log` records every login and mutating action with IP.
- HTTPS is expected to be terminated by nginx/ingress in front of the stack.

### Scaling beyond a homelab (design direction, not yet proven)
This is how the architecture is *meant* to scale. It is validated at homelab
scale (tens of devices), not at the thousands this section implies. Two gaps to
close before that claim is real: the SSH session pool (`sshPool.ts`) is in-memory
per replica (not shared), and `monitorService.refreshDevice` issues 10+
sequential `exec()` calls per device per metrics cycle - both fine at small
scale, both bottlenecks at large scale.

- Stateless API — run multiple replicas behind the ingress. Cron sweeps are
  guarded by a Postgres advisory lock (leader election), so every replica runs
  the same image and exactly one performs each sweep (there is no separate
  worker role). Shared file state (firmware, config-history git repo) needs
  ReadWriteMany storage for multi-replica — see `deploy/k8s/switchpilot.yaml`.
- Postgres holds all state; `device_metrics` is pruned at 30 days
  (swap in TimescaleDB for long retention).
- Poll intervals and worker concurrency are tunable via environment.
- Redis caches hot reads and can back a BullMQ queue if job volume outgrows
  the in-process runner.
