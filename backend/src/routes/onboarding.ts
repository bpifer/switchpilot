// Guided onboarding: analyze a switch with bootstrap credentials, report what
// baseline config is missing, then onboard - optionally creating a dedicated
// SPAdmin account so platform changes are attributable in the switch's own logs.
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { encryptSecret, decryptSecret } from '../crypto/secrets.js';
import { CiscoSshSession } from '../cisco/sshClient.js';
import { makeHostVerifier } from '../cisco/hostKey.js';
import { RouterOsSshSession, runRouterOsCommands } from '../routeros/sshClient.js';
import { parseShowVersion } from '../cisco/parsers.js';
import { familyForModel, resolveCapabilities } from '../cisco/capabilities.js';
import { detectRouterOs, isRouterOs } from '../routeros/detector.js';
import { resolveRosCapabilities } from '../routeros/capabilities.js';
import { refreshDevice } from '../services/monitorService.js';
import { provisionDevice } from '../services/provisionService.js';
import { snmpProbe } from '../cisco/snmpClient.js';
import { detectAruba } from '../aruba/snmp.js';

export const PLATFORM_ACCOUNT = 'SPAdmin';

/** Probe a device's vendor with the bootstrap credentials. RouterOS answers
 *  `/system resource print` with platform MikroTik; anything else is treated
 *  as Cisco. Cheap and read-only. */
async function probeVendor(mgmtIp: string, username: string, password: string): Promise<'mikrotik' | 'cisco'> {
  try {
    const out = await runRouterOsCommands(
      { host: mgmtIp, username, password, timeoutMs: 12000 },
      ['/system resource print']);
    if (isRouterOs(out['/system resource print'] ?? '')) return 'mikrotik';
  } catch { /* not RouterOS (or exec channel refused, as some IOS do) */ }
  return 'cisco';
}

/** An ssh2 hostVerifier that records the presented host-key fingerprint (and
 *  accepts it, since the device is not yet pinned) so onboarding can show it for
 *  manual verification before the first real connect pins it. */
function captureFp(): { verifier: (key: Buffer) => boolean; get: () => string } {
  let captured = '';
  return { verifier: makeHostVerifier({ expectedFp: '', onPin: fp => { captured = fp; } }), get: () => captured };
}

/** RouterOS analogue of inspectSwitch: identity + baseline checklist. */
async function inspectRouterOs(mgmtIp: string, username: string, password: string): Promise<Inspection> {
  const cmds = {
    resource: '/system resource print',
    routerboard: '/system routerboard print',
    identity: '/system identity print',
    discovery: '/ip neighbor discovery-settings print',
    logging: '/system logging action print terse',
    snmp: '/snmp print',
  };
  const cap = captureFp();
  const out = await runRouterOsCommands({ host: mgmtIp, username, password, timeoutMs: 15000, hostVerifier: cap.verifier }, Object.values(cmds));
  const g = (k: keyof typeof cmds) => out[cmds[k]] ?? '';
  const det = detectRouterOs({ resource: g('resource'), routerboard: g('routerboard'), identity: g('identity') });

  const platformHost = (process.env.PLATFORM_URL ?? '').match(/^https?:\/\/([^:/]+)/)?.[1] ?? null;
  const checklist = [
    {
      key: 'lldp', label: 'Neighbor discovery enabled',
      present: !/discover-interface-list:\s*none/i.test(g('discovery')),
      why: 'discovers MNDP/CDP/LLDP neighbors for Topology and Discovery'
    },
    {
      key: 'syslog',
      label: platformHost ? `Syslog forwarding to ${platformHost}` : 'Syslog forwarding (PLATFORM_URL not set)',
      present: !!platformHost && new RegExp(`remote=${platformHost.replace(/\./g, '\\.')}`).test(g('logging')),
      why: 'real-time alerts and the Logs page'
    },
    {
      key: 'snmp', label: 'SNMP enabled',
      present: /enabled:\s*yes/i.test(g('snmp')),
      why: 'fast status polling without opening an SSH session each sweep'
    },
  ];
  return {
    identity: { hostname: det.hostname, model: det.model, serial: det.serial, iosVersion: det.version },
    users: [],
    checklist,
    hostKeyFingerprint: cap.get(),
  };
}

interface Inspection {
  identity: { hostname: string; model: string; serial: string; iosVersion: string };
  users: { name: string; priv15: boolean }[];
  checklist: { key: string; label: string; present: boolean; why: string }[];
  hostKeyFingerprint?: string;   // SHA256 fingerprint of the switch's SSH host key
}

