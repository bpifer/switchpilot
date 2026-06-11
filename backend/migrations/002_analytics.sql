-- Client tracking: one row per (device, mac), updated each refresh
CREATE TABLE IF NOT EXISTS client_tracking (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  port_name   TEXT NOT NULL,
  mac         TEXT NOT NULL,
  vlan        INT,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ct_device_mac UNIQUE (device_id, mac)
);
CREATE INDEX IF NOT EXISTS idx_ct_mac          ON client_tracking(mac);
CREATE INDEX IF NOT EXISTS idx_ct_device_port  ON client_tracking(device_id, port_name);
CREATE INDEX IF NOT EXISTS idx_ct_last_seen    ON client_tracking(last_seen DESC);

-- Per-port bandwidth + error metrics sampled at each full refresh
CREATE TABLE IF NOT EXISTS port_metrics (
  id          BIGSERIAL PRIMARY KEY,
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  port_name   TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  in_bps      BIGINT,
  out_bps     BIGINT,
  in_errors   INT,
  out_errors  INT,
  status      TEXT
);
CREATE INDEX IF NOT EXISTS idx_pm_device_port ON port_metrics(device_id, port_name, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_device_time ON port_metrics(device_id, recorded_at DESC);

-- VLAN names + access port membership per device (rebuilt each refresh)
CREATE TABLE IF NOT EXISTS device_vlans (
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  vlan_id    INT NOT NULL,
  name       TEXT,
  ports      JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, vlan_id)
);

-- Add PoE usage columns to device_metrics time series
ALTER TABLE device_metrics ADD COLUMN IF NOT EXISTS poe_watts_used     NUMERIC;
ALTER TABLE device_metrics ADD COLUMN IF NOT EXISTS poe_watts_capacity NUMERIC;
