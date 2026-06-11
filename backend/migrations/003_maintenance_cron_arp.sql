-- Recurring cron jobs: store next scheduled execution time
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS jobs_cron_idx ON jobs (next_run_at) WHERE cron IS NOT NULL;

-- Maintenance windows: suppress alerts during planned outages
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  device_ids  UUID[] NOT NULL DEFAULT '{}',  -- empty array = applies to ALL devices
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mw_valid_range CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS mw_active_idx ON maintenance_windows (starts_at, ends_at);

-- ARP-correlated IP address per tracked client
ALTER TABLE client_tracking ADD COLUMN IF NOT EXISTS ip_address INET;
CREATE INDEX IF NOT EXISTS ct_ip_idx ON client_tracking (ip_address) WHERE ip_address IS NOT NULL;