async function inspectSwitch(mgmtIp: string, username: string, password: string, enablePassword?: string): Promise<Inspection> {
  const cap = captureFp();
  const session = new CiscoSshSession({
    host: mgmtIp, username, password,
    enablePassword: enablePassword || undefined, timeoutMs: 15000,
    hostVerifier: cap.verifier
  });
  await session.connect();
  try {
    await session.enable();
    const ver = parseShowVersion(await session.exec('show version'));
    const cfg = await session.exec(
      'show running-config | include ^username|^lldp run|^logging host|^snmp-server community');

    const users = [...cfg.matchAll(/^username (\S+)(.*)$/gm)]
      .map(m => ({ name: m[1], priv15: /privilege 15/.test(m[2]) }));

    const platformHost = (process.env.PLATFORM_URL ?? '').match(/^https?:\/\/([^:/]+)/)?.[1] ?? null;
    const checklist = [
      {
        key: 'lldp', label: 'LLDP enabled (lldp run)',
        present: /^lldp run/m.test(cfg),
        why: 'discovers non-Cisco neighbors (UniFi, APs, servers) for Topology and Discovery'
      },
      {
        key: 'syslog',
        label: platformHost ? `Syslog forwarding to ${platformHost}` : 'Syslog forwarding (PLATFORM_URL not set)',
        present: platformHost
          ? new RegExp(`^logging host ${platformHost.replace(/\./g, '\\.')}`, 'm').test(cfg)
          : false,
        why: 'real-time alerts and the Logs page: link flaps, config changes, errdisable'
      },
      {
        key: 'snmp', label: 'SNMP read-only community',
        present: /^snmp-server community/m.test(cfg),
        why: 'fast status polling without opening an SSH session each sweep'
      }
    ];

    return { identity: { hostname: ver.hostname, model: ver.model, serial: ver.serial, iosVersion: ver.iosVersion }, users, checklist, hostKeyFingerprint: cap.get() };
  } finally {
    session.close();
  }
}

/** Resolve a saved credential profile into plaintext connection secrets, so the
 *  wizard can onboard with an existing profile without secrets ever leaving the
 *  server. Throws 400 when the profile is missing. */
async function resolveCredential(credentialId: string) {
  const { rows } = await query('SELECT * FROM credentials WHERE id=$1', [credentialId]);
  const c = rows[0];
  if (!c) throw Object.assign(new Error('Selected credential profile no longer exists'), { statusCode: 400 });
  return {
    id: c.id as string,
    name: c.name as string,
    username: (c.ssh_username as string) ?? '',
    password: decryptSecret(c.ssh_password_enc),
    enablePassword: decryptSecret(c.enable_password_enc) || undefined,
    snmpCommunity: decryptSecret(c.snmp_community_enc),
  };
}

