// Guided onboarding: analyze a switch with bootstrap credentials, report what
// baseline config is missing, then onboard - optionally creating a dedicated
// SPAdmin account so platform changes are attributable in the switch's own logs.
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { encryptSecret } from '../crypto/secrets.js';
import { CiscoSshSession } from '../cisco/sshClient.js';
import { parseShowVersion } from '../cisco/parsers.js';
import { familyForModel, resolveCapabilities } from '../cisco/capabilities.js';
import { refreshDevice } from '../services/monitorService.js';
import { provisionDevice } from '../services/provisionService.js';

export const PLATFORM_ACCOUNT = 'SPAdmin';

interface Inspection {
  identity: { hostname: string; model: string; serial: string; iosVersion: string };
  users: { name: string; priv15: boolean }[];
  checklist: { key: string; label: string; present: boolean; why: string }[];
}

async function inspectSwitch(mgmtIp: string, username: string, password: string, enablePassword?: string): Promise<Inspection> {
  const session = new CiscoSshSession({
    host: mgmtIp, username, password,
    enablePassword: enablePassword || undefined, timeoutMs: 15000
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

    return { identity: { hostname: ver.hostname, model: ver.model, serial: ver.serial, iosVersion: ver.iosVersion }, users, checklist };
  } finally {
    session.close();
  }
}

export default async function onboardingRoutes(app: FastifyInstance) {
  const credProps = {
    mgmtIp: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
    enablePassword: { type: 'string' }
  };

  // Step 1: connect with bootstrap credentials and report device identity,
  // existing admin accounts, and which baseline settings are missing.
  app.post('/api/onboarding/analyze', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: { type: 'object', required: ['mgmtIp', 'username', 'password'], properties: credProps }
    }
  }, async (req, reply) => {
    const { mgmtIp, username, password, enablePassword } = req.body as any;

    const dup = await query('SELECT id, hostname FROM devices WHERE mgmt_ip::text = $1', [mgmtIp]);
    if (dup.rows[0]) {
      return reply.code(409).send({ error: `${mgmtIp} is already onboarded as ${dup.rows[0].hostname}` });
    }

    const inspection = await inspectSwitch(mgmtIp, username, password, enablePassword);
    const usingPlatformAccount = username === PLATFORM_ACCOUNT;
    return {
      ...inspection,
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
        type: 'object', required: ['mgmtIp', 'username', 'password'],
        properties: {
          ...credProps,
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

    const dup = await query('SELECT 1 FROM devices WHERE mgmt_ip::text = $1', [b.mgmtIp]);
    if (dup.rows[0]) return reply.code(409).send({ error: `${b.mgmtIp} is already onboarded` });

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
    const hostLabel = inspection.identity.hostname || b.mgmtIp;
    const cred = await query(
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
       encryptSecret(b.enablePassword ?? ''), encryptSecret(''), encryptSecret('')]);

    const model = inspection.identity.model;
    const { rows } = await query(
      `INSERT INTO devices (hostname, mgmt_ip, model, family, serial_number, ios_version,
         site_id, location, credential_id, capabilities, status, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'online', now()) RETURNING *`,
      [hostLabel, b.mgmtIp, model, familyForModel(model) ?? '',
       inspection.identity.serial, inspection.identity.iosVersion,
       b.siteId || null, b.location ?? '', cred.rows[0].id,
       JSON.stringify(resolveCapabilities(model, inspection.identity.iosVersion))]);
    const device = rows[0];

    await audit(me.username, 'device.onboard', b.mgmtIp,
      { model, account: finalUser, accountCreated: !!generatedPassword, baseline: !!b.applyBaseline }, req.ip);

    refreshDevice(device.id).catch(err => app.log.warn(`initial refresh failed: ${err.message}`));
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
