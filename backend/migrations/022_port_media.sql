-- Store each port's media/transceiver type (from `show interfaces status` Type
-- column) so the UI can tell SFP/fiber ports from RJ45 copper ports even when
-- they share a name prefix (e.g. a 2960X-24TS where SFP uplinks are
-- GigabitEthernet1/0/25-28). Copper shows "10/100/1000BaseTX"; SFP slots show
-- "Not Present" or a fiber type like "1000BaseSX".
ALTER TABLE ports ADD COLUMN IF NOT EXISTS media TEXT NOT NULL DEFAULT '';
