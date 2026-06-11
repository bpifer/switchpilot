import { describe, it, expect } from 'vitest';
import { hasRole, type AuthUser } from '../src/auth/rbac.js';

const user = (role: AuthUser['role']): AuthUser => ({ sub: 'x', username: 'test', role });

describe('RBAC hierarchy', () => {
  it('superadmin can do everything', () => {
    for (const min of ['superadmin', 'netadmin', 'helpdesk', 'readonly'] as const) {
      expect(hasRole(user('superadmin'), min)).toBe(true);
    }
  });

  it('netadmin cannot act as superadmin', () => {
    expect(hasRole(user('netadmin'), 'superadmin')).toBe(false);
    expect(hasRole(user('netadmin'), 'netadmin')).toBe(true);
    expect(hasRole(user('netadmin'), 'helpdesk')).toBe(true);
  });

  it('helpdesk can operate but not configure', () => {
    expect(hasRole(user('helpdesk'), 'netadmin')).toBe(false);
    expect(hasRole(user('helpdesk'), 'helpdesk')).toBe(true);
  });

  it('readonly can only read', () => {
    expect(hasRole(user('readonly'), 'helpdesk')).toBe(false);
    expect(hasRole(user('readonly'), 'readonly')).toBe(true);
  });
});
