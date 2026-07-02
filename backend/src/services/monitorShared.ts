// Vendor-neutral monitoring decisions shared by the per-vendor refresh paths
// (ciscoMonitor, routerosMonitor) and the dispatcher (monitorService). Pure
// functions live here so they stay unit-testable without any device I/O.
import { raiseAlert, resolveAlert } from './alertService.js';
import { runAutomationTrigger } from './automationService.js';

export interface HealthAlert {
  kind: string;
  raise: boolean;                                 // true = raise, false = resolve
  severity?: 'info' | 'warning' | 'critical';
  message?: string;
  trigger?: string;                               // automation trigger to fire on raise
}

const envOk = (s: string) => /^(ok|good|normal)$/i.test(s);

/** Pure: decide which health alerts to raise or resolve from cpu/mem/env
 *  readings. Exported for tests; evaluateHealthAlerts() applies them and fires
 *  the matching automation triggers. */
export function evaluateHealth(
  hostname: string, cpu: number, mem: number,
  env: { temperatureC: number | null; psu: { id: string; status: string }[]; fans: { id: string; status: string }[] }
): HealthAlert[] {
  const badPsu = env.psu.filter(p => !envOk(p.status) && !/not present/i.test(p.status));
  const badFans = env.fans.filter(f => !envOk(f.status));
  const tempHigh = env.temperatureC !== null && env.temperatureC >= 60;
  return [
    cpu >= 90
      ? { kind: 'cpu_high', raise: true, severity: 'warning', message: `${hostname} CPU at ${cpu}% (5-minute average)`, trigger: 'cpu_high' }
      : { kind: 'cpu_high', raise: false },
    mem >= 90
      ? { kind: 'mem_high', raise: true, severity: 'warning', message: `${hostname} memory at ${mem}%` }
      : { kind: 'mem_high', raise: false },
    tempHigh
      ? { kind: 'temp_high', raise: true, severity: 'critical', message: `${hostname} temperature ${env.temperatureC}°C`, trigger: 'temp_high' }
      : { kind: 'temp_high', raise: false },
    badPsu.length
      ? { kind: 'psu_fail', raise: true, severity: 'critical', message: `${hostname} power supply problem: ${badPsu.map(p => `PSU ${p.id} ${p.status}`).join(', ')}`, trigger: 'psu_fail' }
      : { kind: 'psu_fail', raise: false },
    badFans.length
      ? { kind: 'fan_fail', raise: true, severity: 'critical', message: `${hostname} fan problem: ${badFans.map(f => `fan ${f.id} ${f.status}`).join(', ')}`, trigger: 'fan_fail' }
      : { kind: 'fan_fail', raise: false },
  ];
}

/** Apply evaluateHealth's decisions: raise/resolve the alerts and fire the
 *  matching automation triggers. */
export async function evaluateHealthAlerts(
  deviceId: string, hostname: string, cpu: number, mem: number,
  env: { temperatureC: number | null; psu: { id: string; status: string }[]; fans: { id: string; status: string }[] }
): Promise<void> {
  for (const a of evaluateHealth(hostname, cpu, mem, env)) {
    if (!a.raise) { await resolveAlert(deviceId, a.kind); continue; }
    await raiseAlert(deviceId, a.kind, a.severity!, a.message!);
    if (a.trigger) {
      const payload = a.kind === 'cpu_high' ? { deviceId, cpu }
        : a.kind === 'temp_high' ? { deviceId, temp: env.temperatureC ?? undefined }
        : { deviceId };
      await runAutomationTrigger(a.trigger, payload);
    }
  }
}

export interface PortFlapPrev {
  oper_status: string;
  flap_count_1h: number;
  last_flap_at: string | null;
}

/** Pure: decide whether a port flapped this sweep and what its rolling 1-hour
 *  flap counter becomes. A flap is any oper-status change from a known state;
 *  the counter restarts (not just resets to 0) when the last flap is over an
 *  hour old, so a stale count can't trip the flapping alert. Exported for tests. */
export function decidePortFlap(
  prev: PortFlapPrev | undefined, status: string, nowMs = Date.now()
): { flapped: boolean; flapCount: number; lastFlapAt: string | null } {
  const flapped = !!prev && prev.oper_status !== 'unknown' && prev.oper_status !== status;
  const windowExpired = !!prev?.last_flap_at &&
    nowMs - new Date(prev.last_flap_at).getTime() > 3600_000;
  const flapCount = flapped ? (windowExpired ? 1 : (prev?.flap_count_1h ?? 0) + 1) : (windowExpired ? 0 : prev?.flap_count_1h ?? 0);
  const lastFlapAt = flapped ? new Date(nowMs).toISOString() : prev?.last_flap_at ?? null;
  return { flapped, flapCount, lastFlapAt };
}

/** GigabitEthernet1/0/1 → Gi1/0/1 to match `show interfaces status` naming.
 *  Both the error-counter join and topology local_port keys depend on this
 *  mapping; a miss means silently dropped correlation. Exported for tests. */
export function shortName(long: string): string {
  return long
    .replace(/^GigabitEthernet/i, 'Gi').replace(/^FastEthernet/i, 'Fa')
    .replace(/^TenGigabitEthernet/i, 'Te').replace(/^TwoGigabitEthernet/i, 'Tw')
    .replace(/^FortyGigabitEthernet/i, 'Fo').replace(/^HundredGigE/i, 'Hu')
    .replace(/^Port-channel/i, 'Po');
}
