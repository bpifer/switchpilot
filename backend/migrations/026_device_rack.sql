-- Rack placement for the visual rack view. rack_unit is the bottom-most U the
-- device occupies (NULL = not placed); rack_height is how many U tall it is.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_name TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_unit INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_height INTEGER NOT NULL DEFAULT 1;
