-- TACACS+ is enterprise AAA infrastructure not relevant to most homelab or
-- small deployments. Disable the seeded rule by default; operators who run a
-- TACACS+/RADIUS server can re-enable it on the Compliance page. Only touches
-- the rule if it's still in its seeded (no-remediation) state.
UPDATE compliance_rules
   SET enabled = false
 WHERE name = 'TACACS+ server' AND remediation = '';
