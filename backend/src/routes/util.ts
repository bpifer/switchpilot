// Shared helpers for route handlers.

/**
 * Build a WHERE condition for the optional siteId query param.
 *  - undefined/'' -> no condition (all sites)
 *  - 'unassigned' -> devices with no site
 *  - anything else -> match the site UUID
 * `startIdx` is the 1-based index the parameter should occupy in the query.
 */
export function siteFilter(siteId: string | undefined, alias = 'd', startIdx = 1):
  { cond: string; params: unknown[] } {
  if (!siteId) return { cond: '', params: [] };
  if (siteId === 'unassigned') return { cond: `${alias}.site_id IS NULL`, params: [] };
  return { cond: `${alias}.site_id = $${startIdx}`, params: [siteId] };
}
