-- Free-form operator notes on a device (rack context, cabling quirks, "do not
-- reboot during business hours", etc.). Shown/edited from the device settings.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
