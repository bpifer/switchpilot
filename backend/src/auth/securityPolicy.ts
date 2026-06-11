// Org-wide security policy: password complexity, expiry, MFA enforcement, lockout.
// Backed by the single-row security_settings table, cached briefly in-process.
import { query } from '../db.js';
import type { Role } from './rbac.js';

export interface SecurityPolicy {
  password_min_length: number;
  password_require_upper: boolean;
  password_require_lower: boolean;
  password_require_digit: boolean;
  password_require_symbol: boolean;
  password_max_age_days: number;
  mfa_required: boolean;
  mfa_required_roles: string[];
  lockout_threshold: number;
  lockout_minutes: number;
  updated_by: string;
  updated_at: string;
}

const CACHE_TTL_MS = 30_000;
let cache: SecurityPolicy | null = null;
let cacheAt = 0;

export async function getPolicy(): Promise<SecurityPolicy> {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  const { rows } = await query<SecurityPolicy>('SELECT * FROM security_settings WHERE id=1');
  cache = rows[0];
  cacheAt = Date.now();
  return cache;
}

export function invalidatePolicyCache(): void {
  cache = null;
}

/** Validate a plaintext password against the policy. Returns a list of failures (empty = OK). */
export function validatePassword(pw: string, policy: SecurityPolicy): string[] {
  const errors: string[] = [];
  if (pw.length < policy.password_min_length)
    errors.push(`at least ${policy.password_min_length} characters`);
  if (policy.password_require_upper && !/[A-Z]/.test(pw)) errors.push('an uppercase letter');
  if (policy.password_require_lower && !/[a-z]/.test(pw)) errors.push('a lowercase letter');
  if (policy.password_require_digit && !/[0-9]/.test(pw)) errors.push('a digit');
  if (policy.password_require_symbol && !/[^A-Za-z0-9]/.test(pw)) errors.push('a symbol');
  return errors;
}

/** Throws an Error with a friendly message if the password violates policy. */
export async function assertPasswordAllowed(pw: string): Promise<void> {
  const policy = await getPolicy();
  const missing = validatePassword(pw, policy);
  if (missing.length) {
    throw new Error(`Password must contain ${missing.join(', ')}.`);
  }
}

/** Does this user's role require MFA under the current policy? */
export function roleRequiresMfa(role: Role | string, policy: SecurityPolicy): boolean {
  if (!policy.mfa_required) return false;
  return policy.mfa_required_roles.length === 0 || policy.mfa_required_roles.includes(role);
}

/** Has the password aged past the policy max? false when expiry disabled. */
export function passwordExpired(passwordChangedAt: string | Date | null, policy: SecurityPolicy): boolean {
  if (!policy.password_max_age_days || !passwordChangedAt) return false;
  const changed = new Date(passwordChangedAt).getTime();
  const ageDays = (Date.now() - changed) / 86_400_000;
  return ageDays > policy.password_max_age_days;
}
