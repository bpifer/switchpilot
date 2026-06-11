# Database Schema

PostgreSQL 14+. Schema lives in `backend/migrations/` and is applied
automatically at API startup (tracked in `schema_migrations`).

| Table | Purpose |
|---|---|
| `users` | Local/LDAP accounts, role, bcrypt hash, encrypted TOTP secret |
| `sites` | Physical sites for grouping devices |
| `credentials` | Shared SSH/SNMP credential profiles — all secrets AES-256-GCM encrypted |
| `devices` | Switch inventory: identity, health snapshot (CPU/mem/temp/PSU/fans), stack members, resolved capability flags (JSONB) |
| `ports` | Latest interface state per device: status, VLAN, speed, PoE watts, error counters, flap tracking, learned MACs |
| `config_backups` | Full running/startup configs, SHA-256 deduplicated |
| `config_baselines` | Per-device golden config pointer + auto-remediate flag |
| `templates` | Reusable IOS snippets with `{{variable}}` placeholders and required-capability list |
| `jobs` / `job_results` | Bulk & scheduled operations with per-device outcomes |
| `automation_rules` | Trigger → condition → action rules |
| `alerts` | Open/resolved alerts with severity, dedup on (device, kind, open) |
| `topology_links` | CDP/LLDP neighbor adjacencies (rebuilt each refresh) |
| `firmware_images` | Uploaded IOS images with MD5 + size |
| `firmware_compliance` | Target IOS version per family |
| `device_metrics` | CPU/mem/temp time series (pruned at 30 days) |
| `audit_log` | Append-only action log (user, action, target, detail, IP) |

Relationships: `devices.site_id → sites`, `devices.credential_id → credentials`,
`ports/config_backups/alerts/topology_links/device_metrics.device_id → devices`
(CASCADE on device delete), `config_baselines.backup_id → config_backups`.
