// Q-BRIDGE bitmap arithmetic in the Aruba write path. An off-by-one in the
// MSB-first indexing would silently put VLANs on the wrong ports, so every
// boundary (byte edges, buffer growth) gets pinned here. parseVlanList rounds
// out the pure helpers in the same module.
import { describe, it, expect, vi } from 'vitest';

// write.ts imports redis + deviceComms at module load; neither is touched by
// the pure helpers under test, but mocking keeps the import side-effect free.
vi.mock('../src/redis.js', () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../src/services/deviceComms.js', () => ({
  getDevice: vi.fn(), snmpTargetFor: vi.fn(), assertNotUplink: vi.fn(),
}));

import { portBit, bitmapSet, parseVlanList } from '../src/aruba/write.js';

describe('portBit (MSB-first Q-BRIDGE indexing)', () => {
  it('port 1 is the high bit of byte 0', () => {
    expect(portBit(1)).toEqual({ byteIdx: 0, mask: 0x80 });
  });
  it('port 8 is the low bit of byte 0', () => {
    expect(portBit(8)).toEqual({ byteIdx: 0, mask: 0x01 });
  });
  it('port 9 rolls over to the high bit of byte 1', () => {
    expect(portBit(9)).toEqual({ byteIdx: 1, mask: 0x80 });
  });
  it('port 24 is the low bit of byte 2 (last copper on a 1930-24G)', () => {
    expect(portBit(24)).toEqual({ byteIdx: 2, mask: 0x01 });
  });
  it('port 25 (first SFP on a 1930-24G) is the high bit of byte 3', () => {
    expect(portBit(25)).toEqual({ byteIdx: 3, mask: 0x80 });
  });
});

describe('bitmapSet', () => {
  it('sets a bit without mutating the input buffer', () => {
    const buf = Buffer.alloc(8);
    const result = bitmapSet(buf, 1, true);
    expect(result[0]).toBe(0x80);
    expect(buf[0]).toBe(0x00);   // original untouched (read-modify-write safety)
  });

  it('clears exactly one bit and leaves every other bit alone', () => {
    const buf = Buffer.from([0xff, 0xff]);
    const result = bitmapSet(buf, 1, false);
    expect(result[0]).toBe(0x7f);
    expect(result[1]).toBe(0xff);
  });

  it('setting an already-set bit is a no-op on the rest of the bitmap', () => {
    const buf = Buffer.from([0xa5, 0x3c]);
    const result = bitmapSet(buf, 1, true);
    expect([...result]).toEqual([0xa5 | 0x80, 0x3c]);
  });

  it('grows the buffer when the port falls beyond the current length', () => {
    const buf = Buffer.alloc(1);
    const result = bitmapSet(buf, 9, true);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(0x00);
    expect(result[1]).toBe(0x80);
  });

  it('round-trips: set then clear an initially-clear bit returns the original bytes', () => {
    const original = Buffer.from([0x12, 0x34, 0x56]);   // port 9 (0x80 of byte 1) is clear
    const roundTripped = bitmapSet(bitmapSet(original, 9, true), 9, false);
    expect([...roundTripped]).toEqual([0x12, 0x34, 0x56]);
  });
});

describe('parseVlanList', () => {
  it('parses singles, ranges, and mixes', () => {
    expect(parseVlanList('10,20,30-33')).toEqual([10, 20, 30, 31, 32, 33]);
  });
  it('empty spec means "all VLANs" (empty array)', () => {
    expect(parseVlanList('  ')).toEqual([]);
  });
  it('caps ranges at VLAN 4094 and ignores junk tokens', () => {
    expect(parseVlanList('4093-4099')).toEqual([4093, 4094]);
    expect(parseVlanList('abc,15')).toEqual([15]);
  });
});
