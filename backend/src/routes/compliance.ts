import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { evaluateAllCompliance, evaluateDevice, remediate } from '../services/complianceService.js';

export default async function complianceRoutes(app: FastifyInstance) {
  // ----- Rules CRUD -----
  app.get('/api/compliance/rules', { preHandler: requireRole('readonly'), schema: { tags: ['compliance'] } },
    async () => {
      const { rows } = await query(
        `SELECT cr.*, s.name AS site_name FROM compliance_rules cr
         LEFT JOIN sites s ON s.id=cr.site_id ORDER BY cr.severity DESC, cr.name`);
      return rows;
    });

  app.post('/api/compliance/rules', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['compliance'],
      body: {
        type: 'object', required: ['name', 'match_type', 'pattern'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          match_type: { type: 'string', enum: ['line_present', 'line_absent', 'regex_present', 'regex_absent'] },
          pattern: { type: 'string' },
          remediation: { type: 'string' },
          siteId: { type: ['string', 'null'] },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (req, reply) => {
    const me = req.user as any;
    const b = req.body as any;
    const { rows } = await query(
      `INSERT INTO compliance_rules (name, description, severity, match_type, pattern, remediation, site_id, enabled, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [b.name, b.description ?? '', b.severity ?? 'warning', b.match_type, b.pattern,
       b.remediation ?? '', b.siteId || null, b.enabled ?? true, me.username]);
    await audit(me.username, 'compliance.rule.create', rows[0].id, { name: b.name }, req.ip);
    return reply.code(201).send({ id: rows[0].id });
  });

  app.put('/api/compliance/rules/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['compliance'] } },
    async (req) => {
      const me = req.user as any;
      const { id } = req.params as any;
      const b = req.body as any;
      await query(
        `UPDATE compliance_rules SET
           name=COALESCE($2,name), description=COALESCE($3,description),
           severity=COALESCE($4,severity), match_type=COALESCE($5,match_type),
           pattern=COALESCE($6,pattern), remediation=COALESCE($7,remediation),
           site_id=$8, enabled=COALESCE($9,enabled)
         WHERE id=$1`,
        [id, b.name ?? null, b.description ?? null, b.severity ?? null, b.match_type ?? null,
         b.pattern ?? null, b.remediation ?? null, b.siteId || null, b.enabled ?? null]);
      await audit(me.username, 'compliance.rule.update', id, {}, req.ip);
      return { ok: true };
    });

  app.delete('/api/compliance/rules/:id', { preHandler: requireRole('netadmin'), schema: { tags: ['compliance'] } },
    async (req) => {
      const me = req.user as any;
      const { id } = req.params as any;
      await query('DELETE FROM compliance_rules WHERE id=$1', [id]);
      await audit(me.username, 'compliance.rule.delete', id, {}, req.ip);
      return { ok: true };
    });

  // ----- Evaluation -----
  app.post('/api/compliance/evaluate', {
    preHandler: requireRole('helpdesk'),
    schema: { tags: ['compliance'], querystring: { type: 'object', properties: { deviceId: { type: 'string' } } } }
  }, async (req) => {
    const { deviceId } = req.query as any;
    if (deviceId) return evaluateDevice(deviceId);
    await evaluateAllCompliance();
    return { ok: true };
  });

  // ----- Fleet summary: overall score, per-rule rollup, per-device rollup -----
  app.get('/api/compliance/summary', { preHandler: requireRole('readonly'), schema: { tags: ['compliance'] } },
    async () => {
      const overall = await query(
        `SELECT count(*) FILTER (WHERE passed)::int AS passed, count(*)::int AS total FROM compliance_results`);
      const perRule = await query(
        `SELECT cr.id, cr.name, cr.severity, cr.match_type, cr.pattern,
                count(r.*) FILTER (WHERE r.passed)::int AS passed,
                count(r.*)::int AS total
         FROM compliance_rules cr
         LEFT JOIN compliance_results r ON r.rule_id=cr.id
         WHERE cr.enabled
         GROUP BY cr.id ORDER BY (count(r.*) FILTER (WHERE NOT r.passed)) DESC, cr.severity DESC, cr.name`);
      const perDevice = await query(
        `SELECT d.id, d.hostname, d.mgmt_ip, s.name AS site_name,
                count(r.*) FILTER (WHERE r.passed)::int AS passed,
                count(r.*)::int AS total,
                count(r.*) FILTER (WHERE NOT r.passed AND cr.severity='critical')::int AS critical_fails
         FROM devices d
         LEFT JOIN compliance_results r ON r.device_id=d.id
         LEFT JOIN compliance_rules cr ON cr.id=r.rule_id
         LEFT JOIN sites s ON s.id=d.site_id
         GROUP BY d.id, s.name
         HAVING count(r.*) > 0
         ORDER BY critical_fails DESC, (count(r.*) FILTER (WHERE NOT r.passed)) DESC`);
      const o = overall.rows[0];
      return {
        score: o.total ? Math.round(o.passed / o.total * 100) : null,
        passed: o.passed, total: o.total,
        rules: perRule.rows, devices: perDevice.rows
      };
    });

  // ----- Per-device rule results -----
  app.get('/api/compliance/device/:id', { preHandler: requireRole('readonly'), schema: { tags: ['compliance'] } },
    async (req) => {
      const { id } = req.params as any;
      const { rows } = await query(
        `SELECT cr.id AS rule_id, cr.name, cr.description, cr.severity, cr.remediation,
                r.passed, r.detail, r.checked_at
         FROM compliance_rules cr
         LEFT JOIN compliance_results r ON r.rule_id=cr.id AND r.device_id=$1
         WHERE cr.enabled ORDER BY r.passed NULLS FIRST, cr.severity DESC, cr.name`, [id]);
      return rows;
    });

  // ----- Remediate: push a rule's fix lines to a device -----
  app.post('/api/compliance/remediate', {
    preHandler: requireRole('netadmin'),
    schema: {
      tags: ['compliance'],
      body: {
        type: 'object', required: ['deviceId', 'ruleId'],
        properties: { deviceId: { type: 'string' }, ruleId: { type: 'string' } }
      }
    }
  }, async (req, reply) => {
    const me = req.user as any;
    const { deviceId, ruleId } = req.body as any;
    try {
      const output = await remediate(deviceId, ruleId, me.username);
      await audit(me.username, 'compliance.remediate', deviceId, { ruleId }, req.ip);
      return { ok: true, output };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
