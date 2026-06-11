// Prometheus metrics. Exposes Node/process defaults plus SwitchPilot-specific
// gauges (fleet status, open alerts, job queue depth) and an HTTP latency
// histogram, served at GET /metrics.
import client from 'prom-client';
import { query } from './db.js';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpDuration = new client.Histogram({
  name: 'switchpilot_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry]
});

const devices = new client.Gauge({
  name: 'switchpilot_devices', help: 'Managed devices by status',
  labelNames: ['status'] as const, registers: [registry]
});
const openAlerts = new client.Gauge({
  name: 'switchpilot_open_alerts', help: 'Unresolved alerts by severity',
  labelNames: ['severity'] as const, registers: [registry]
});
const jobsPending = new client.Gauge({
  name: 'switchpilot_jobs_pending', help: 'Jobs waiting to run', registers: [registry]
});
const jobsRunning = new client.Gauge({
  name: 'switchpilot_jobs_running', help: 'Jobs currently executing', registers: [registry]
});

/** Refresh DB-derived gauges. Called on each scrape; best-effort. */
export async function refreshGauges(): Promise<void> {
  try {
    const [dev, al, jobs] = await Promise.all([
      query<{ status: string; n: number }>(`SELECT status, count(*)::int n FROM devices GROUP BY status`),
      query<{ severity: string; n: number }>(`SELECT severity, count(*)::int n FROM alerts WHERE resolved_at IS NULL GROUP BY severity`),
      query<{ status: string; n: number }>(`SELECT status, count(*)::int n FROM jobs WHERE status IN ('pending','running') GROUP BY status`)
    ]);
    devices.reset();
    for (const r of dev.rows) devices.set({ status: r.status }, r.n);
    openAlerts.reset();
    for (const r of al.rows) openAlerts.set({ severity: r.severity }, r.n);
    const byState = Object.fromEntries(jobs.rows.map(r => [r.status, r.n]));
    jobsPending.set(byState.pending ?? 0);
    jobsRunning.set(byState.running ?? 0);
  } catch { /* scrape best-effort — never fail /metrics on a transient DB hiccup */ }
}
