// Syncs the IEEE OUI registry (MAC prefix → vendor) into Postgres and keeps an
// in-memory cache for synchronous lookups during device refresh sweeps.
import { query } from '../db.js';
import { setOuiCache } from '../cisco/oui.js';

const IEEE_OUI_CSV = 'https://standards-oui.ieee.org/oui/oui.csv';
const RESYNC_AFTER_DAYS = 30;

/** Parse the IEEE oui.csv format: MA-L,28FF3E,"zte corporation","address…" */
export function parseOuiCsv(csv: string): { oui: string; vendor: string }[] {
  const entries: { oui: string; vendor: string }[] = [];
  for (const line of csv.split('\n')) {
    const m = line.match(/^MA-L,([0-9A-Fa-f]{6}),(?:"([^"]*)"|([^,]*))/);
    if (!m) continue;
    const vendor = (m[2] ?? m[3] ?? '').trim();
    if (vendor) entries.push({ oui: m[1].toUpperCase(), vendor });
  }
  return entries;
}

/** Load the DB table into the in-process cache used by lookupVendor(). */
export async function loadOuiCache(): Promise<number> {
  const { rows } = await query<{ oui: string; vendor: string }>('SELECT oui, vendor FROM oui_vendors');
  setOuiCache(new Map(rows.map(r => [r.oui, r.vendor])));
  return rows.length;
}

/**
 * Download and store the IEEE registry if the local copy is missing or stale.
 * Non-fatal on failure (air-gapped installs keep the builtin fallback table).
 */
export async function syncOuiDatabase(log: (msg: string) => void = console.log): Promise<void> {
  const { rows } = await query<{ n: string; newest: string | null }>(
    `SELECT count(*)::text AS n, max(updated_at)::text AS newest FROM oui_vendors`);
  const count = parseInt(rows[0].n, 10);
  const ageDays = rows[0].newest
    ? (Date.now() - new Date(rows[0].newest).getTime()) / 86_400_000
    : Infinity;
  if (count > 0 && ageDays < RESYNC_AFTER_DAYS) {
    log(`OUI registry: ${count} entries, ${Math.round(ageDays)}d old - no sync needed`);
    return;
  }

  log('OUI registry: downloading IEEE database…');
  const res = await fetch(IEEE_OUI_CSV, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`IEEE OUI download failed: HTTP ${res.status}`);
  const entries = parseOuiCsv(await res.text());
  if (entries.length < 10_000) throw new Error(`IEEE OUI parse produced only ${entries.length} entries; format change?`);

  // Upsert in chunks; yield between them so a busy pool isn't monopolized
  for (let i = 0; i < entries.length; i += 5000) {
    const chunk = entries.slice(i, i + 5000);
    await query(
      `INSERT INTO oui_vendors (oui, vendor, updated_at)
       SELECT t.oui, t.vendor, now()
       FROM jsonb_to_recordset($1::jsonb) AS t(oui char(6), vendor text)
       ON CONFLICT (oui) DO UPDATE SET vendor=EXCLUDED.vendor, updated_at=now()`,
      [JSON.stringify(chunk)]);
    await new Promise(r => setTimeout(r, 50));
  }
  log(`OUI registry: synced ${entries.length} entries`);

  // Backfill clients recorded before the registry existed
  const { rowCount } = await query(
    `UPDATE client_tracking ct SET vendor = v.vendor
     FROM oui_vendors v
     WHERE ct.vendor IS NULL
       AND v.oui = upper(substr(replace(ct.mac, '.', ''), 1, 6))`);
  if (rowCount) log(`OUI registry: backfilled vendor on ${rowCount} known clients`);
}
