-- Full IEEE OUI registry, synced from standards-oui.ieee.org at startup.
-- The builtin table in cisco/oui.ts remains as a fallback when this is empty
-- (e.g. air-gapped deployments).
CREATE TABLE IF NOT EXISTS oui_vendors (
  oui        CHAR(6) PRIMARY KEY,        -- first 6 hex chars, uppercase
  vendor     TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
