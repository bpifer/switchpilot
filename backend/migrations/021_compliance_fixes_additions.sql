-- Compliance corrections + additions found by auditing real devices.
-- See docs/PLAN-multi-vendor.md.

-- FIX: 'Service password-enc' used line_present "service password-encryption",
-- which substring-matches a "no service password-encryption" line and reports
-- compliant when the feature is actually OFF. Anchor it so only the positive
-- form passes. (Confirmed against a 2960X carrying `no service password-encryption`.)
UPDATE compliance_rules
   SET match_type = 'regex_present', pattern = '^service password-encryption'
 WHERE name = 'Service password-enc';

-- New Cisco hardening rules (CIS-aligned), checkable against running-config.
INSERT INTO compliance_rules (name, description, severity, match_type, pattern, remediation, benchmark, vendor)
SELECT * FROM (VALUES
  ('SSH idle timeout',
   'An SSH session idle timeout is configured (CIS 1.5.x).',
   'info', 'regex_present', '^ip ssh time-out', 'ip ssh time-out 60', 'CIS', 'cisco'),
  ('SSH auth retries limited',
   'SSH authentication retries are limited (CIS 1.5.x).',
   'info', 'regex_present', '^ip ssh authentication-retries', 'ip ssh authentication-retries 3', 'CIS', 'cisco'),
  ('Login brute-force protection',
   'Repeated failed logins are throttled (login block-for) (CIS 1.x).',
   'warning', 'regex_present', '^login block-for', 'login block-for 120 attempts 3 within 60', 'CIS', 'cisco'),
  ('VTY idle timeout not disabled',
   'No line disables its idle timeout with "exec-timeout 0 0" (CIS 1.1.x).',
   'warning', 'regex_absent', 'exec-timeout 0 0', E'line vty 0 15\nexec-timeout 10 0', 'CIS', 'cisco'),
  -- New RouterOS rule
  ('DNS not an open resolver',
   'The device is not acting as an open DNS resolver (allow-remote-requests off). RouterOS only exports this when enabled.',
   'warning', 'regex_absent', 'allow-remote-requests=yes', '/ip dns set allow-remote-requests=no', 'RouterOS', 'mikrotik')
) AS v(name, description, severity, match_type, pattern, remediation, benchmark, vendor)
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules cr WHERE cr.name = v.name);
