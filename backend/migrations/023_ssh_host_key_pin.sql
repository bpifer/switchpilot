-- Pin each device's SSH host key (trust-on-first-use). On the first successful
-- SSH connection the presented key's fingerprint is recorded here; subsequent
-- connections must present the same key or are refused before authentication
-- (guards against MITM on the management network and silent device swaps).
-- An empty string means "not yet pinned" — the next connection will pin it.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ssh_host_key_fp TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ssh_host_key_pinned_at TIMESTAMPTZ;
