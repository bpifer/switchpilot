# Implementation Plan: Site-Scoped Navigation (Meraki-style)

Status: IMPLEMENTED as designed (see commit history). Kept as the reference
for the decisions below - particularly what is deliberately NOT scoped.

## Goal

A site selector in the sidebar (under the logo block). Choosing a site scopes
what every relevant page shows - devices, topology, alerts, logs, clients,
dashboard, PoE, lifecycle, compliance - to that site. "All sites" is the
default and behaves exactly like today.

## Decisions (locked)

1. **Server-side filtering** via a `siteId` query parameter on list endpoints,
   not client-side row filtering. Rationale: pagination on /api/devices already
   exists, logs/alerts can be large, and client-side filtering would lie in
   summary counts.
2. **Sentinel values**: `siteId` absent = all sites. `siteId=unassigned` =
   `devices.site_id IS NULL`. Otherwise a site UUID.
3. **The alerts bell stays GLOBAL.** A critical alert on an out-of-scope site
   must still light the bell. The Alerts page list is scoped; the bell count is
   not. (Add a tooltip line "all sites" to the bell so this is not confusing.)
4. **Jobs, Users, Templates, Firmware images, Discovery, Locate are NOT scoped**
   in v1. Jobs/templates/images are fleet-level objects; Locate and Discovery
   are search tools. Campaigns stay fleet-level (rings already segment them).
5. Selected site persists in `localStorage` key `sp_site`. If the persisted id
   no longer exists (site deleted), silently fall back to all sites.

## Backend changes

Add an optional `siteId` querystring param (schema:
`{ siteId: { type: 'string' } }`) and a WHERE clause to each route below.
Shared helper in `backend/src/routes/util.ts` (new file):

```ts
/** Returns [sqlCondition, params] for a siteId query param against alias d. */
export function siteFilter(siteId: string | undefined, alias = 'd', startIdx = 1):
  { cond: string; params: unknown[] } {
  if (!siteId) return { cond: '', params: [] };
  if (siteId === 'unassigned') return { cond: `${alias}.site_id IS NULL`, params: [] };
  return { cond: `${alias}.site_id = $${startIdx}`, params: [siteId] };
}
```

Routes to touch (verified against current code):

| Route | File | How to filter |
|---|---|---|
| `GET /api/devices` | routes/devices.ts | add `d.site_id` condition to the existing keyset-paginated query (it already joins sites for site_name) |
| `GET /api/alerts` | routes/alerts.ts | alerts has `device_id`; `JOIN devices d ON d.id = a.device_id` (LEFT JOIN - keep device-less alerts visible only in all-sites view) |
| `GET /api/logs` | routes/logs.ts | already LEFT JOINs devices; add condition |
| `GET /api/topology` | routes/topology.ts | filter the managed-device node query by site; keep unmanaged neighbor nodes only if linked to an in-scope device |
| `GET /api/summary` | app.ts | device counts + open alerts + recent jobs: scope devices and alerts; leave jobs global (per decision 4) but omit is acceptable v1 - simplest: scope devices/alerts only |
| `GET /api/poe/summary` | routes/poe.ts | both device and per-site rollup queries |
| `GET /api/devices/lifecycle` | routes/campaigns.ts | add condition to existing query (already selects site_name) |
| `GET /api/compliance/summary` | routes/compliance.ts | scope the per-device rollup and overall score via JOIN devices |
| `GET /api/clients` | routes/clients.ts | client_tracking JOINs devices already for hostname; add condition |

Note `/api/summary` currently verifies JWT manually inside the handler - keep
that pattern, just read `req.query.siteId`.

## Frontend changes

### New: `frontend/src/context/SiteContext.tsx`

```tsx
interface SiteScope { siteId: string; setSiteId: (id: string) => void; }
// '' = all sites; 'unassigned' = pseudo-site; else UUID
```
- Provider holds state initialized from `localStorage.getItem('sp_site') ?? ''`,
  writes back on change.
- Export `useSiteScope()` hook and a path helper:
  `scoped(path: string, siteId: string)` - appends `siteId=` handling both `?`
  and `&` (paths like `/api/alerts?open=true` already carry params).
- Wrap the authed app shell in App.tsx with the provider (inside
  QueryClientProvider - it's in main.tsx, so just inside App's authed return).

### New: `SiteSelector` component (in App.tsx or components/)

- Renders under the logo block in the sidebar: a dark-styled `<select>` with
  options: "All sites", each site from `useApiQuery('/api/sites')`, and
  "Unassigned" at the bottom.
- On site deletion mid-session: if `siteId` not in the fetched list and not
  ''/'unassigned', call `setSiteId('')`.

### Page wiring (mechanical)

Each scoped page changes its query path:

```tsx
const { siteId } = useSiteScope();
useApiQuery(scoped('/api/devices', siteId), ...)
```

React Query keys by path, so per-site caching falls out automatically - no
invalidation work needed when switching sites.

Pages to touch: Dashboard (`/api/summary`, `/api/alerts?limit=10`), Devices,
Topology, Alerts, Logs, Clients (its imperative search fetch appends the param
manually), PoE, Lifecycle, Compliance (summary only).

NOT touched: Jobs, Templates, Campaigns, Firmware, Discovery, Locate, Users,
Maintenance, Analytics (device dropdown already picks a specific device).

Bonus (small): OnboardWizard defaults its Site dropdown to the current scope.

## Edge cases

- WS alert events: bell stays global (decision 3) - no change to useWebSocket.
- DeviceDetail of an out-of-scope device (deep link): renders normally; scope
  only affects list pages. No guard needed.
- `x-next-cursor` pagination on /api/devices: the site condition must be inside
  the same WHERE as the cursor comparison so pages stay consistent.
- Empty states: scoped pages show their normal empty state; consider appending
  "in this site" to the message where cheap.

## Tests

- Backend (DB-gated, api.test.ts): create 2 sites + 1 device in each + 1
  unassigned via SQL; assert `GET /api/devices?siteId=<a>` returns only site A,
  `siteId=unassigned` returns the unassigned one, no param returns all 3.
- Unit: `siteFilter()` - all three branches.
- Frontend: SiteSelector test - renders options from mocked useApiQuery,
  persists selection to localStorage, falls back to '' when stored id vanishes.

## Implementation order

1. `siteFilter` helper + unit test
2. Backend params on the 9 routes (one commit; cheap to review together)
3. SiteContext + SiteSelector + App wiring
4. Page-by-page query path changes
5. Backend DB-gated test + frontend selector test
6. README one-liner ("scoping" paragraph under Features)

Estimated footprint: ~10 backend files, ~12 frontend files, 2 test files.
No migrations, no new dependencies.
