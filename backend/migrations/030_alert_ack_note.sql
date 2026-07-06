-- Optional free-form note captured when an operator acknowledges an alert
-- ("known issue, RMA pending", "expected during migration", etc.).
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ack_note TEXT NOT NULL DEFAULT '';
