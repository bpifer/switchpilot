-- Outbound alert webhooks (Slack/Teams/PagerDuty/custom) and API keys for
-- programmatic access (scripts, Grafana, Ansible, Netbox sync).

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  secret        TEXT NOT NULL DEFAULT '',     -- HMAC-SHA256 signature when set
  min_severity  TEXT NOT NULL DEFAULT 'warning' CHECK (min_severity IN ('info','warning','critical')),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fired_at TIMESTAMPTZ,
  last_status   TEXT NOT NULL DEFAULT ''      -- e.g. "200" or "error: timeout"
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,          -- sha256 of the sp_... token
  role         TEXT NOT NULL DEFAULT 'readonly' CHECK (role IN ('superadmin','netadmin','helpdesk','readonly')),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
