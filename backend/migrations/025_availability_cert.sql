-- Per-device availability rollup: one row per device per hour holding the up /
-- total status-poll counts, so availability % over any window is a cheap
-- aggregate (no per-poll row explosion). Pruned with the other history tables.
CREATE TABLE IF NOT EXISTS device_availability (
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hour      TIMESTAMPTZ NOT NULL,
  up        INTEGER NOT NULL DEFAULT 0,
  total     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, hour)
);
CREATE INDEX IF NOT EXISTS device_availability_hour_idx ON device_availability (hour);

-- TLS / management-certificate expiry, populated by the daily cert check.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS cert_expires_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS cert_checked_at TIMESTAMPTZ;
