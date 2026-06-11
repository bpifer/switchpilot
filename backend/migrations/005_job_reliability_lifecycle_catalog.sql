-- ============================================================================
-- 005: Job-engine reliability, config-commit metadata, lifecycle catalog table
-- ============================================================================

-- ----- Job engine: attempts, retry policy, worker bookkeeping -----
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts      INT NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_attempts  INT NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_error    TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_by     TEXT;          -- worker/instance id that claimed the run
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS heartbeat_at  TIMESTAMPTZ;   -- updated by the running worker

-- A pending job becomes runnable when its scheduled time (if any) has passed.
-- run_after lets the reaper requeue a failed job with backoff.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS run_after     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS jobs_claimable_idx
  ON jobs (status, run_after)
  WHERE status = 'pending';

-- Track which attempt produced a given per-device result.
ALTER TABLE job_results ADD COLUMN IF NOT EXISTS attempt INT NOT NULL DEFAULT 1;

-- ----- Config commit metadata (operational context for each backup) -----
ALTER TABLE config_backups ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '';
ALTER TABLE config_backups ADD COLUMN IF NOT EXISTS ticket TEXT NOT NULL DEFAULT '';

-- ----- Lifecycle catalog (replaces the hardcoded TS array) -----
CREATE TABLE IF NOT EXISTS lifecycle_catalog (
  model_prefix        TEXT PRIMARY KEY,            -- e.g. 'WS-C2960X-', 'C9300-'
  eos_date            DATE,                        -- End of Sale
  eol_date            DATE,                        -- End of Life / End of Support
  recommended_release TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  updated_by          TEXT NOT NULL DEFAULT 'seed',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed from the prefixes previously hardcoded in cisco/lifecycle.ts.
-- ON CONFLICT DO NOTHING so operator edits are never overwritten on restart.
INSERT INTO lifecycle_catalog (model_prefix, eos_date, eol_date, recommended_release) VALUES
  ('WS-C2924',    '2004-08-26', '2009-08-26', ''),
  ('WS-C2948',    '2004-08-26', '2009-08-26', ''),
  ('WS-C2960-',   '2016-01-31', '2021-01-31', ''),
  ('WS-C2960S-',  '2016-01-31', '2021-01-31', ''),
  ('WS-C2960P-',  '2016-01-31', '2021-01-31', ''),
  ('WS-C2960C-',  '2016-01-31', '2021-01-31', ''),
  ('WS-C2960XR-', '2022-10-29', '2027-10-29', '15.2(7)E10'),
  ('WS-C2960X-',  '2022-01-31', '2027-01-31', '15.2(7)E10'),
  ('WS-C2960L-',  '2024-09-30', '2029-09-30', '15.2(7)E10'),
  ('WS-C2960CX-', '2024-09-30', '2029-09-30', '15.2(7)E10'),
  ('WS-C3560CX-', '2024-09-30', '2029-09-30', '15.2(7)E10'),
  ('WS-C3550-',   '2007-09-28', '2012-09-28', ''),
  ('WS-C3560E-',  '2013-08-10', '2018-08-10', ''),
  ('WS-C3560V2-', '2013-08-10', '2018-08-10', ''),
  ('WS-C3560X-',  '2017-07-28', '2022-07-28', ''),
  ('WS-C3560-',   '2013-08-10', '2018-08-10', ''),
  ('WS-C3750E-',  '2013-08-10', '2018-08-10', ''),
  ('WS-C3750V2-', '2013-08-10', '2018-08-10', ''),
  ('WS-C3750X-',  '2017-07-28', '2022-07-28', ''),
  ('WS-C3750G-',  '2013-08-10', '2018-08-10', ''),
  ('WS-C3750-',   '2013-08-10', '2018-08-10', ''),
  ('WS-C3650-',   '2020-10-31', '2025-10-31', '16.12.9'),
  ('WS-C3850-',   '2021-10-31', '2026-10-31', '16.12.9'),
  ('WS-C4500X-',  '2022-01-31', '2027-01-31', '03.11.07E'),
  ('WS-C4507R',   '2015-07-31', '2020-07-31', ''),
  ('WS-C4510R',   '2015-07-31', '2020-07-31', ''),
  ('WS-C4503',    '2008-06-10', '2013-06-10', ''),
  ('WS-C4506',    '2015-07-31', '2020-07-31', ''),
  ('WS-C6504',    '2014-08-01', '2019-08-01', ''),
  ('WS-C6506',    '2014-08-01', '2019-08-01', ''),
  ('WS-C6509',    '2014-08-01', '2019-08-01', ''),
  ('WS-C6513',    '2014-08-01', '2019-08-01', ''),
  ('WS-C6516',    '2014-08-01', '2019-08-01', ''),
  ('C9200L-',     NULL,         NULL,         '17.12.3'),
  ('C9200-',      NULL,         NULL,         '17.12.3'),
  ('C9200CX-',    NULL,         NULL,         '17.12.3'),
  ('C9300X-',     NULL,         NULL,         '17.12.3'),
  ('C9300L-',     NULL,         NULL,         '17.12.3'),
  ('C9300-',      NULL,         NULL,         '17.12.3'),
  ('C9404R',      NULL,         NULL,         '17.12.3'),
  ('C9407R',      NULL,         NULL,         '17.12.3'),
  ('C9410R',      NULL,         NULL,         '17.12.3'),
  ('C9500-',      NULL,         NULL,         '17.12.3'),
  ('C9500H-',     NULL,         NULL,         '17.12.3'),
  ('C9606R',      NULL,         NULL,         '17.12.3'),
  ('C9610R',      NULL,         NULL,         '17.12.3'),
  ('N3K-C3',      NULL,         NULL,         ''),
  ('N56-',        '2018-04-30', '2023-04-30', ''),
  ('N55-',        '2018-04-30', '2023-04-30', ''),
  ('N5K-C5',      '2018-04-30', '2023-04-30', ''),
  ('N7K-C7',      '2023-04-30', '2028-04-30', ''),
  ('N9K-C9',      NULL,         NULL,         '10.3(5)M')
ON CONFLICT (model_prefix) DO NOTHING;
