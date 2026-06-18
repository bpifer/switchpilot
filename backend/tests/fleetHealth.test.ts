import { describe, it, expect } from 'vitest';
import { computeFleetHealth } from '../src/services/fleetHealth.js';

describe('computeFleetHealth', () => {
  it('is 100/A when everything is online, compliant, and quiet', () => {
    const h = computeFleetHealth({ devicesOnline: 10, devicesTotal: 10, compliancePassed: 50, complianceTotal: 50, openCriticals: 0 });
    expect(h.score).toBe(100);
    expect(h.grade).toBe('A');
  });

  it('blends reachability and compliance 50/50', () => {
    // 80% online + 60% compliant -> 70
    const h = computeFleetHealth({ devicesOnline: 8, devicesTotal: 10, compliancePassed: 60, complianceTotal: 100, openCriticals: 0 });
    expect(h.score).toBe(70);
    expect(h.grade).toBe('C');
    expect(h.components).toMatchObject({ onlinePct: 80, compliancePct: 60, criticalPenalty: 0 });
  });

  it('penalizes open criticals 5 points each, capped at 30', () => {
    const base = { devicesOnline: 10, devicesTotal: 10, compliancePassed: 10, complianceTotal: 10 };
    expect(computeFleetHealth({ ...base, openCriticals: 2 }).score).toBe(90);   // 100 - 10
    expect(computeFleetHealth({ ...base, openCriticals: 4 }).score).toBe(80);   // 100 - 20
    expect(computeFleetHealth({ ...base, openCriticals: 99 }).score).toBe(70);  // capped at -30
    expect(computeFleetHealth({ ...base, openCriticals: 99 }).components.criticalPenalty).toBe(30);
  });

  it('treats an empty fleet / no rules as 100% for that component', () => {
    expect(computeFleetHealth({ devicesOnline: 0, devicesTotal: 0, compliancePassed: 0, complianceTotal: 0, openCriticals: 0 }).score).toBe(100);
    // online known-good but no compliance rules -> compliance counts as 100
    const h = computeFleetHealth({ devicesOnline: 5, devicesTotal: 5, compliancePassed: 0, complianceTotal: 0, openCriticals: 0 });
    expect(h.components.compliancePct).toBe(100);
  });

  it('clamps to [0,100] and never goes negative', () => {
    const h = computeFleetHealth({ devicesOnline: 0, devicesTotal: 10, compliancePassed: 0, complianceTotal: 10, openCriticals: 50 });
    expect(h.score).toBe(0);
    expect(h.grade).toBe('F');
  });
});
