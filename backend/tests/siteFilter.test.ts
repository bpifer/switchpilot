import { describe, it, expect } from 'vitest';
import { siteFilter } from '../src/routes/util.js';

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
