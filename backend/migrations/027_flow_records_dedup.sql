-- The NetFlow collector flushes every 60s, but that cadence is not aligned to
-- the minute buckets it aggregates into, so a 5-tuple still receiving traffic
-- when a flush crosses a minute boundary produced two rows for the same
-- (bucket, exporter, src, dst, protocol, dst_port). Dashboards SUM/GROUP so the
-- numbers were correct, but the rows were redundant. Add a unique key and make
-- the collector upsert; first collapse any duplicates already stored so the
-- unique index can be created.

-- 1) Sum each duplicate group's metrics into its lowest-id survivor.
WITH agg AS (
  SELECT bucket, exporter_ip, src_ip, dst_ip, protocol, dst_port,
         min(id) AS keep_id,
         sum(bytes) AS b, sum(packets) AS p, sum(flows) AS f
  FROM flow_records
  GROUP BY bucket, exporter_ip, src_ip, dst_ip, protocol, dst_port
  HAVING count(*) > 1
)
UPDATE flow_records fr
SET bytes = agg.b, packets = agg.p, flows = agg.f
FROM agg
WHERE fr.id = agg.keep_id;

-- 2) Delete the now-redundant duplicate rows (keep the survivor per group).
DELETE FROM flow_records fr
USING (
  SELECT bucket, exporter_ip, src_ip, dst_ip, protocol, dst_port, min(id) AS keep_id
  FROM flow_records
  GROUP BY bucket, exporter_ip, src_ip, dst_ip, protocol, dst_port
) k
WHERE fr.bucket = k.bucket AND fr.exporter_ip = k.exporter_ip
  AND fr.src_ip = k.src_ip AND fr.dst_ip = k.dst_ip
  AND fr.protocol = k.protocol AND fr.dst_port = k.dst_port
  AND fr.id <> k.keep_id;

-- 3) Natural aggregation key for the collector's ON CONFLICT upsert. (Keeps the
--    BIGSERIAL id PK; a UNIQUE index is enough for the upsert and is non-
--    destructive.)
CREATE UNIQUE INDEX IF NOT EXISTS flow_records_dedup_idx
  ON flow_records (bucket, exporter_ip, src_ip, dst_ip, protocol, dst_port);
