-- Trigram indexes so the Cmd+K global search (ILIKE '%term%') uses an index
-- instead of a sequential scan. Critical once syslog_messages grows large.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_syslog_msg_trgm  ON syslog_messages USING gin (message gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ports_desc_trgm  ON ports           USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_alerts_msg_trgm  ON alerts          USING gin (message gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_devices_host_trgm ON devices        USING gin (hostname gin_trgm_ops);
