# Disaster recovery & upgrade rollback

What to back up, how to restore, and how to roll back a bad upgrade. Commands
assume the Docker Compose deployment (service names `db`, `api`; volumes
`pgdata`, `firmware`, `confighistory`).

## What actually holds state

| Where | Contains | Recoverable without it? |
|---|---|---|
| Postgres (`pgdata` volume) | everything: devices, credentials (encrypted), users, alerts, audit log, metrics, compliance | no - this is the system of record |
| `confighistory` volume (`/data/config-history`) | git repo of every config backup | configs are also rows in Postgres; the git repo adds the browsable history/diff |
| `firmware` volume (`/data/firmware`) | uploaded IOS/firmware images | re-uploadable |
| `.env` | `POSTGRES_PASSWORD`, `JWT_SECRET`, **`CREDENTIAL_KEY`** | see warning below |
| Redis | cache + pub/sub only | yes, fully ephemeral |

> **Back up `.env` (offline, encrypted).** `CREDENTIAL_KEY` decrypts every stored
> SSH/SNMP credential. Lose it and the database restores fine but **all device
> passwords are unrecoverable** (you re-enter them). `JWT_SECRET` changing just
> logs everyone out.

**Recovering a stored device password.** As long as you still have
`CREDENTIAL_KEY` and the database, you can read back the plaintext SSH login
SwitchPilot uses for a device - useful if you've lost the switch's own password
but it is still onboarded:

```bash
docker compose exec api npm run show-credential -- 192.168.1.20   # by mgmt IP
docker compose exec api npm run show-credential -- core-switch     # by hostname
docker compose exec api npm run show-credential                    # list devices
```

It decrypts with the running `CREDENTIAL_KEY`, so it exposes nothing a key-holder
could not already decrypt; it just prints the login to stdout. Run it in a
private shell.

## Backup

Run on the host (a nightly cron is recommended):

```bash
cd /opt/switchpilot
ts=$(date +%F)
# 1. database (logical dump, compressed)
docker compose exec -T db pg_dump -U switchpilot -d switchpilot | gzip > backup-db-$ts.sql.gz
# 2. data volumes (firmware + config-history git repo)
docker run --rm -v switchpilot_confighistory:/d -v "$PWD":/out alpine \
  tar czf /out/backup-confighistory-$ts.tgz -C /d .
docker run --rm -v switchpilot_firmware:/d -v "$PWD":/out alpine \
  tar czf /out/backup-firmware-$ts.tgz -C /d .
# 3. secrets (store this somewhere safe, NOT next to the DB dump)
cp .env backup-env-$ts
```

Copy the resulting files off-box. (Volume names are prefixed with the compose
project name, usually the directory: `switchpilot_pgdata` etc. - check with
`docker volume ls`.)

## Restore

```bash
cd /opt/switchpilot
cp backup-env-<ts> .env                      # secrets first (esp. CREDENTIAL_KEY)
docker compose up -d db && sleep 5           # need the DB up to load into it
gunzip -c backup-db-<ts>.sql.gz | docker compose exec -T db psql -U switchpilot -d switchpilot
docker run --rm -v switchpilot_confighistory:/d -v "$PWD":/in alpine \
  sh -c 'cd /d && tar xzf /in/backup-confighistory-<ts>.tgz'
docker run --rm -v switchpilot_firmware:/d -v "$PWD":/in alpine \
  sh -c 'cd /d && tar xzf /in/backup-firmware-<ts>.tgz'
docker compose up -d --build                 # bring the rest up
```

For a clean restore into an empty database, recreate it first
(`docker compose down -v` wipes volumes - destructive), or restore into a fresh
`pgdata`.

## Upgrades and rollback

Migrations run automatically on `api` start and are **forward-only** (there are
no down-migrations). So the rollback strategy is snapshot-based, not
schema-reversal:

1. **Before upgrading**, take a DB dump (step 1 above) and note the current
   commit/image (`git rev-parse HEAD`).
2. Upgrade: `git pull && docker compose up -d --build`. Watch `docker compose
   logs api` for `migration applied:` lines and any error.
3. **If the upgrade is bad**, roll back:
   ```bash
   git checkout <previous-commit>
   gunzip -c backup-db-<pre-upgrade-ts>.sql.gz | docker compose exec -T db psql -U switchpilot -d switchpilot
   docker compose up -d --build
   ```
   Restore the pre-upgrade DB dump because a newer migration may have changed the
   schema in a way the older code does not expect. Do not run new code against an
   old dump or vice versa without restoring the matching pair.

Test a major upgrade against a copy first if the instance manages anything you
cannot afford to re-enter.
