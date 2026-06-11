-- Firmware deployment ring per device (controls staged upgrade campaigns)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ring TEXT NOT NULL DEFAULT 'production'
  CHECK (ring IN ('pilot','production','critical'));

-- Cisco lifecycle data (EOS = End of Sale, EOL = End of Life/Support)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS eos_date DATE;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS eol_date DATE;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS recommended_release TEXT NOT NULL DEFAULT '';

-- Git commit SHA stored alongside each config backup
ALTER TABLE config_backups ADD COLUMN IF NOT EXISTS git_sha TEXT;

-- OUI vendor name + PTR (reverse-DNS) hostname for full endpoint inventory
ALTER TABLE client_tracking ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE client_tracking ADD COLUMN IF NOT EXISTS ptr_hostname TEXT;

-- Staged firmware upgrade campaigns
CREATE TABLE IF NOT EXISTS firmware_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  image_id        UUID REFERENCES firmware_images(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','running','paused','completed','aborted')),
  rings           TEXT[] NOT NULL DEFAULT ARRAY['pilot','production'],
  wait_days       INT NOT NULL DEFAULT 7,
  current_ring    TEXT NOT NULL DEFAULT 'pilot',
  ring_started_at TIMESTAMPTZ,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-device ring results for each campaign
CREATE TABLE IF NOT EXISTS firmware_campaign_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES firmware_campaigns(id) ON DELETE CASCADE,
  ring         TEXT NOT NULL,
  device_id    UUID REFERENCES devices(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed')),
  output       TEXT NOT NULL DEFAULT '',
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS fcr_campaign_idx ON firmware_campaign_results(campaign_id, ring);
CREATE INDEX IF NOT EXISTS fcr_device_idx   ON firmware_campaign_results(device_id);
