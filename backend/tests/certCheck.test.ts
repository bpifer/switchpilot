import { describe, it, expect } from 'vitest';
import { certDecision } from '../src/services/certCheck.js';

const base = new Date('2026-06-19T00:00:00Z');
const inDays = (n: number) => new Date(base.getTime() + n * 86_400_000);

describe('certDecision', () => {
  it('resolves when the cert is comfortably valid', () => {
    expect(certDecision(inDays(90), 30, base)).toMatchObject({ action: 'resolve' });
  });

  it('warns inside the warn window', () => {
    expect(certDecision(inDays(20), 30, base)).toMatchObject({ action: 'raise', severity: 'warning' });
  });

  it('escalates to critical within a week', () => {
    expect(certDecision(inDays(5), 30, base)).toMatchObject({ action: 'raise', severity: 'critical' });
  });

  it('treats an expired cert as critical with negative days left', () => {
    const d = certDecision(inDays(-3), 30, base);
    expect(d).toMatchObject({ action: 'raise', severity: 'critical' });
    expect(d.daysLeft).toBeLessThan(0);
  });

  it('honors a custom warn window', () => {
    expect(certDecision(inDays(45), 60, base)).toMatchObject({ action: 'raise', severity: 'warning' });
    expect(certDecision(inDays(45), 30, base)).toMatchObject({ action: 'resolve' });
  });
});
