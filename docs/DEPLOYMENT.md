# Deployment Guide

## 1. Docker Compose (recommended for ≤ a few hundred switches)

```bash
git clone <repo> && cd cisco-switch-manager
cp .env.example .env
# REQUIRED edits in .env:
#   POSTGRES_PASSWORD   – strong password
#   JWT_SECRET          – long random string
#   CREDENTIAL_KEY      – openssl rand -hex 32
docker compose up -d --build
```

- Web UI: `http://<host>:8080` (terminate TLS in front — see below)
- API/Swagger: `http://<host>:3000/docs`
- First login: `admin / ChangeMe123!` → forced password change.

### TLS
Put any TLS terminator in front of port 8080 (Caddy, Traefik, nginx, or your
load balancer). Example Caddyfile:

```
switchpilot.example.com {
    reverse_proxy localhost:8080
}
```

### Upgrades
```bash
git pull
docker compose build
docker compose up -d        # migrations run automatically at API startup
```
Database schema migrations are forward-only and tracked in `schema_migrations`.
Take a `pg_dump` before upgrading.

### Backups
```bash
docker compose exec db pg_dump -U switchpilot switchpilot > switchpilot-$(date +%F).sql
```
Volumes: `pgdata` (database), `firmware` (uploaded IOS images).

## 2. Kubernetes

Manifests in `deploy/k8s/`:

```bash
kubectl create namespace switchpilot
kubectl -n switchpilot create secret generic switchpilot-secrets \
  --from-literal=POSTGRES_PASSWORD=... \
  --from-literal=JWT_SECRET=... \
  --from-literal=CREDENTIAL_KEY=$(openssl rand -hex 32)
kubectl -n switchpilot apply -f deploy/k8s/
```

Notes:
- The API Deployment runs 1 replica by default because the scheduler is
  in-process. Scale the API horizontally only after splitting the scheduler
  into its own deployment (`ROLE` env split) or accept duplicate polling.
- Use your ingress controller for TLS.
- Postgres/Redis manifests are starter-grade; production should use a managed
  database or an operator (CloudNativePG, Redis Operator).

## 3. Bare Windows / Linux server

Prereqs: Node.js 20+, PostgreSQL 14+, Redis 6+.

```bash
# backend
cd backend && npm ci && npm run build
POSTGRES_HOST=... JWT_SECRET=... CREDENTIAL_KEY=... node dist/index.js
# frontend
cd frontend && npm ci && npm run build   # serve dist/ with nginx/IIS, proxy /api
```

On Windows, register the API as a service with `nssm` or a Scheduled Task; on
Linux use the systemd unit pattern (`ExecStart=/usr/bin/node dist/index.js`).

## Network requirements

| From | To | Port | Purpose |
|---|---|---|---|
| api | switches | TCP 22 | SSH management |
| api | switches | UDP 161 | SNMP polling |
| switches | api | TCP 3000/8080 | firmware download (`copy http:`) — set `PLATFORM_URL` |
| api | SMTP/Teams/Slack | 443/587 | alert delivery |
| api | domain controllers | TCP 389/636 | LDAP auth (optional) |

## CI/CD

`.github/workflows/ci.yml` typechecks, tests, and builds both images on every
push; wire the `docker build` outputs to your registry to complete the pipeline.
