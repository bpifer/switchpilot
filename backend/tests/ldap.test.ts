import { describe, it, expect } from 'vitest';
import { escapeLdapFilter } from '../src/auth/ldap.js';

describe('escapeLdapFilter (RFC 4515)', () => {
  it('leaves ordinary usernames unchanged', () => {
    expect(escapeLdapFilter('jdoe')).toBe('jdoe');
    expect(escapeLdapFilter('first.last')).toBe('first.last');
  });

  it('escapes the special characters used in filter-injection attacks', () => {
    expect(escapeLdapFilter('*')).toBe('\\2a');
    expect(escapeLdapFilter('(')).toBe('\\28');
    expect(escapeLdapFilter(')')).toBe('\\29');
    expect(escapeLdapFilter('\\')).toBe('\\5c');
  });

  it('leaves non-metacharacters (including spaces) untouched', () => {
    expect(escapeLdapFilter('John Doe')).toBe('John Doe');
  });

  it('neutralises a crafted injection payload', () => {
    // would otherwise break out of the sAMAccountName clause
    const payload = '*)(uid=*))(|(uid=*';
    const escaped = escapeLdapFilter(payload);
    expect(escaped).not.toContain('*');
    expect(escaped).not.toContain('(');
    expect(escaped).not.toContain(')');
  });
});
