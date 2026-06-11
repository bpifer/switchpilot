import { describe, it, expect } from 'vitest';
import {
  validatePassword, passwordExpired, roleRequiresMfa, type SecurityPolicy
} from '../src/auth/securityPolicy.js';

const base: SecurityPolicy = {
  password_min_length: 12,
  password_require_upper: true,
  password_require_lower: true,
  password_require_digit: true,
  password_require_symbol: false,
  password_max_age_days: 0,
  mfa_required: false,
  mfa_required_roles: [],
  lockout_threshold: 5,
  lockout_minutes: 15,
  updated_by: 'test',
  updated_at: new Date().toISOString()
};

describe('validatePassword', () => {
  it('accepts a password meeting all requirements', () => {
    expect(validatePassword('CorrectHorse9', base)).toEqual([]);
  });
  it('rejects when too short and missing classes', () => {
    const missing = validatePassword('short', base);
    expect(missing).toContain('at least 12 characters');
    expect(missing).toContain('an uppercase letter');
    expect(missing).toContain('a digit');
  });
  it('enforces the symbol requirement only when enabled', () => {
    expect(validatePassword('NoSymbolsHere1', base)).toEqual([]);
    const strict = { ...base, password_require_symbol: true };
    expect(validatePassword('NoSymbolsHere1', strict)).toContain('a symbol');
    expect(validatePassword('Has$ymbol1Here', strict)).toEqual([]);
  });
});

describe('passwordExpired', () => {
  it('never expires when max age is 0', () => {
    const old = new Date(Date.now() - 999 * 86_400_000).toISOString();
    expect(passwordExpired(old, base)).toBe(false);
  });
  it('expires once older than the max age', () => {
    const policy = { ...base, password_max_age_days: 90 };
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const fresh = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(passwordExpired(old, policy)).toBe(true);
    expect(passwordExpired(fresh, policy)).toBe(false);
  });
});

describe('roleRequiresMfa', () => {
  it('is off when policy does not require MFA', () => {
    expect(roleRequiresMfa('superadmin', base)).toBe(false);
  });
  it('applies to all roles when no role list is set', () => {
    const policy = { ...base, mfa_required: true };
    expect(roleRequiresMfa('readonly', policy)).toBe(true);
    expect(roleRequiresMfa('superadmin', policy)).toBe(true);
  });
  it('applies only to listed roles when a list is set', () => {
    const policy = { ...base, mfa_required: true, mfa_required_roles: ['superadmin', 'netadmin'] };
    expect(roleRequiresMfa('superadmin', policy)).toBe(true);
    expect(roleRequiresMfa('readonly', policy)).toBe(false);
  });
});
