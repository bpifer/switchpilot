import { describe, it, expect } from 'vitest';
import { lookupVendor } from '../src/cisco/oui.js';
import { daysUntilEol } from '../src/cisco/lifecycle.js';

describe('lookupVendor (OUI)', () => {
  it('matches Cisco OUIs in dotted, colon, and dash formats', () => {
    expect(lookupVendor('0027.0baa.bbcc')).toBe('Cisco');
    expect(lookupVendor('00:27:0b:aa:bb:cc')).toBe('Cisco');
    expect(lookupVendor('00-27-0b-aa-bb-cc')).toBe('Cisco');
  });
  it('resolves non-Cisco vendors', () => {
    expect(lookupVendor('b827eb000000')).toBe('Raspberry Pi');
    expect(lookupVendor('000c29abcdef')).toBe('VMware');
  });
  it('returns null for unknown OUIs', () => {
    expect(lookupVendor('ffffff000000')).toBeNull();
  });
});

describe('daysUntilEol', () => {
  it('is null when no EOL date', () => expect(daysUntilEol(null)).toBeNull());
  it('is negative for past dates', () => {
    expect(daysUntilEol('2000-01-01')).toBeLessThan(0);
  });
  it('is positive for future dates', () => {
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    expect(daysUntilEol(future)).toBeGreaterThan(0);
  });
});
