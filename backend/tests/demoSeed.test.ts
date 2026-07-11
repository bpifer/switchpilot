import { describe, it, beforeAll, expect } from 'vitest';

// DB-backed tests for the DEMO_MODE seed. Like api.test.ts they need Postgres,
// so they only run when RUN_DB_TESTS=1 (CI sets it alongside the pg service).
const RUN = !!process.env.RUN_DB_TESTS;
const itDb = RUN ? it : it.skip;

beforeAll(async () => {
  if (!RUN) return;
  const { migrate } = await import('../src/db.js');
  await migrate();
}, 40000);

describe('demo fleet seed', () => {
  itDb('seeds the fleet and is idempotent across boots', async () => {
    const { seedDemoFleet, DEMO_DEVICES } = await import('../src/services/demoSeed.js');
    const { query } = await import('../src/db.js');

    await seedDemoFleet(() => {});
    await seedDemoFleet(() => {});   // second boot must not duplicate anything

    const { rows: devices } = await query(
      `SELECT * FROM devices WHERE capabilities->>'demo' = 'true' ORDER BY hostname`);
    expect(devices).toHaveLength(DEMO_DEVICES.length);

    // Every demo device is excluded from sweeps and reads as online.
    for (const d of devices) {
      expect(d.monitor_enabled).toBe(false);
      expect(d.status).toBe('online');
      expect(String(d.mgmt_ip)).toMatch(/^192\.0\.2\./);  // TEST-NET-1, never routable
    }

    // One vendor each of the big three, so every vendor UI path has a device.
    expect(new Set(devices.map((d: any) => d.vendor))).toEqual(new Set(['cisco', 'mikrotik', 'aruba']));

    // Aruba mirrors real hardware: no CPU/mem/temp (the 1930 exposes no health OIDs).
    const aruba = devices.find((d: any) => d.vendor === 'aruba') as any;
    expect(aruba.cpu_pct).toBeNull();
    expect(aruba.temperature_c).toBeNull();

    const ids = devices.map((d: any) => d.id);
    const one = async (sql: string) => Number((await query(sql, [ids])).rows[0].n);

    // Ports seeded once per (device, name) — compare against the definition.
    const wantPorts = DEMO_DEVICES.reduce((n, d) => n + d.ports.length, 0);
    expect(await one(`SELECT count(*) n FROM ports WHERE device_id = ANY($1)`)).toBe(wantPorts);

    // Topology is symmetric (each cable has a row on both ends).
    const links = await one(`SELECT count(*) n FROM topology_links WHERE device_id = ANY($1)`);
    expect(links).toBeGreaterThan(0);
    expect(links % 2).toBe(0);

    expect(await one(`SELECT count(*) n FROM client_tracking WHERE device_id = ANY($1)`)).toBeGreaterThan(0);
    expect(await one(`SELECT count(*) n FROM device_metrics WHERE device_id = ANY($1)`)).toBeGreaterThan(0);

    // One-time content must not multiply on the second boot.
    expect(await one(`SELECT count(*) n FROM alerts WHERE device_id = ANY($1)`)).toBe(2);
    expect(await one(`SELECT count(*) n FROM config_backups WHERE device_id = ANY($1)`)).toBe(2);
  }, 30000);

  itDb('demo devices refuse live actions instead of timing out', async () => {
    const { seedDemoFleet } = await import('../src/services/demoSeed.js');
    await seedDemoFleet(() => {});
    const { query } = await import('../src/db.js');
    const { sshTargetFor, snmpTargetFor } = await import('../src/services/deviceComms.js');

    const { rows } = await query(
      `SELECT * FROM devices WHERE capabilities->>'demo' = 'true' LIMIT 1`);
    await expect(sshTargetFor(rows[0] as any)).rejects.toThrow(/demo device/i);
    expect(await snmpTargetFor(rows[0] as any)).toBeNull();
  });
});
