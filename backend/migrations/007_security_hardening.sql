-- ============================================================================
-- 007: Security hardening — password policy, account lockout, password expiry,
--      MFA enforcement, and tamper-evident (hash-chained) audit log.
-- ============================================================================

-- ----- Per-user security state -----
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count  INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until        TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ----- Audit log hash chain -----
-- Each row stores the hash of the previous row plus its own canonical content,
-- forming a chain: altering or deleting any entry breaks every hash after it.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash  TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash TEXT NOT NULL DEFAULT '';

-- ----- Org-wide security policy (single row) -----
CREATE TABLE IF NOT EXISTS security_settings (
  id                       INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_min_length      INT  NOT NULL DEFAULT 12,
  password_require_upper   BOOLEAN NOT NULL DEFAULT TRUE,
  password_require_lower   BOOLEAN NOT NULL DEFAULT TRUE,
  password_require_digit   BOOLEAN NOT NULL DEFAULT TRUE,
  password_require_symbol  BOOLEAN NOT NULL DEFAULT FALSE,
  password_max_age_days    INT  NOT NULL DEFAULT 0,    -- 0 = never expires
  mfa_required             BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_required_roles       TEXT[] NOT NULL DEFAULT '{}', -- empty + mfa_required = all roles
  lockout_threshold        INT  NOT NULL DEFAULT 5,     -- 0 = lockout disabled
  lockout_minutes          INT  NOT NULL DEFAULT 15,
  updated_by               TEXT NOT NULL DEFAULT 'seed',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO security_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
