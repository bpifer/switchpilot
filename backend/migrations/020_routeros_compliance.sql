-- RouterOS (MikroTik) compliance pack. Checked against `/export hide-sensitive`,
-- which only emits NON-default config - so each rule looks for the explicit
-- hardening line and fails when the setting is still at its (insecure) default.
-- Remediations are RouterOS commands pushed through the normal preview/guardrails.
-- vendor: mikrotik. See docs/PLAN-multi-vendor.md #10.

INSERT INTO compliance_rules (name, description, severity, match_type, pattern, remediation, benchmark, vendor)
SELECT * FROM (VALUES
  ('Telnet service disabled',
   'The cleartext Telnet service is disabled (use SSH). RouterOS enables it by default.',
   'critical', 'regex_present', '^set telnet .*disabled=yes', '/ip service disable telnet', 'RouterOS', 'mikrotik'),
  ('FTP service disabled',
   'The cleartext FTP service is disabled. RouterOS enables it by default.',
   'warning', 'regex_present', '^set ftp .*disabled=yes', '/ip service disable ftp', 'RouterOS', 'mikrotik'),
  ('Plaintext API disabled',
   'The unencrypted API service (8728) is disabled; use api-ssl (8729) instead.',
   'warning', 'regex_present', '^set api .*disabled=yes', '/ip service disable api', 'RouterOS', 'mikrotik'),
  ('HTTP (www) disabled',
   'The cleartext HTTP service is disabled; prefer HTTPS (www-ssl) or WinBox.',
   'info', 'regex_present', '^set www .*disabled=yes', '/ip service disable www', 'RouterOS', 'mikrotik'),
  ('Login banner (system note)',
   'A login banner note is configured. (show-at-login defaults to yes and is not exported, so the rule checks the note text, which is.)',
   'info', 'regex_present', '^set note="',
   '/system note set show-at-login=yes note="Authorized access only. Disconnect if you are not authorized."',
   'RouterOS', 'mikrotik')
) AS v(name, description, severity, match_type, pattern, remediation, benchmark, vendor)
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules cr WHERE cr.name = v.name);
