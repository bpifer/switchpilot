-- First-class device vendor, ahead of MikroTik/RouterOS support. Existing rows
-- and Cisco onboarding default to 'cisco'; future drivers set their own value.
-- Vendor-specific behavior should branch on this (and capabilities.os) rather
-- than assuming Cisco. See docs/PLAN-multi-vendor.md.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vendor TEXT NOT NULL DEFAULT 'cisco';
