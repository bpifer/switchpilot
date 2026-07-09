-- Aruba Instant On compliance pack. Evaluated against the SYNTHETIC config
-- snapshot rendered from SNMP state (backend/src/aruba/syntheticConfig.ts),
-- not a native CLI export - Instant On has no CLI. Patterns here and that
-- renderer's line format must change together.
--
-- No remediation lines: the SSH remediation pusher can't reach these devices,
-- and the fixes (move a port off VLAN 1, set a description) are one click away
-- in the ports UI anyway. vendor: aruba.

INSERT INTO compliance_rules (name, description, severity, match_type, pattern, remediation, benchmark, vendor)
SELECT * FROM (VALUES
  ('No connected ports on default VLAN 1',
   'Connected ports should carry a purpose-assigned VLAN, not the factory default VLAN 1. Untagged default-VLAN access is the most common Instant On misconfiguration.',
   'critical', 'regex_absent', '^interface \S+ name "[^"]*" vlan 1 enabled connected$', '', 'Aruba Instant On', 'aruba'),
  ('Connected ports have descriptions',
   'Every port with an active link has a description (ifAlias), so an unlabeled cable can be traced from the dashboard.',
   'warning', 'regex_absent', '^interface \S+ name "" .*connected$', '', 'Aruba Instant On', 'aruba'),
  ('Hostname changed from factory default',
   'The system name has been set to something meaningful instead of the factory default.',
   'warning', 'regex_absent', '^hostname\s*($|Aruba|[Ss]witch)', '', 'Aruba Instant On', 'aruba'),
  ('LLDP neighbors visible',
   'At least one LLDP neighbor is seen. No neighbors usually means LLDP is disabled on the switch or its uplink peer, which blinds topology mapping.',
   'info', 'regex_present', '^lldp neighbor ', '', 'Aruba Instant On', 'aruba'),
  ('Firmware version identified',
   'The firmware version could be parsed from SNMP sysDescr. An empty version usually means a very old or unusual firmware image.',
   'info', 'regex_present', '^version \S', '', 'Aruba Instant On', 'aruba')
) AS v(name, description, severity, match_type, pattern, remediation, benchmark, vendor)
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules cr WHERE cr.name = v.name);
