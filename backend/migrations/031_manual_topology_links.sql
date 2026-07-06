-- Operator-drawn topology links for connections CDP/LLDP can't discover
-- (unmanaged switches, firewalls, hypervisors, WAN handoffs). Kept separate
-- from topology_links because the monitor sweep rewrites that table on every
-- refresh; manual links must survive. Either endpoint device may be deleted -
-- the link goes with it. A link can point at a managed device (to_device_id)
-- or a free-text external label (to_label).
CREATE TABLE IF NOT EXISTS manual_topology_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  from_port TEXT NOT NULL DEFAULT '',
  to_device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  to_label TEXT NOT NULL DEFAULT '',
  to_port TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_device_id IS NOT NULL OR to_label <> '')
);
CREATE INDEX IF NOT EXISTS manual_topology_links_from_idx ON manual_topology_links (from_device_id);
