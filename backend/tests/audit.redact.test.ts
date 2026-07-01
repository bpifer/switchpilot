import { describe, it, expect } from 'vitest';
import { redactForAudit } from '../src/audit.js';

describe('redactForAudit', () => {
  it('masks the value after common secret keywords', () => {
    expect(redactForAudit('snmp-server community public RO')).toBe('snmp-server community [redacted] RO');
    expect(redactForAudit('username admin password 7 0123456789ABCDEF')).toContain('password 7 [redacted]');
    expect(redactForAudit('enable secret 5 $1$abc$xyz')).toContain('secret 5 [redacted]');
  });

  it('masks =/: separated secrets (RouterOS syntax)', () => {
    expect(redactForAudit('/user add name=admin password=hunter2')).toContain('password=[redacted]');
    expect(redactForAudit('add name=wg key=0x1234abcd')).toContain('key=[redacted]');
    expect(redactForAudit('community: public')).toContain('community: [redacted]');
  });

  it('leaves non-secret device output intact', () => {
    const out = 'interface Gi1/0/1\n switchport access vlan 20';
    expect(redactForAudit(out)).toBe(out);
  });

  it('caps oversized output with a truncation note', () => {
    const big = 'x'.repeat(5000);
    const out = redactForAudit(big, 4000);
    expect(out.length).toBeLessThan(4200);
    expect(out).toContain('truncated');
  });

  it('handles empty input', () => {
    expect(redactForAudit('')).toBe('');
  });
});
