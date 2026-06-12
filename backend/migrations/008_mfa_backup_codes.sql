-- Single-use MFA recovery codes. Generated (hashed) when a user confirms TOTP
-- enrollment; each can be redeemed once in place of a TOTP code at login.
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user ON mfa_backup_codes(user_id) WHERE used_at IS NULL;
