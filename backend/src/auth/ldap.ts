import ldap from 'ldapjs';
import { config } from '../config.js';
import type { Role } from './rbac.js';

export function ldapEnabled(): boolean {
  return Boolean(config.ldap.url && config.ldap.searchBase);
}

/** Escape a value for safe use inside an LDAP search filter (RFC 4515).
 *  The filter metacharacters are \ * ( ) and NUL. */
export function escapeLdapFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, c => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

/**
 * Authenticate against LDAP / Active Directory.
 * 1. Bind with the service account, 2. find the user DN + group memberships,
 * 3. re-bind as the user to verify the password, 4. map AD group -> role.
 */
export async function ldapAuthenticate(
  username: string,
  password: string
): Promise<{ role: Role; displayName: string; email: string } | null> {
  if (!ldapEnabled() || !password) return null;
  const client = ldap.createClient({ url: config.ldap.url, connectTimeout: 5000 });
  const bind = (dn: string, pw: string) =>
    new Promise<void>((res, rej) => client.bind(dn, pw, (e: Error | null) => (e ? rej(e) : res())));

  try {
    await bind(config.ldap.bindDn, config.ldap.bindPassword);
    const safe = escapeLdapFilter(username);
    const entry: any = await new Promise((resolve, reject) => {
      client.search(
        config.ldap.searchBase,
        {
          scope: 'sub',
          filter: `(|(sAMAccountName=${safe})(uid=${safe}))`,
          attributes: ['dn', 'displayName', 'mail', 'memberOf']
        },
        (err: Error | null, res: any) => {
          if (err) return reject(err);
          let found: any = null;
          res.on('searchEntry', (e: any) => { found = e; });
          res.on('error', reject);
          res.on('end', () => resolve(found));
        }
      );
    });
    if (!entry) return null;

    const dn = entry.objectName?.toString() ?? entry.dn?.toString();
    await bind(dn, password); // throws on bad password

    const groups: string[] = (entry.attributes ?? [])
      .find((a: any) => a.type === 'memberOf')?.values ?? [];
    const get = (type: string) =>
      (entry.attributes ?? []).find((a: any) => a.type === type)?.values?.[0] ?? '';

    let role: Role | null = null;
    for (const r of ['superadmin', 'netadmin', 'helpdesk', 'readonly'] as Role[]) {
      const groupDn = config.ldap.groupRoleMap[r];
      if (groupDn && groups.some(g => g.toLowerCase() === groupDn.toLowerCase())) { role = r; break; }
    }
    if (!role) return null; // not in any mapped group => no access

    return { role, displayName: get('displayName') || username, email: get('mail') };
  } catch {
    return null;
  } finally {
    client.unbind(() => { /* ignore */ });
  }
}
