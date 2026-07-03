import { describe, it, expect } from 'vitest';
import { evaluateHealth, decidePortFlap, shortName } from '../src/services/monitorService.js';

const ok = { temperatureC: 35, psu: [{ id: '1', status: 'OK' }], fans: [{ id: '1', status: 'normal' }] };
const find = (a: { kind: string }[], k: string) => a.find(x => x.kind === k)!;

describe('evaluateHealth', () => {
  it('raises nothing when everything is healthy', () => {
    expect(evaluateHealth('sw1', 10, 20, ok).every(x => x.raise === false)).toBe(true);
  });

  it('raises cpu + mem at >=90% (cpu warns and triggers automation, mem does not)', () => {
    const a = evaluateHealth('sw1', 95, 91, ok);
    expect(find(a, 'cpu_high')).toMatchObject({ raise: true, severity: 'warning', trigger: 'cpu_high' });
    expect(find(a, 'mem_high')).toMatchObject({ raise: true, severity: 'warning' });
    expect(find(a, 'mem_high').trigger).toBeUndefined();
  });

  it('raises temp_high (critical) at >=60C and ignores a null reading', () => {
    expect(find(evaluateHealth('sw1', 10, 10, { ...ok, temperatureC: 65 }), 'temp_high')).toMatchObject({ raise: true, severity: 'critical' });
    expect(find(evaluateHealth('sw1', 10, 10, { ...ok, temperatureC: null }), 'temp_high').raise).toBe(false);
  });

  it('flags a degraded PSU but treats "not present" as healthy', () => {
    expect(find(evaluateHealth('sw1', 10, 10, { ...ok, psu: [{ id: '1', status: 'faulty' }] }), 'psu_fail').raise).toBe(true);
    expect(find(evaluateHealth('sw1', 10, 10, { ...ok, psu: [{ id: '2', status: 'not present' }] }), 'psu_fail').raise).toBe(false);
  });

  it('flags a failed fan', () => {
    expect(find(evaluateHealth('sw1', 10, 10, { ...ok, fans: [{ id: '1', status: 'failed' }] }), 'fan_fail').raise).toBe(true);
  });

  it('does not flag an empty PSU slot fan reporting "Not Present" (real C9300, single PSU)', () => {
    const env = {
      temperatureC: 26,
      psu: [{ id: '1A', status: 'OK' }],
      fans: [
        { id: '1/1', status: 'OK' }, { id: '1/2', status: 'OK' }, { id: '1/3', status: 'OK' },
        { id: 'PS-1', status: 'OK' }, { id: 'PS-2', status: 'NOT PRESENT' },
      ],
    };
    expect(find(evaluateHealth('sw1', 10, 10, env), 'fan_fail').raise).toBe(false);
    expect(find(evaluateHealth('sw1', 10, 10, env), 'psu_fail').raise).toBe(false);
  });
});

describe('decidePortFlap', () => {
  const NOW = Date.parse('2026-07-01T12:00:00Z');
  const mins = (n: number) => new Date(NOW - n * 60_000).toISOString();

  it('a brand-new port (no previous state) never counts as flapped', () => {
    expect(decidePortFlap(undefined, 'connected', NOW))
      .toEqual({ flapped: false, flapCount: 0, lastFlapAt: null });
  });

  it('a status change from a known state is a flap and increments the counter', () => {
    const r = decidePortFlap(
      { oper_status: 'connected', flap_count_1h: 2, last_flap_at: mins(10) }, 'notconnect', NOW);
    expect(r.flapped).toBe(true);
    expect(r.flapCount).toBe(3);
    expect(r.lastFlapAt).toBe(new Date(NOW).toISOString());
  });

  it('a change from "unknown" is initial discovery, not a flap', () => {
    expect(decidePortFlap(
      { oper_status: 'unknown', flap_count_1h: 0, last_flap_at: null }, 'connected', NOW).flapped).toBe(false);
  });

  it('an unchanged status keeps the counter and timestamp as-is inside the window', () => {
    expect(decidePortFlap(
      { oper_status: 'connected', flap_count_1h: 4, last_flap_at: mins(30) }, 'connected', NOW))
      .toEqual({ flapped: false, flapCount: 4, lastFlapAt: mins(30) });
  });

  it('a flap after the 1-hour window restarts the counter at 1 (stale count cannot alert)', () => {
    const r = decidePortFlap(
      { oper_status: 'connected', flap_count_1h: 7, last_flap_at: mins(90) }, 'notconnect', NOW);
    expect(r).toMatchObject({ flapped: true, flapCount: 1 });
  });

  it('a quiet port with an expired window decays its counter to 0', () => {
    expect(decidePortFlap(
      { oper_status: 'connected', flap_count_1h: 7, last_flap_at: mins(90) }, 'connected', NOW).flapCount).toBe(0);
  });
});

describe('shortName (long → show-interfaces-status form)', () => {
  it.each([
    ['GigabitEthernet1/0/1', 'Gi1/0/1'],
    ['TenGigabitEthernet1/1/1', 'Te1/1/1'],
    ['TwoGigabitEthernet1/0/48', 'Tw1/0/48'],
    ['FortyGigabitEthernet1/1/1', 'Fo1/1/1'],
    ['HundredGigE1/0/1', 'Hu1/0/1'],
    ['FastEthernet0/1', 'Fa0/1'],
    ['Port-channel1', 'Po1'],
  ])('%s → %s', (long, short) => expect(shortName(long)).toBe(short));

  it('passes through names it does not recognize (already-short or vendor-new)', () => {
    expect(shortName('Gi1/0/1')).toBe('Gi1/0/1');
    expect(shortName('AppGigabitEthernet1/0/1')).toBe('AppGigabitEthernet1/0/1');
  });
});
