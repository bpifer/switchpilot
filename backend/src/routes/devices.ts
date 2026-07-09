import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { redis } from '../redis.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { encryptSecret } from '../crypto/secrets.js';
import { detectDevice } from '../cisco/detector.js';
import { listFamilies, resolveCapabilities, familyForModel } from '../cisco/capabilities.js';
import { getDevice, sshTargetFor, snmpTargetFor, repinHostKey, rebootDevice } from '../services/deviceComms.js';
import { refreshDevice } from '../services/monitorService.js';
import { getFwUpdate } from '../services/firmwareState.js';
import { provisionDevice, buildProvisionPlan } from '../services/provisionService.js';

export default async function deviceRoutes(app: FastifyInstance) {
  // ----- Capability database -----
  app.get('/api/families', { preHandler: requireRole('readonly'), schema: { tags: ['devices'] } },
    async () => listFamilies());

  // ----- Sites -----
  app.get('/api/sites', { preHandler: requireRole('readonly'), schema: { tags: ['devices'] } },
    async () => (await query('SELECT * FROM sites ORDER BY name')).rows);

  app.post('/api/sites', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, address: { type: 'string' } } }
    }
  }, async (req, reply) => {
    const { name, address } = req.body as any;
    const { rows } = await query('INSERT INTO sites (name, address) VALUES ($1,$2) RETURNING *', [name, address ?? '']);
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/sites/:id', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, address: { type: 'string' } } }
    }
  }, async (req, reply) => {
    const { name, address } = req.body as any;
    const { rows } = await query('UPDATE sites SET name=$1, address=$2 WHERE id=$3 RETURNING *',
      [name, address ?? '', (req.params as any).id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Site not found' });
    return rows[0];
  });

  app.delete('/api/sites/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['devices'] } },
    async (req, reply) => {
      const { id } = req.params as any;
      const inUse = await query('SELECT count(*)::int AS n FROM devices WHERE site_id=$1', [id]);
      if (inUse.rows[0].n > 0) {
        return reply.code(409).send({ error: `Site has ${inUse.rows[0].n} device(s) assigned - reassign them first` });
      }
      await query('DELETE FROM sites WHERE id=$1', [id]);
      return { ok: true };
    });

  // ----- Credential profiles -----
  app.get('/api/credentials', { preHandler: requireRole('netadmin'), schema: { tags: ['devices'] } },
    async () => (await query('SELECT id, name, ssh_username, snmp_version, created_at FROM credentials ORDER BY name')).rows);

  app.post('/api/credentials', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: {
        type: 'object', required: ['name'],
        properties: {
          name: { type: 'string' }, sshUsername: { type: 'string' }, sshPassword: { type: 'string' },
          enablePassword: { type: 'string' }, snmpVersion: { type: 'string', enum: ['2c', '3'] },
          snmpCommunity: { type: 'string' }, snmpv3User: { type: 'string' },
          snmpv3AuthProto: { type: 'string' }, snmpv3AuthKey: { type: 'string' },
          snmpv3PrivProto: { type: 'string' }, snmpv3PrivKey: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;
    const { rows } = await query(
      `INSERT INTO credentials (name, ssh_username, ssh_password_enc, enable_password_enc,
         snmp_version, snmp_community_enc, snmpv3_user, snmpv3_auth_proto, snmpv3_auth_key_enc,
         snmpv3_priv_proto, snmpv3_priv_key_enc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, name`,
      [b.name, b.sshUsername ?? '', encryptSecret(b.sshPassword ?? ''), encryptSecret(b.enablePassword ?? ''),
       b.snmpVersion ?? '2c', encryptSecret(b.snmpCommunity ?? ''), b.snmpv3User ?? '',
       b.snmpv3AuthProto ?? 'sha', encryptSecret(b.snmpv3AuthKey ?? ''),
       b.snmpv3PrivProto ?? 'aes', encryptSecret(b.snmpv3PrivKey ?? '')]);
    await audit(me.username, 'credential.create', b.name, {}, req.ip);
    return reply.code(201).send(rows[0]);
  });

  // Edit a credential in place so rotating a password does NOT mean
  // delete-and-recreate (which would NULL every device's credential_id via the
  // FK). Partial update: only fields actually sent are changed, so omitting a
  // secret leaves the stored one intact instead of blanking it.
  app.put('/api/credentials/:id', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' }, sshUsername: { type: 'string' }, sshPassword: { type: 'string' },
          enablePassword: { type: 'string' }, snmpVersion: { type: 'string', enum: ['2c', '3'] },
          snmpCommunity: { type: 'string' }, snmpv3User: { type: 'string' },
          snmpv3AuthProto: { type: 'string' }, snmpv3AuthKey: { type: 'string' },
          snmpv3PrivProto: { type: 'string' }, snmpv3PrivKey: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const id = (req.params as any).id;
    const b = req.body as any;
    const me = req.user as any;
    // Column names are from these fixed maps (never user input), so they are safe
    // to interpolate; all values stay parameterized. Plaintext vs encrypted split.
    const plain: Record<string, string> = {
      name: 'name', sshUsername: 'ssh_username', snmpVersion: 'snmp_version',
      snmpv3User: 'snmpv3_user', snmpv3AuthProto: 'snmpv3_auth_proto', snmpv3PrivProto: 'snmpv3_priv_proto'
    };
    const secret: Record<string, string> = {
      sshPassword: 'ssh_password_enc', enablePassword: 'enable_password_enc', snmpCommunity: 'snmp_community_enc',
      snmpv3AuthKey: 'snmpv3_auth_key_enc', snmpv3PrivKey: 'snmpv3_priv_key_enc'
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, col] of Object.entries(plain)) {
      if (b[key] !== undefined) { params.push(b[key]); sets.push(`${col}=$${params.length}`); }
    }
    for (const [key, col] of Object.entries(secret)) {
      if (b[key] !== undefined) { params.push(encryptSecret(b[key])); sets.push(`${col}=$${params.length}`); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'No fields to update' });
    params.push(id);
    const { rows } = await query(
      `UPDATE credentials SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING id, name`, params);
    if (!rows[0]) return reply.code(404).send({ error: 'Credential not found' });
    // Audit field NAMES only - never values.
    const changed = [...Object.keys(plain), ...Object.keys(secret)].filter(k => b[k] !== undefined);
    await audit(me.username, 'credential.update', id, { fields: changed }, req.ip);
    return rows[0];
  });

  app.delete('/api/credentials/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['devices'] } },
    async (req) => {
      const me = req.user as any;
      await query('DELETE FROM credentials WHERE id=$1', [(req.params as any).id]);
      await audit(me.username, 'credential.delete', (req.params as any).id, {}, req.ip);
      return { ok: true };
    });

  // ----- Devices -----
  app.get('/api/devices', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['devices'],
      querystring: {
        type: 'object',
        properties: {
          siteId: { type: 'string' }, status: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Page size; omit for all rows' },
          after: { type: 'string', description: 'Keyset cursor: return devices with hostname > this value' }
        }
      }
    }
  }, async (req, reply) => {
    const q = req.query as any;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (q.siteId === 'unassigned') conds.push('d.site_id IS NULL');
    else if (q.siteId) { params.push(q.siteId); conds.push(`d.site_id=$${params.length}`); }
    if (q.status) { params.push(q.status); conds.push(`d.status=$${params.length}`); }
    if (q.after) { params.push(q.after); conds.push(`d.hostname > $${params.length}`); }
    let limitClause = '';
    if (q.limit) { params.push(q.limit); limitClause = `LIMIT $${params.length}`; }
    const { rows } = await query(
      `SELECT d.*, s.name AS site_name
       FROM devices d LEFT JOIN sites s ON s.id=d.site_id
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
       ORDER BY d.hostname ${limitClause}`, params);
    // Cursor for the next page (clients pass it back as ?after=)
    if (q.limit && rows.length === q.limit) reply.header('x-next-cursor', rows[rows.length - 1].hostname);
    return rows;
  });

  app.get('/api/devices/:id', { preHandler: requireRole('readonly'), schema: { tags: ['devices'] } },
    async (req) => {
      const device = await getDevice((req.params as any).id);
      // Commit-confirm state: while a safe-apply push is inside its confirmation
      // window, this holds the ISO time the device-side auto-revert fires
      // (redis TTL matches the timer, so it self-clears). Null otherwise.
      const revertArmedUntil = await redis.get(`device:${device.id}:revertArmed`).catch(() => null);
      // Firmware-update state (downloaded/staged or installing during a reboot).
      const firmwareUpdate = await getFwUpdate(device.id);
      return { ...device, revert_armed_until: revertArmedUntil, firmware_update: firmwareUpdate };
    });

  // Onboard a device — manual model or auto-detect
  app.post('/api/devices', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: {
        type: 'object', required: ['mgmtIp', 'credentialId'],
        properties: {
          mgmtIp: { type: 'string' },
          credentialId: { type: 'string' },
          siteId: { type: 'string' },
          location: { type: 'string' },
          model: { type: 'string', description: 'Set to onboard with a manual model; omit for auto-detection' },
          hostname: { type: 'string' },
          provision: { type: 'boolean', description: 'Queue a baseline config push (lldp run, syslog, SNMP) after onboarding' }
        }
      }
    }
  }, async (req, reply) => {
    const b = req.body as any;
    const me = req.user as any;

    let detected: any = {
      hostname: b.hostname ?? '', model: b.model ?? '', serial: '', iosVersion: '',
      uptimeSeconds: null, family: b.model ? familyForModel(b.model) : null,
      capabilities: b.model ? resolveCapabilities(b.model, '') : {}
    };

    if (!b.model) {
      // auto-detect: build temporary targets from the credential profile
      const fake = { id: '', hostname: '', mgmt_ip: b.mgmtIp, model: '', family: '', credential_id: b.credentialId, capabilities: {} };
      const ssh = await sshTargetFor(fake as any).catch(() => null);
      const snmpT = await snmpTargetFor(fake as any).catch(() => null);
      detected = await detectDevice(ssh, snmpT);
    }

    const { rows } = await query(
      `INSERT INTO devices (hostname, mgmt_ip, model, family, serial_number, ios_version,
         uptime_seconds, site_id, location, credential_id, capabilities, vendor, status, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'online', now()) RETURNING *`,
      [detected.hostname || b.hostname || b.mgmtIp, b.mgmtIp, detected.model, detected.family ?? '',
       detected.serial ?? '', detected.iosVersion ?? '', detected.uptimeSeconds,
       b.siteId ?? null, b.location ?? '', b.credentialId, JSON.stringify(detected.capabilities ?? {}),
       // SNMP detection can identify a non-Cisco vendor (aruba); default stays cisco
       detected.vendor ?? 'cisco']);
    await audit(me.username, 'device.create', b.mgmtIp, { model: detected.model, via: b.model ? 'manual' : detected.detectedVia }, req.ip);

    // kick off a full refresh in the background (ports, env, stack, neighbors)
    refreshDevice(rows[0].id).catch(err => app.log.warn(`initial refresh failed: ${err.message}`));

    // optional baseline config push, queued as a visible job
    if (b.provision) {
      await provisionDevice(rows[0].id, me.username)
        .catch(err => app.log.warn(`provisioning job failed to queue: ${err.message}`));
    }
    return reply.code(201).send(rows[0]);
  });

  // Preview the baseline plan for a device (lines + explanations)
  app.get('/api/devices/:id/provision', { preHandler: requireRole('netadmin'), schema: { tags: ['devices'] } },
    async (req) => buildProvisionPlan((req.params as any).id));

  // Queue the baseline config push for an existing device
  app.post('/api/devices/:id/provision', { preHandler: requireRole('netadmin'), schema: { tags: ['devices'] } },
    async (req, reply) => {
      const me = req.user as any;
      const result = await provisionDevice((req.params as any).id, me.username);
      await audit(me.username, 'device.provision', (req.params as any).id, { lines: result.lines }, req.ip);
      return reply.code(202).send(result);
    });

  app.patch('/api/devices/:id', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: {
        type: 'object',
        properties: {
          siteId: { type: 'string', nullable: true }, location: { type: 'string' },
          credentialId: { type: 'string' }, monitorEnabled: { type: 'boolean' },
          rackName: { type: 'string' }, rackUnit: { type: 'integer', minimum: 1, maximum: 60, nullable: true },
          rackHeight: { type: 'integer', minimum: 1, maximum: 20 },
          notes: { type: 'string', maxLength: 5000 }
        }
      }
    }
  }, async (req) => {
    const { id } = req.params as any;
    const b = req.body as any;
    const me = req.user as any;
    // Build one atomic UPDATE from whichever fields were supplied.
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col}=$${params.length}`); };
    if (b.siteId !== undefined) add('site_id', b.siteId);
    if (b.location !== undefined) add('location', b.location);
    if (b.credentialId !== undefined) add('credential_id', b.credentialId);
    if (b.monitorEnabled !== undefined) add('monitor_enabled', b.monitorEnabled);
    if (b.rackName !== undefined) add('rack_name', b.rackName);
    if (b.rackUnit !== undefined) add('rack_unit', b.rackUnit);
    if (b.rackHeight !== undefined) add('rack_height', b.rackHeight);
    if (b.notes !== undefined) add('notes', b.notes);
    if (sets.length) {
      params.push(id);
      await query(`UPDATE devices SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
    }
    await audit(me.username, 'device.update', id, b, req.ip);
    return { ok: true };
  });

  app.delete('/api/devices/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['devices'] } },
    async (req) => {
      const me = req.user as any;
      const { id } = req.params as any;
      await query('DELETE FROM devices WHERE id=$1', [id]);
      await audit(me.username, 'device.delete', id, {}, req.ip);
      return { ok: true };
    });

  // Force a live refresh of inventory/ports/env/neighbors
  app.post('/api/devices/:id/refresh', { preHandler: requireRole('helpdesk'), schema: { tags: ['devices'] } },
    async (req) => {
      await refreshDevice((req.params as any).id);
      return getDevice((req.params as any).id);
    });

  // Re-pin the SSH host key after a legitimate re-image/replacement. Clears the
  // pinned fingerprint, then reconnects (best-effort) so the new key is pinned.
  app.post('/api/devices/:id/repin-host-key', { preHandler: requireRole('netadmin'), schema: { tags: ['devices'] } },
    async (req) => {
      const { id } = req.params as any;
      await getDevice(id); // 404 if the device doesn't exist
      await repinHostKey(id, (req.user as any).username);
      await refreshDevice(id).catch(() => { /* key is cleared; next connect re-pins */ });
      return getDevice(id);
    });

  // Reboot (reload) a device. Destructive — requires netadmin and explicit confirmation.
  app.post('/api/devices/:id/reboot', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['devices'],
      body: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'string' } } }
    }
  }, async (req, reply) => {
    const { id } = req.params as any;
    const { confirm } = req.body as any;
    const me = req.user as any;
    if (confirm !== 'REBOOT') return reply.code(400).send({ error: 'Send confirm="REBOOT" to proceed.' });
    const message = await rebootDevice(id);
    await audit(me.username, 'device.reboot', id, {}, req.ip);
    return { ok: true, message };
  });

  // Metric history for charts
  app.get('/api/devices/:id/metrics', {
    preHandler: requireRole('readonly'),
    schema: {
      tags: ['devices'],
      querystring: { type: 'object', properties: { hours: { type: 'integer', default: 24 } } }
    }
  }, async (req) => {
    const { id } = req.params as any;
    const hours = Math.min((req.query as any).hours ?? 24, 24 * 30);
    const { rows } = await query(
      `SELECT ts, cpu_pct, mem_pct, temperature_c FROM device_metrics
       WHERE device_id=$1 AND ts > now() - ($2 || ' hours')::interval ORDER BY ts`, [id, hours]);
    return rows;
  });
}
