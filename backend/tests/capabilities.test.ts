import { describe, it, expect } from 'vitest';
import { familyForModel, resolveCapabilities } from '../src/cisco/capabilities.js';

describe('familyForModel', () => {
  it('maps model strings to families', () => {
    expect(familyForModel('WS-C2960X-48FPD-L')).toBe('catalyst2960');
    expect(familyForModel('WS-C3560G-24PS-S')).toBe('catalyst3560');
    expect(familyForModel('WS-C3750X-48PF-S')).toBe('catalyst3750');
    expect(familyForModel('C9200L-48P-4G')).toBe('catalyst9200');
    expect(familyForModel('C9300-48UXM')).toBe('catalyst9300');
    expect(familyForModel('C9404R')).toBe('catalyst9400');
    // Nexus 9000 is a recognised NX-OS family (added with NX-OS support)
    expect(familyForModel('N9K-C9336C')).toBe('nexus9k');
  });
});

describe('resolveCapabilities', () => {
  it('resolves PoE and stacking from model suffix on 2960X', () => {
    const caps = resolveCapabilities('WS-C2960X-48FPD-L', '15.2(7)E3');
    expect(caps.poe).toBe(true);
    expect(caps.stacking).toBe(true);
    expect(caps.restconf).toBe(false);
    expect(caps.layer3).toBe(false);
    expect(caps.os).toBe('ios');
  });

  it('non-PoE 2960 plain model has no PoE and no stacking', () => {
    const caps = resolveCapabilities('WS-C2960-24TT-L', '12.2(55)SE');
    expect(caps.stacking).toBe(false);
  });

  it('9300 gets restconf/netconf on modern IOS-XE', () => {
    const caps = resolveCapabilities('C9300-48P', '17.9.4a');
    expect(caps.restconf).toBe(true);
    expect(caps.netconf).toBe(true);
    expect(caps.installMode).toBe(true);
    expect(caps.os).toBe('iosxe');
  });

  it('gates restconf below IOS-XE 16.6', () => {
    const caps = resolveCapabilities('C9300-48P', '16.3.1');
    expect(caps.restconf).toBe(false);
  });
});
