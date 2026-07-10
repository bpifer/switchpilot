# Security policy

SwitchPilot stores switch admin credentials and can push configuration to
network devices, so security reports are taken seriously and handled quickly.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's private vulnerability reporting:
**[Security → Report a vulnerability](https://github.com/bpifer/switchpilot/security/advisories/new)**.

Include what you can: affected version/commit, reproduction steps, and impact.
You'll get an acknowledgement within a few days. Please allow a reasonable
window for a fix before public disclosure.

## Scope

In scope:

- Authentication / authorization bypass (JWT, RBAC roles, API keys, MFA)
- Credential vault issues (AES-256-GCM storage, key rotation, secret leakage
  in logs, audit entries, or API responses)
- Injection of any kind — SQL, CLI command injection into device sessions,
  SNMP OID manipulation
- Audit-log tamper-evidence bypass
- SSRF / request forgery through webhook, LDAP, MQTT, or firmware-fetch URLs
- Container / compose configuration weaknesses in the shipped deployment

Out of scope:

- Vulnerabilities in the managed switches themselves
- Issues requiring an already-compromised host or database
- Denial of service against your own self-hosted instance

## Deployment expectations

SwitchPilot is designed to run on a trusted management network. The threat
model and hardening notes live in
[docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md). In particular:

- Never expose the API/UI directly to the internet without a reverse proxy,
  TLS, and network-level access control.
- `JWT_SECRET` and `CREDENTIAL_KEY` must be unique per install; the API
  refuses to start with defaults in production.
- The syslog/SNMP-trap/NetFlow UDP listeners trust the network layer — keep
  them on the management VLAN.