export default async function onboardingRoutes(app: FastifyInstance) {
  const credProps = {
    mgmtIp: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
    enablePassword: { type: 'string' },
    credentialId: { type: 'string' }   // use a saved profile instead of raw creds
  };

  // Aruba Instant On SNMP-only probe: verify the device is reachable via SNMP
  // and return its identity before committing to onboarding.
  app.post('/api/onboarding/probe-aruba', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: { type: 'object', required: ['mgmtIp'],
        properties: { mgmtIp: { type: 'string' }, snmpCommunity: { type: 'string' }, credentialId: { type: 'string' } } }
    }
  }, async (req, reply) => {
    const { mgmtIp, credentialId } = req.body as any;
    let { snmpCommunity } = req.body as any;
    if (credentialId) {
      snmpCommunity = (await resolveCredential(credentialId)).snmpCommunity;
      if (!snmpCommunity) {
        throw Object.assign(new Error('The selected credential profile has no SNMP community configured'), { statusCode: 400 });
      }
    }
    if (!snmpCommunity) {
      throw Object.assign(new Error('Provide an SNMP community string or pick a credential profile'), { statusCode: 400 });
    }

    const dup = await query('SELECT id, hostname FROM devices WHERE host(mgmt_ip) = $1', [mgmtIp.trim()]);
    if (dup.rows[0]) return reply.code(409).send({ error: `${mgmtIp} is already onboarded as "${dup.rows[0].hostname}"` });

    const probe = await snmpProbe({ host: mgmtIp.trim(), version: '2c', community: snmpCommunity });
    if (!probe) {
      throw Object.assign(
        new Error(`SNMP probe failed — check that ${mgmtIp} is reachable on UDP/161 and the community string is correct`),
        { statusCode: 422 }
      );
    }
    const det = detectAruba(probe.sysDescr);
    if (!det.isAruba) {
      throw Object.assign(
        new Error(`Device responded to SNMP but does not appear to be an Aruba Instant On (sysDescr: "${probe.sysDescr.slice(0, 80)}")`),
        { statusCode: 422 }
      );
    }
    return {
      vendor: 'aruba' as const,
      identity: {
        hostname: probe.sysName || mgmtIp,
        model: det.model || 'Aruba Instant On',
        serial: '',
        iosVersion: det.version,
      },
      sysDescr: probe.sysDescr,
      uptimeSeconds: probe.uptimeSeconds,
    };
  });

  // Step 1: connect with bootstrap credentials and report device identity,
  // existing admin accounts, and which baseline settings are missing.
  app.post('/api/onboarding/analyze', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: { type: 'object', required: ['mgmtIp'], properties: credProps }
    }
  }, async (req, reply) => {
    const { mgmtIp, credentialId } = req.body as any;
    let { username, password, enablePassword } = req.body as any;
    if (credentialId) {
      const c = await resolveCredential(credentialId);
      if (!c.username || !c.password) {
        throw Object.assign(new Error('The selected credential profile has no SSH credentials configured'), { statusCode: 400 });
      }
      ({ username, password, enablePassword } = c);
    }
    if (!username || !password) {
      throw Object.assign(new Error('Provide a username and password or pick a credential profile'), { statusCode: 400 });
    }

    const dup = await query('SELECT id, hostname FROM devices WHERE host(mgmt_ip) = $1', [mgmtIp]);
    if (dup.rows[0]) {
      return reply.code(409).send({ error: `${mgmtIp} is already onboarded as ${dup.rows[0].hostname}` });
    }

    const vendor = await probeVendor(mgmtIp, username, password);
    if (vendor === 'mikrotik') {
      // RouterOS has no privilege-15/SPAdmin concept; onboard with the given user.
      const inspection = await inspectRouterOs(mgmtIp, username, password);
      return { ...inspection, vendor, usingPlatformAccount: false, spAdminExists: false, otherAdmins: [] };
    }

    const inspection = await inspectSwitch(mgmtIp, username, password, enablePassword);
    const usingPlatformAccount = username === PLATFORM_ACCOUNT;
    return {
      ...inspection,
      vendor,
      usingPlatformAccount,
      spAdminExists: inspection.users.some(u => u.name === PLATFORM_ACCOUNT),
      otherAdmins: inspection.users.filter(u => u.priv15 && u.name !== PLATFORM_ACCOUNT).map(u => u.name)
    };
  });

  // Step 2: onboard. Optionally create the dedicated SPAdmin account (random
  // password, stored encrypted as a credential profile) and apply the baseline.
  app.post('/api/onboarding/complete', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: {
        type: 'object',
        properties: {
          ...credProps,
          vendor: { type: 'string' },          // 'aruba' triggers SNMP-only path
          snmpCommunity: { type: 'string' },
          siteId: { type: 'string' },
          location: { type: 'string' },
          createAccount: { type: 'boolean', default: true },
          applyBaseline: { type: 'boolean', default: true }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;

    const dup = await query('SELECT 1 FROM devices WHERE host(mgmt_ip) = $1', [b.mgmtIp]);
    if (dup.rows[0]) return reply.code(409).send({ error: `${b.mgmtIp} is already onboarded` });

    // Saved-profile onboarding: resolve the secrets server-side and remember the
    // profile id so the device attaches to it instead of spawning a duplicate.
    let presetCredId: string | null = null;
    if (b.credentialId) {
      const c = await resolveCredential(b.credentialId);
      presetCredId = c.id;
      b.username = c.username || b.username;
      b.password = c.password || b.password;
      b.enablePassword = c.enablePassword ?? b.enablePassword;
      b.snmpCommunity = c.snmpCommunity || b.snmpCommunity;
    }

    // --- Aruba Instant On path: SNMP-only, no SSH credential stored ---
    if (b.vendor === 'aruba') {
      const probe = await snmpProbe({ host: b.mgmtIp.trim(), version: '2c', community: b.snmpCommunity });
      if (!probe) throw Object.assign(new Error(`SNMP is no longer reachable at ${b.mgmtIp}`), { statusCode: 422 });
      const det = detectAruba(probe.sysDescr);
      const hostLabel = probe.sysName || b.mgmtIp;
      const model = det.model || 'Aruba Instant On';

      const credId = presetCredId ?? (await query(
        `INSERT INTO credentials (name, ssh_username, ssh_password_enc, enable_password_enc,
           snmp_version, snmp_community_enc, snmpv3_user, snmpv3_auth_proto, snmpv3_auth_key_enc,
           snmpv3_priv_proto, snmpv3_priv_key_enc)
         VALUES ($1,'',$2,$2,'2c',$3,'','sha',$4,'aes',$4)
         ON CONFLICT (name) DO UPDATE SET snmp_community_enc=EXCLUDED.snmp_community_enc
         RETURNING id`,
        [`snmp (${hostLabel})`, encryptSecret(''), encryptSecret(b.snmpCommunity), encryptSecret('')])).rows[0].id;

      const { rows } = await query(
        `INSERT INTO devices (hostname, mgmt_ip, model, family, serial_number, ios_version,
           vendor, site_id, location, credential_id, capabilities, status, last_seen_at)
         VALUES ($1,$2,$3,'aruba-instant-on','',$4,'aruba',$5,$6,$7,'{}'::jsonb,'online', now()) RETURNING *`,
        [hostLabel, b.mgmtIp, model, det.version ?? '',
         b.siteId || null, b.location ?? '', credId]);
      const device = rows[0];

      await audit(me.username, 'device.onboard', b.mgmtIp, { model, vendor: 'aruba' }, req.ip);
      await refreshDevice(device.id).catch(err => app.log.warn(`initial Aruba refresh failed: ${err.message}`));
      return reply.code(201).send({ device, account: '', generatedPassword: null, warnings: [] });
    }

    // --- RouterOS path: no SPAdmin/privilege-15 account; onboard as-is ---
    if (await probeVendor(b.mgmtIp, b.username, b.password) === 'mikrotik') {
      const inspection = await inspectRouterOs(b.mgmtIp, b.username, b.password);
      const rosWarnings: string[] = [];
      const hostLabel = inspection.identity.hostname || b.mgmtIp;
      const caps = resolveRosCapabilities(inspection.identity.model);

      const credId = presetCredId ?? (await query(
        `INSERT INTO credentials (name, ssh_username, ssh_password_enc, enable_password_enc,
           snmp_version, snmp_community_enc, snmpv3_user, snmpv3_auth_proto, snmpv3_auth_key_enc,
           snmpv3_priv_proto, snmpv3_priv_key_enc)
         VALUES ($1,$2,$3,$4,'2c',$5,'','sha',$6,'aes',$6)
         ON CONFLICT (name) DO UPDATE SET
           ssh_username=EXCLUDED.ssh_username, ssh_password_enc=EXCLUDED.ssh_password_enc
         RETURNING id`,
        [`${b.username} (${hostLabel})`, b.username, encryptSecret(b.password),
         encryptSecret(''), encryptSecret(''), encryptSecret('')])).rows[0].id;

      const { rows } = await query(
        `INSERT INTO devices (hostname, mgmt_ip, model, family, serial_number, ios_version,
           vendor, site_id, location, credential_id, capabilities, status, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,'mikrotik',$7,$8,$9,$10,'online', now()) RETURNING *`,
        [hostLabel, b.mgmtIp, inspection.identity.model, (caps.family as string) ?? '',
         inspection.identity.serial, inspection.identity.iosVersion,
         b.siteId || null, b.location ?? '', credId, JSON.stringify(caps)]);
      const device = rows[0];

      await audit(me.username, 'device.onboard', b.mgmtIp,
        { model: inspection.identity.model, vendor: 'mikrotik', account: b.username, baseline: !!b.applyBaseline }, req.ip);

      await refreshDevice(device.id).catch(err => {
        app.log.warn(`initial RouterOS refresh failed: ${err.message}`);
        rosWarnings.push(`initial scan did not complete: ${err.message} - use "Refresh now" on the device.`);
      });
      if (b.applyBaseline) {
        await provisionDevice(device.id, me.username)
          .catch(err => { rosWarnings.push(`baseline job failed to queue: ${err.message}`); });
      }

      return reply.code(201).send({
        device, account: b.username, generatedPassword: null,
        checklist: inspection.checklist, warnings: rosWarnings
      });
    }

    let finalUser = b.username;
    let finalPass = b.password;
    let generatedPassword: string | null = null;
    const warnings: string[] = [];

    // Create the platform account unless the operator already supplied it
    if (b.createAccount && b.username !== PLATFORM_ACCOUNT) {
      generatedPassword = randomBytes(15).toString('base64url'); // 20 chars, URL-safe
      const bootstrap = new CiscoSshSession({
        host: b.mgmtIp, username: b.username, password: b.password,
        enablePassword: b.enablePassword || undefined, timeoutMs: 15000
      });
      await bootstrap.connect();
      try {
        await bootstrap.enable();
        await bootstrap.configure([`username ${PLATFORM_ACCOUNT} privilege 15 secret ${generatedPassword}`]);
        await bootstrap.saveConfig();
      } finally {
        bootstrap.close();
      }
      // Prove the new account works before we rely on it
      const probe = new CiscoSshSession({ host: b.mgmtIp, username: PLATFORM_ACCOUNT, password: generatedPassword, timeoutMs: 15000 });
      await probe.connect();
      probe.close();
      finalUser = PLATFORM_ACCOUNT;
      finalPass = generatedPassword;
    }

    // Inspect with the final credentials (also re-validates them)
    const inspection = await inspectSwitch(b.mgmtIp, finalUser, finalPass, b.enablePassword);
    const otherAdmins = inspection.users.filter(u => u.priv15 && u.name !== PLATFORM_ACCOUNT);
    if (finalUser === PLATFORM_ACCOUNT && otherAdmins.length === 0) {
      warnings.push(`${PLATFORM_ACCOUNT} is the only privilege-15 account on this switch - create a break-glass admin account so you are not locked out if the platform credential is lost.`);
    }

    // Store the working credentials as a device-specific profile. credentials.name
    // is UNIQUE and is NOT removed when a device is deleted, so re-onboarding the
    // same switch must update the existing profile rather than fail on conflict.
    // When a saved profile was used and no SPAdmin was created (so the working
    // credentials ARE the profile's), attach the profile instead of cloning it.
    const hostLabel = inspection.identity.hostname || b.mgmtIp;
    const credId = (presetCredId && generatedPassword === null) ? presetCredId : (await query(
      `INSERT INTO credentials (name, ssh_username, ssh_password_enc, enable_password_enc,
         snmp_version, snmp_community_enc, snmpv3_user, snmpv3_auth_proto, snmpv3_auth_key_enc,
         snmpv3_priv_proto, snmpv3_priv_key_enc)
       VALUES ($1,$2,$3,$4,'2c',$5,'','sha',$6,'aes',$6)
       ON CONFLICT (name) DO UPDATE SET
         ssh_username=EXCLUDED.ssh_username,
         ssh_password_enc=EXCLUDED.ssh_password_enc,
         enable_password_enc=EXCLUDED.enable_password_enc
       RETURNING id`,
      [`${finalUser} (${hostLabel})`, finalUser, encryptSecret(finalPass),
       encryptSecret(b.enablePassword ?? ''), encryptSecret(''), encryptSecret('')])).rows[0].id;

    const model = inspection.identity.model;
    const { rows } = await query(
      `INSERT INTO devices (hostname, mgmt_ip, model, family, serial_number, ios_version,
         site_id, location, credential_id, capabilities, status, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'online', now()) RETURNING *`,
      [hostLabel, b.mgmtIp, model, familyForModel(model) ?? '',
       inspection.identity.serial, inspection.identity.iosVersion,
       b.siteId || null, b.location ?? '', credId,
       JSON.stringify(resolveCapabilities(model, inspection.identity.iosVersion))]);
    const device = rows[0];

    await audit(me.username, 'device.onboard', b.mgmtIp,
      { model, account: finalUser, accountCreated: !!generatedPassword, baseline: !!b.applyBaseline }, req.ip);

    // Run the initial full scan inline so the device page already has ports,
    // VLANs, neighbors, etc. when the operator opens it. Non-fatal on failure.
    await refreshDevice(device.id).catch(err => {
      app.log.warn(`initial refresh failed: ${err.message}`);
      warnings.push(`initial scan did not complete: ${err.message} - use "Refresh now" on the device.`);
    });
    if (b.applyBaseline) {
      await provisionDevice(device.id, me.username)
        .catch(err => { warnings.push(`baseline job failed to queue: ${err.message}`); });
    }

    return reply.code(201).send({
      device,
      account: finalUser,
      generatedPassword,   // shown once in the UI; stored encrypted server-side
      checklist: inspection.checklist,
      warnings
    });
  });
}
