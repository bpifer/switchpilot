-- Opt-in per-rule scheduled auto-remediation. When the master switch
-- COMPLIANCE_AUTO_REMEDIATE=true is set AND a rule is flagged here, the
-- compliance sweep pushes that rule's remediation to any device that fails it
-- (skipping devices in a maintenance window). Off by default and per-rule, so
-- nothing auto-pushes config unless two deliberate opt-ins line up.
ALTER TABLE compliance_rules
  ADD COLUMN IF NOT EXISTS auto_remediate BOOLEAN NOT NULL DEFAULT false;
