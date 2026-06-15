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

// ---- Per-device gauges (for Grafana dashboards) ----
const devLabels = ['device', 'vendor', 'site'] as const;
const g = (name: string, help: string, labelNames: readonly string[] = devLabels) =>
  new client.Gauge({ name, help, labelNames: labelNames as any, registers: [registry] });

const deviceUp        = g('switchpilot_device_up', '1 if the device is online, else 0');
const deviceCpu       = g('switchpilot_device_cpu_percent', 'Device CPU utilization percent');
const deviceMem       = g('switchpilot_device_mem_percent', 'Device memory utilization percent');
const deviceTemp      = g('switchpilot_device_temperature_celsius', 'Device temperature in Celsius');
const deviceUptime    = g('switchpilot_device_uptime_seconds', 'Device uptime in seconds');
const devicePoeUsed   = g('switchpilot_device_poe_watts_used', 'PoE watts drawn');
const devicePoeCap    = g('switchpilot_device_poe_watts_capacity', 'PoE budget in watts');

// ---- Per-port gauges ----
const portLabels = ['device', 'port'] as const;
const portUp       = g('switchpilot_port_up', '1 if the port is connected, else 0', portLabels);
const portAdminUp  = g('switchpilot_port_admin_up', '1 if the port is admin-enabled', portLabels);
const portInBps    = g('switchpilot_port_in_bps', 'Inbound bits/sec (last sample)', portLabels);
const portOutBps   = g('switchpilot_port_out_bps', 'Outbound bits/sec (last sample)', portLabels);
const portInErr    = g('switchpilot_port_input_errors', 'Cumulative input errors', portLabels);
const portOutErr   = g('switchpilot_port_output_errors', 'Cumulative output errors', portLabels);

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

    // Per-device metrics + latest PoE sample.
    const devRows = await query<any>(
      `SELECT d.hostname, COALESCE(d.vendor,'cisco') vendor, COALESCE(s.name,'-') site,
              d.status, d.cpu_pct, d.mem_pct, d.temperature_c, d.uptime_seconds,
              poe.poe_watts_used, poe.poe_watts_capacity
       FROM devices d
       LEFT JOIN sites s ON s.id=d.site_id
       LEFT JOIN LATERAL (
         SELECT poe_watts_used, poe_watts_capacity FROM device_metrics
         WHERE device_id=d.id AND poe_watts_capacity IS NOT NULL ORDER BY ts DESC LIMIT 1
       ) poe ON true`);
    for (const m of [deviceUp, deviceCpu, deviceMem, deviceTemp, deviceUptime, devicePoeUsed, devicePoeCap]) m.reset();
    for (const r of devRows.rows) {
      const l = { device: r.hostname, vendor: r.vendor, site: r.site };
      deviceUp.set(l, r.status === 'online' ? 1 : 0);
      if (r.cpu_pct != null) deviceCpu.set(l, Number(r.cpu_pct));
      if (r.mem_pct != null) deviceMem.set(l, Number(r.mem_pct));
      if (r.temperature_c != null) deviceTemp.set(l, Number(r.temperature_c));
      if (r.uptime_seconds != null) deviceUptime.set(l, Number(r.uptime_seconds));
      if (r.poe_watts_used != null) devicePoeUsed.set({ device: r.hostname, vendor: r.vendor, site: r.site }, Number(r.poe_watts_used));
      if (r.poe_watts_capacity != null) devicePoeCap.set({ device: r.hostname, vendor: r.vendor, site: r.site }, Number(r.poe_watts_capacity));
    }

    // Per-port state + latest bandwidth sample.
    const portRows = await query<any>(
      `SELECT d.hostname, p.name, p.oper_status, p.admin_up, p.input_errors, p.output_errors,
              bw.in_bps, bw.out_bps
       FROM ports p JOIN devices d ON d.id=p.device_id
       LEFT JOIN LATERAL (
         SELECT in_bps, out_bps FROM port_metrics
         WHERE device_id=p.device_id AND port_name=p.name ORDER BY recorded_at DESC LIMIT 1
       ) bw ON true`);
    for (const m of [portUp, portAdminUp, portInBps, portOutBps, portInErr, portOutErr]) m.reset();
    for (const r of portRows.rows) {
      const l = { device: r.hostname, port: r.name };
      portUp.set(l, r.oper_status === 'connected' ? 1 : 0);
      portAdminUp.set(l, r.admin_up ? 1 : 0);
      if (r.in_bps != null) portInBps.set(l, Number(r.in_bps));
      if (r.out_bps != null) portOutBps.set(l, Number(r.out_bps));
      portInErr.set(l, Number(r.input_errors ?? 0));
      portOutErr.set(l, Number(r.output_errors ?? 0));
    }
  } catch { /* scrape best-effort — never fail /metrics on a transient DB hiccup */ }
}
