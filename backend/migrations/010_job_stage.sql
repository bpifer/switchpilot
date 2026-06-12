-- Human-readable current stage for long-running jobs (firmware copy/verify/reload).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT '';
