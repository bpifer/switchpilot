import { describe, it, expect } from 'vitest';
import { evaluateHealth } from '../src/services/monitorService.js';

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
});
