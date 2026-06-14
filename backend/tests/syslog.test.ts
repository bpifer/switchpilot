import { describe, it, expect } from 'vitest';
import { withinRate, PATTERNS } from '../src/services/syslogService.js';

const firstMatch = (text: string) => {
  for (const p of PATTERNS) { const m = text.match(p.re); if (m) return m; }
  return null;
};

describe('syslog pattern matching', () => {
  it('matches a RouterOS link-down message and extracts the interface', () => {
    const m = firstMatch('Jun 14 18:00:00 ether5 link down');
    expect(m?.[1]).toBe('ether5');
  });

  it('still matches the Cisco LINEPROTO down event', () => {
    expect(firstMatch('%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/1, changed state to down')?.[1])
      .toBe('GigabitEthernet1/0/1');
  });

  it('does not raise link-down on a link-up message', () => {
    // the RouterOS rule is "link down" only; an up message should not match it
    const m = firstMatch('ether5 link up');
    expect(m).toBeNull();
  });
});

describe('syslog per-source flood guard', () => {
  it('allows up to the cap per source per second, then drops', () => {
    const ip = '10.1.1.1';
    let allowed = 0, dropped = 0;
    for (let i = 0; i < 200; i++) {
      if (withinRate(ip, 1000)) allowed++; else dropped++;
    }
    expect(allowed).toBe(50);     // MAX_MSGS_PER_SOURCE_PER_SEC
    expect(dropped).toBe(150);
  });

  it('resets the budget when the second rolls over', () => {
    const ip = '10.2.2.2';
    for (let i = 0; i < 100; i++) withinRate(ip, 2000);  // exhaust this second
    expect(withinRate(ip, 2000)).toBe(false);
    expect(withinRate(ip, 2001)).toBe(true);             // new window
  });

  it('tracks sources independently', () => {
    for (let i = 0; i < 100; i++) withinRate('10.3.3.3', 3000);
    expect(withinRate('10.3.3.3', 3000)).toBe(false);
    expect(withinRate('10.4.4.4', 3000)).toBe(true);     // a different source is unaffected
  });
});
