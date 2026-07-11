-- Session revocation cutoff: JWTs issued before this instant are rejected.
-- Set on password change/reset, role change, and account disable, so those
-- actions take effect immediately instead of when the 8h token expires.
-- NULL = no cutoff (nothing ever revoked for this user).
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_valid_after TIMESTAMPTZ;
