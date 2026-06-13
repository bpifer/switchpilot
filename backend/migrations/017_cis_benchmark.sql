-- CIS-aligned compliance pack for Cisco IOS/IOS-XE, plus vendor tagging of the
-- rule set (foundation for per-vendor rules - see docs/PLAN-multi-vendor.md).
-- Rules are conservative, checkable against running-config, with safe
-- remediations. They run through the normal preview/guardrails before apply.

ALTER TABLE compliance_rules ADD COLUMN IF NOT EXISTS vendor    TEXT NOT NULL DEFAULT 'cisco';
ALTER TABLE compliance_rules ADD COLUMN IF NOT EXISTS benchmark TEXT NOT NULL DEFAULT '';

-- Tag existing seeded rules that map to CIS sections.
UPDATE compliance_rules SET benchmark = 'CIS'
 WHERE name IN ('No telnet VTY', 'Enable secret', 'Service password-enc',
                'Syslog host', 'NTP configured', 'AAA new-model');

-- New CIS-aligned rules (skip if a same-named rule already exists).
INSERT INTO compliance_rules (name, description, severity, match_type, pattern, remediation, benchmark, vendor)
SELECT * FROM (VALUES
  ('SSH version 2',
   'Device is set to SSH protocol version 2 only (CIS 1.5.x).',
   'critical', 'regex_present', '^ip ssh version 2', 'ip ssh version 2', 'CIS', 'cisco'),
  ('HTTP server disabled',
   'The cleartext HTTP management server is disabled (CIS 1.x).',
   'warning', 'regex_absent', '^ip http server', 'no ip http server', 'CIS', 'cisco'),
  ('Login banner',
   'A login/MOTD banner is configured (CIS 1.7.x).',
   'info', 'regex_present', '^banner (motd|login|exec)',
   'banner motd ^Authorized access only. Disconnect if you are not authorized.^', 'CIS', 'cisco'),
  ('No IP source-route',
   'IP source routing is disabled (CIS 2.x).',
   'warning', 'line_present', 'no ip source-route', 'no ip source-route', 'CIS', 'cisco'),
  ('Logging timestamps',
   'Log messages are timestamped (CIS 2.2.x).',
   'info', 'regex_present', '^service timestamps log',
   'service timestamps log datetime msec', 'CIS', 'cisco'),
  ('Password min-length',
   'A minimum password length is enforced (CIS 1.2.x).',
   'warning', 'regex_present', '^security passwords min-length',
   'security passwords min-length 8', 'CIS', 'cisco'),
  ('PAD service disabled',
   'The legacy PAD service is disabled (CIS 2.1.x).',
   'info', 'line_present', 'no service pad', 'no service pad', 'CIS', 'cisco')
) AS v(name, description, severity, match_type, pattern, remediation, benchmark, vendor)
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules cr WHERE cr.name = v.name);
