-- ============================================================================
-- 006: Configuration compliance engine
-- Rules evaluated against each device's latest backup; pass/fail tracked per
-- device + rule, rolled up into a fleet compliance score.
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  severity     TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  -- how `pattern` is tested against the running-config:
  --   line_present  : PASS if any config line contains `pattern`
  --   line_absent   : PASS if no config line contains `pattern`
  --   regex_present : PASS if `pattern` (regex) matches anywhere
  --   regex_absent  : PASS if `pattern` (regex) does NOT match
  match_type   TEXT NOT NULL DEFAULT 'line_present'
    CHECK (match_type IN ('line_present','line_absent','regex_present','regex_absent')),
  pattern      TEXT NOT NULL,
  -- optional config lines pushed to remediate a failing device (newline-separated)
  remediation  TEXT NOT NULL DEFAULT '',
  -- scope: empty = all devices; otherwise restrict to a site
  site_id      UUID REFERENCES sites(id) ON DELETE CASCADE,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   TEXT NOT NULL DEFAULT 'seed',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_results (
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  rule_id     UUID NOT NULL REFERENCES compliance_rules(id) ON DELETE CASCADE,
  passed      BOOLEAN NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, rule_id)
);
CREATE INDEX IF NOT EXISTS compliance_results_rule_idx ON compliance_results(rule_id);

-- Seed a baseline best-practice ruleset (matches the example: NTP, TACACS, syslog, AAA, SNMPv3).
INSERT INTO compliance_rules (name, description, severity, match_type, pattern, remediation) VALUES
  ('NTP configured',        'At least one NTP server is defined',                'warning',  'regex_present', '^ntp server ',                  'ntp server 10.0.0.1'),
  ('AAA new-model',         'AAA is enabled (required for TACACS+/RADIUS)',      'critical', 'line_present',  'aaa new-model',                 'aaa new-model'),
  ('TACACS+ server',        'A TACACS+ server group is configured',             'warning',  'regex_present', '^tacacs server |^tacacs-server host ', ''),
  ('Syslog host',           'Logging is sent to a remote syslog collector',     'warning',  'regex_present', '^logging host |^logging \d+\.', 'logging host 10.0.0.5'),
  ('SNMPv3 only',           'No insecure SNMPv1/v2c community strings present',  'critical', 'regex_absent',  '^snmp-server community ',       ''),
  ('No telnet VTY',         'VTY lines do not permit telnet (transport ssh)',    'critical', 'regex_absent',  'transport input telnet',        ''),
  ('Service password-enc',  'service password-encryption is enabled',            'info',     'line_present',  'service password-encryption',   'service password-encryption'),
  ('Enable secret',         'A privileged enable secret is set (not enable password)', 'critical', 'regex_present', '^enable secret ',         '')
ON CONFLICT DO NOTHING;
