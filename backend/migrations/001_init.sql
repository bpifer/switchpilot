-- SwitchPilot initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Users & RBAC =====
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL DEFAULT '',
    email         TEXT,
    password_hash TEXT,                          -- null for LDAP-only accounts
    auth_source   TEXT NOT NULL DEFAULT 'local', -- local | ldap | azuread
    role          TEXT NOT NULL DEFAULT 'readonly'
                  CHECK (role IN ('superadmin','netadmin','helpdesk','readonly')),
    mfa_secret    TEXT,                          -- TOTP secret, encrypted
    mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- ===== Sites =====
CREATE TABLE sites (
    id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL DEFAULT ''
);

-- ===== Credentials (shared SSH/SNMP credential profiles) =====
CREATE TABLE credentials (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    ssh_username TEXT NOT NULL DEFAULT '',
    ssh_password_enc TEXT NOT NULL DEFAULT '',   -- AES-256-GCM
    enable_password_enc TEXT NOT NULL DEFAULT '',
    snmp_version TEXT NOT NULL DEFAULT '2c' CHECK (snmp_version IN ('2c','3')),
    snmp_community_enc TEXT NOT NULL DEFAULT '',
    snmpv3_user TEXT NOT NULL DEFAULT '',
    snmpv3_auth_proto TEXT NOT NULL DEFAULT 'sha',
    snmpv3_auth_key_enc TEXT NOT NULL DEFAULT '',
    snmpv3_priv_proto TEXT NOT NULL DEFAULT 'aes',
    snmpv3_priv_key_enc TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Devices =====
CREATE TABLE devices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hostname      TEXT NOT NULL DEFAULT '',
    mgmt_ip       INET NOT NULL UNIQUE,
    model         TEXT NOT NULL DEFAULT '',      -- e.g. WS-C2960X-48FPD-L, C9300-48P
    family        TEXT NOT NULL DEFAULT '',      -- catalyst2960|catalyst3560|catalyst3750|catalyst9200|catalyst9300|catalyst9400
    serial_number TEXT NOT NULL DEFAULT '',
    ios_version   TEXT NOT NULL DEFAULT '',
    site_id       UUID REFERENCES sites(id) ON DELETE SET NULL,
    location      TEXT NOT NULL DEFAULT '',
    credential_id UUID REFERENCES credentials(id) ON DELETE SET NULL,
    protocols     JSONB NOT NULL DEFAULT '["ssh","snmp"]',  -- enabled mgmt protocols
    status        TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online','offline','degraded','unknown')),
    last_seen_at  TIMESTAMPTZ,
    uptime_seconds BIGINT,
    cpu_pct       REAL,
    mem_pct       REAL,
    temperature_c REAL,
    psu_status    JSONB NOT NULL DEFAULT '[]',
    fan_status    JSONB NOT NULL DEFAULT '[]',
    stack_members JSONB NOT NULL DEFAULT '[]',   -- [{member, model, serial, role, state}]
    capabilities  JSONB NOT NULL DEFAULT '{}',   -- resolved from capability DB at onboard/refresh
    monitor_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX devices_status_idx ON devices(status);
CREATE INDEX devices_site_idx ON devices(site_id);

-- ===== Ports (latest known state per interface) =====
CREATE TABLE ports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,                   -- Gi1/0/1
    description TEXT NOT NULL DEFAULT '',
    admin_up    BOOLEAN NOT NULL DEFAULT TRUE,
    oper_status TEXT NOT NULL DEFAULT 'unknown', -- connected|notconnect|disabled|err-disabled|unknown
    vlan        TEXT NOT NULL DEFAULT '',        -- access vlan number, 'trunk' or 'routed'
    mode        TEXT NOT NULL DEFAULT 'access',  -- access|trunk|routed
    speed       TEXT NOT NULL DEFAULT '',
    duplex      TEXT NOT NULL DEFAULT '',
    poe_watts   REAL,
    input_errors  BIGINT NOT NULL DEFAULT 0,
    output_errors BIGINT NOT NULL DEFAULT 0,
    last_flap_at  TIMESTAMPTZ,
    flap_count_1h INTEGER NOT NULL DEFAULT 0,
    macs        JSONB NOT NULL DEFAULT '[]',     -- learned MAC addresses
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, name)
);

