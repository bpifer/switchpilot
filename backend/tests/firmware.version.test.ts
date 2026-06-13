import { describe, it, expect } from 'vitest';
import { sameVersion } from '../src/services/firmwareService.js';

describe('sameVersion', () => {
  it('treats punctuation variants as equal', () => {
    expect(sameVersion('15.2(7)E14', '15.2.7E14')).toBe(true);
    expect(sameVersion('15.2(7)E14', '15.2(7)e14')).toBe(true);
    expect(sameVersion('16.12.04', '16.12.4')).toBe(false); // different digits stay different
  });
  it('distinguishes genuinely different versions', () => {
    expect(sameVersion('15.2(7)E14', '15.2(7)E5')).toBe(false);
  });
});
