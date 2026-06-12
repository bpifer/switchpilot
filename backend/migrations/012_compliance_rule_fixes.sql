-- Fix placeholder remediation values in the seeded compliance rules and the
-- SNMPv3 rule that contradicts the platform's own v2c provisioning.
-- Only rows still carrying the original seeded values are touched, so operator
-- edits are preserved.

-- Real public NTP servers (NIST) instead of the 10.0.0.1 placeholder.
UPDATE compliance_rules
   SET remediation = E'ntp server 129.6.15.28\nntp server 132.163.96.1'
 WHERE name = 'NTP configured' AND remediation = 'ntp server 10.0.0.1';

-- Syslog remediation points at the platform itself; {platform_host} is
-- substituted from PLATFORM_URL at remediation time.
UPDATE compliance_rules
   SET remediation = E'logging host {platform_host}\nlogging trap informational'
 WHERE name = 'Syslog host' AND remediation = 'logging host 10.0.0.5';

-- SwitchPilot's own baseline provisioning configures an SNMPv2c read-only
-- community for fast polling, so "SNMPv3 only" fails on every provisioned
-- device. Disable it by default; sites that mandate v3 can re-enable it and
-- use SNMPv3 credential profiles instead.
UPDATE compliance_rules
   SET enabled = false,
       description = 'No SNMPv1/v2c community strings present. NOTE: SwitchPilot''s baseline provisioning adds a v2c read-only community for fast status polling - enable this rule only if your site mandates SNMPv3 (and use SNMPv3 credential profiles).'
 WHERE name = 'SNMPv3 only' AND remediation = '';
