-- "security passwords min-length" is an IOS feature present on routers/ISR but
-- NOT on Catalyst 2960/2960-X (and many L2 access switches) - the switch
-- rejects it with "% Invalid input". Access switches are the common target, so
-- disable this CIS rule by default; sites with platforms that support it can
-- re-enable it on the Compliance page. Only touches the seeded rule.
UPDATE compliance_rules
   SET enabled = false,
       description = description || ' NOTE: not supported on Catalyst 2960/2960-X access switches; enable only on platforms that accept "security passwords min-length".'
 WHERE name = 'Password min-length' AND benchmark = 'CIS';
