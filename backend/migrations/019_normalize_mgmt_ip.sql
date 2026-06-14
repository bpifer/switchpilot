-- Devices whose mgmt_ip was stored with a CIDR prefix (e.g. 192.168.10.100/24)
-- broke every exact-string match on mgmt_ip::text: syslog ingest couldn't
-- attribute messages to the device, the logs viewer couldn't filter by device,
-- and the onboarding duplicate check could miss re-onboards. Strip the prefix so
-- mgmt_ip is a plain host address everywhere. host() returns the address with no
-- netmask; for rows that were already plain this is a no-op.
UPDATE devices
   SET mgmt_ip = host(mgmt_ip)::inet
 WHERE masklen(mgmt_ip) <> 32;

-- Backfill device_id on syslog rows that arrived while the match was failing, so
-- per-device log filtering works on historical messages too (vendor-neutral:
-- matches on management IP regardless of platform).
UPDATE syslog_messages s
   SET device_id = d.id
  FROM devices d
 WHERE s.device_id IS NULL
   AND host(d.mgmt_ip) = s.source_ip;
