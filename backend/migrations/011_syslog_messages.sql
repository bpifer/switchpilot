-- Raw syslog messages from managed switches (viewer in the UI).
-- Retention: rows older than 14 days are purged hourly by the syslog service.
CREATE TABLE IF NOT EXISTS syslog_messages (
  id          BIGSERIAL PRIMARY KEY,
  device_id   UUID REFERENCES devices(id) ON DELETE CASCADE,
  source_ip   TEXT NOT NULL,
  facility    INT,
  severity    INT,             -- RFC 5424: 0=emerg .. 7=debug
  message     TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_syslog_device_time ON syslog_messages(device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_syslog_time ON syslog_messages(received_at DESC);
