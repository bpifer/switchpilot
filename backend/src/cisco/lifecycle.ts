// Cisco hardware lifecycle (EOS/EOL) lookup.
//
// Data lives in the `lifecycle_catalog` table (seeded by migration 005) so it
// can be corrected or extended by operators — and later fed from a Cisco EoX
// import — without a code release. The table is small and read on every device
// refresh, so it's cached in-process with a short TTL.
import { query } from '../db.js';

export interface LifecycleEntry {
  eos: string | null;            // End of Sale date (ISO)
  eol: string | null;            // End of Life / End of Support date (ISO)
  recommendedRelease?: string;
}

interface CatalogRow {
  model_prefix: string;
  eos_date: string | null;
  eol_date: string | null;
  recommended_release: string;
}

const CACHE_TTL_MS = 5 * 60_000;
let cache: CatalogRow[] | null = null;
let cacheAt = 0;

/** Load (and cache) the catalog, sorted longest-prefix-first for matching. */
async function loadCatalog(): Promise<CatalogRow[]> {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  const { rows } = await query<CatalogRow>(
    `SELECT model_prefix, eos_date, eol_date, recommended_release FROM lifecycle_catalog`);
  // longest prefix first so e.g. 'WS-C3560CX-' beats 'WS-C3560-'
  rows.sort((a, b) => b.model_prefix.length - a.model_prefix.length);
  cache = rows;
  cacheAt = Date.now();
  return rows;
}

/** Invalidate the in-process cache (call after a catalog edit). */
export function invalidateLifecycleCache(): void {
  cache = null;
}

function toEntry(row: CatalogRow): LifecycleEntry {
  return {
    // pg returns DATE as a JS Date or ISO string depending on driver settings; normalise to YYYY-MM-DD
    eos: row.eos_date ? String(row.eos_date).slice(0, 10) : null,
    eol: row.eol_date ? String(row.eol_date).slice(0, 10) : null,
    recommendedRelease: row.recommended_release || undefined
  };
}

/** Lookup lifecycle dates for a model string. Matches on longest prefix first. */
export async function lookupLifecycle(model: string): Promise<LifecycleEntry | null> {
  if (!model) return null;
  const upper = model.toUpperCase().trim();
  const catalog = await loadCatalog();
  for (const row of catalog) {
    if (upper.startsWith(row.model_prefix.toUpperCase())) return toEntry(row);
  }
  return null;
}

/** Returns days until EOL from today. Negative = already past EOL. */
export function daysUntilEol(eolDate: string | null): number | null {
  if (!eolDate) return null;
  return Math.round((new Date(eolDate).getTime() - Date.now()) / 86_400_000);
}
