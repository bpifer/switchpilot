# Contributing to SwitchPilot

Thanks for looking at this. The most valuable contributions right now are
**hardware reports** (diagnostics bundles from device models that parse wrong
or not at all) and **vendor drivers** — you don't have to write code to help.

## Reporting a device that doesn't work

Open the device in SwitchPilot → **Tools** tab → **Download diagnostics**.
Attach the bundle to a bug report. It contains the raw CLI/SNMP output your
device produced (passwords and communities redacted), which is usually enough
to write a parser fix and a regression test without owning your hardware.

## Development setup

```bash
docker compose up -d db redis            # dependencies only
cd backend  && npm install && npm run dev
cd frontend && npm install && npm run dev
cd backend  && npm test                  # Vitest; no hardware or DB needed
cd frontend && npm test
```

The backend test suite runs entirely against canned fixtures and a mock SSH
device (`backend/tests/helpers/mockCiscoDevice.ts`) — you never need a real
switch to develop or test.

## How the code is organized

- `backend/src/cisco/`, `backend/src/routeros/`, `backend/src/aruba/` —
  per-vendor parsers and session/SNMP clients. Parsers are pure functions over
  raw text/walks, tested in `backend/tests/` against fixtures captured from
  real hardware.
- `backend/src/drivers/` — the vendor driver seam: command strings and
  line-builders (config view, bounce, PoE cycle, baseline, tools) keyed by OS.
  Route handlers call `driverFor(device)` instead of hardcoding CLI.
- `backend/src/services/` — vendor-neutral logic. `monitorService` dispatches
  a refresh to `ciscoMonitor` / `routerosMonitor` / `arubaMonitor`, which all
  write the same shared tables so the UI stays vendor-agnostic.
- `backend/migrations/` — plain SQL, applied in filename order at API boot,
  tracked in `schema_migrations`. Never edit an existing migration; add a new
  one.
- `frontend/src/` — React + Tailwind. Shared UI in `components/ui.tsx`,
  mutations through `hooks/useAction.ts`.

## Adding a vendor

1. Start from `docs/PLAN-multi-vendor.md`.
2. Pure parsers first, with fixtures from real output (`backend/tests/`).
3. A monitor module writing the shared tables (`ports`, `device_metrics`,
   `topology_links`, ...), mirroring `routerosMonitor.ts`.
4. A driver entry for whatever CLI operations the vendor supports; anything
   unsupported should fail with a clear error, not silently no-op.
5. Detection at onboarding (see `routes/onboarding.ts`).

Aruba Instant On is the reference for an SNMP-only vendor (no CLI at all);
RouterOS is the reference for a full SSH vendor.

## Pull requests

- `npx tsc --noEmit` clean in whichever half you touched, tests green.
- New parser behavior needs a fixture-based test — ideally verbatim output
  from a real device (redact anything sensitive).
- Anything that pushes config to a device must respect the existing
  guardrails: preview/diff first, self-lockout detection, uplink guard, and
  an audit entry.
- Keep commits focused; explain *why* in the message body.

## License

Contributions are accepted under the project license, AGPL-3.0-or-later.