-- ===== Configuration backups =====
CREATE TABLE config_backups (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'running' CHECK (kind IN ('running','startup')),
    content    TEXT NOT NULL,
    sha256     TEXT NOT NULL,
    taken_by   TEXT NOT NULL DEFAULT 'scheduler', -- username or 'scheduler'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX config_backups_device_idx ON config_backups(device_id, created_at DESC);

-- Baseline config for drift detection / auto-remediation
CREATE TABLE config_baselines (
    device_id  UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    backup_id  UUID NOT NULL REFERENCES config_backups(id) ON DELETE CASCADE,
    auto_remediate BOOLEAN NOT NULL DEFAULT FALSE,
    set_by     TEXT NOT NULL,
    set_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Templates =====
CREATE TABLE templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'general', -- vlan|interface|qos|acl|stp|snmp|ntp|aaa|security|general
    body        TEXT NOT NULL,                   -- IOS commands; {{var}} placeholders
    variables   JSONB NOT NULL DEFAULT '[]',     -- [{name, label, default}]
    min_capabilities JSONB NOT NULL DEFAULT '[]',-- required capability flags
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Jobs (scheduled/bulk operations & automation) =====
CREATE TABLE jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL,        -- config_push|backup|firmware_upgrade|compliance|bounce_port|custom
    name        TEXT NOT NULL DEFAULT '',
    payload     JSONB NOT NULL DEFAULT '{}',
    device_ids  UUID[] NOT NULL DEFAULT '{}',
    schedule_at TIMESTAMPTZ,          -- null = run now
    cron        TEXT,                 -- recurring jobs
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE TABLE job_results (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id    UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    success   BOOLEAN NOT NULL,
    output    TEXT NOT NULL DEFAULT '',
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Automation rules =====
CREATE TABLE automation_rules (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name      TEXT NOT NULL UNIQUE,
    enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    trigger   TEXT NOT NULL,          -- port_down|device_offline|cpu_high|config_drift|temp_high|psu_fail|fan_fail|port_flapping
    condition JSONB NOT NULL DEFAULT '{}',  -- e.g. {"threshold":90,"minutes":10}
    action    TEXT NOT NULL,          -- notify|restore_baseline|run_template|disable_port
    action_params JSONB NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Alerts =====
CREATE TABLE alerts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id  UUID REFERENCES devices(id) ON DELETE CASCADE,
    severity   TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
    kind       TEXT NOT NULL,         -- device_offline|cpu_high|mem_high|temp_high|psu_fail|fan_fail|port_flapping|interface_errors|config_drift|stp_change|link_change
    message    TEXT NOT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX alerts_open_idx ON alerts(created_at DESC) WHERE resolved_at IS NULL;

-- ===== Topology (CDP/LLDP neighbors) =====
CREATE TABLE topology_links (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    local_port TEXT NOT NULL,
    neighbor_name TEXT NOT NULL,
    neighbor_port TEXT NOT NULL DEFAULT '',
    neighbor_ip   TEXT NOT NULL DEFAULT '',
    neighbor_platform TEXT NOT NULL DEFAULT '',
    protocol   TEXT NOT NULL DEFAULT 'cdp' CHECK (protocol IN ('cdp','lldp')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, local_port, neighbor_name)
);

-- ===== Firmware =====
CREATE TABLE firmware_images (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename  TEXT NOT NULL UNIQUE,
    family    TEXT NOT NULL,
    version   TEXT NOT NULL,
    md5       TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE firmware_compliance (
    family          TEXT PRIMARY KEY,
    target_version  TEXT NOT NULL,
    set_by          TEXT NOT NULL,
    set_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Metrics history (time series, pruned by scheduler) =====
CREATE TABLE device_metrics (
    device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    cpu_pct    REAL,
    mem_pct    REAL,
    temperature_c REAL
);
CREATE INDEX device_metrics_idx ON device_metrics(device_id, ts DESC);

-- ===== Audit log =====
CREATE TABLE audit_log (
    id         BIGSERIAL PRIMARY KEY,
    username   TEXT NOT NULL,
    action     TEXT NOT NULL,         -- login|logout|device.create|config.push|port.disable|...
    target     TEXT NOT NULL DEFAULT '',
    detail     JSONB NOT NULL DEFAULT '{}',
    ip         TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_time_idx ON audit_log(created_at DESC);

-- Default admin user is seeded by the API at startup (backend/src/db.ts)
-- so the bcrypt hash is generated at runtime, never committed to source.
