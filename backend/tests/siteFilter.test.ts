import { describe, it, expect } from 'vitest';
import { siteFilter, isSafeEnableSecret } from '../src/routes/util.js';

describe('siteFilter', () => {
  it('no siteId -> no condition', () => {
    expect(siteFilter(undefined)).toEqual({ cond: '', params: [] });
    expect(siteFilter('')).toEqual({ cond: '', params: [] });
  });

  it('unassigned -> IS NULL with no params', () => {
    expect(siteFilter('unassigned')).toEqual({ cond: 'd.site_id IS NULL', params: [] });
    expect(siteFilter('unassigned', 'x')).toEqual({ cond: 'x.site_id IS NULL', params: [] });
  });

  it('uuid -> parameterized equality at the requested index', () => {
    expect(siteFilter('abc-123')).toEqual({ cond: 'd.site_id = $1', params: ['abc-123'] });
    expect(siteFilter('abc-123', 'd', 3)).toEqual({ cond: 'd.site_id = $3', params: ['abc-123'] });
  });
});

describe('isSafeEnableSecret', () => {
  it('accepts reasonable secrets and the generated base64url shape', () => {
    expect(isSafeEnableSecret('Sup3r-Secret_99')).toBe(true);
    expect(isSafeEnableSecret('aB3d_xY7-qP1z')).toBe(true);   // base64url-ish
    expect(isSafeEnableSecret('p@ss!w0rd')).toBe(true);
  });
  it('rejects spaces, too short, too long, and injection characters', () => {
    expect(isSafeEnableSecret('abc')).toBe(false);            // < 4
    expect(isSafeEnableSecret('has space')).toBe(false);
    expect(isSafeEnableSecret('a'.repeat(65))).toBe(false);   // > 64
    expect(isSafeEnableSecret('x\nenable secret 0 evil')).toBe(false);
    expect(isSafeEnableSecret('pass$(whoami)')).toBe(false);
  });
});
