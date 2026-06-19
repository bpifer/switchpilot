-- NetFlow / IPFIX traffic accounting. The UDP collector aggregates flows into
-- one row per (minute bucket, exporter, src, dst, protocol, service-port) and
-- prunes by retention (NETFLOW_RETAIN_DAYS). device_id is the exporter resolved
-- to a managed device, or NULL when the exporter is not (yet) a known device.
CREATE TABLE IF NOT EXISTS flow_records (
  id          BIGSERIAL PRIMARY KEY,
  bucket      TIMESTAMPTZ NOT NULL,
  device_id   UUID REFERENCES devices(id) ON DELETE SET NULL,
  exporter_ip INET NOT NULL,
  src_ip      INET NOT NULL,
  dst_ip      INET NOT NULL,
  protocol    SMALLINT NOT NULL,
  dst_port    INTEGER NOT NULL,
  app         TEXT NOT NULL DEFAULT '',
  bytes       BIGINT NOT NULL,
  packets     BIGINT NOT NULL,
  flows       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS flow_records_bucket_idx ON flow_records (bucket);
CREATE INDEX IF NOT EXISTS flow_records_device_bucket_idx ON flow_records (device_id, bucket);
