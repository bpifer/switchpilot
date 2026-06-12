// Configuration compliance engine: evaluate each device's latest config backup
// against a set of rules, store pass/fail, and roll up a fleet score.
import { query } from '../db.js';
import { devicePushConfig } from './deviceComms.js';
import { backupDevice } from './configService.js';

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  match_type: 'line_present' | 'line_absent' | 'regex_present' | 'regex_absent';
  pattern: string;
  remediation: string;
  site_id: string | null;
  enabled: boolean;
}

/** Test one rule against a config. Returns { passed, detail }. */
export function evaluateRule(rule: ComplianceRule, configText: string): { passed: boolean; detail: string } {
  const lines = configText.split('\n');
  switch (rule.match_type) {
    case 'line_present': {
      const hit = lines.find(l => l.includes(rule.pattern));
      return hit
        ? { passed: true, detail: hit.trim() }
        : { passed: false, detail: `no line contains "${rule.pattern}"` };
    }
    case 'line_absent': {
      const hit = lines.find(l => l.includes(rule.pattern));
      return hit
        ? { passed: false, detail: `forbidden line present: ${hit.trim()}` }
        : { passed: true, detail: '' };
    }
    case 'regex_present':
    case 'regex_absent': {
      let re: RegExp;
      try { re = new RegExp(rule.pattern, 'm'); }
      catch { return { passed: false, detail: `invalid regex: ${rule.pattern}` }; }
      const matched = re.test(configText);
      if (rule.match_type === 'regex_present') {
        return matched ? { passed: true, detail: 'pattern matched' } : { passed: false, detail: `pattern /${rule.pattern}/ not found` };
      }
      return matched ? { passed: false, detail: `forbidden pattern /${rule.pattern}/ matched` } : { passed: true, detail: '' };
    }
    default:
      return { passed: false, detail: `unknown match_type ${rule.match_type}` };
  }
}

/** Latest backup config text for a device, or null if none exists yet. */
async function latestConfig(deviceId: string): Promise<string | null> {
  const { rows } = await query(
    `SELECT content FROM config_backups WHERE device_id=$1 ORDER BY created_at DESC LIMIT 1`, [deviceId]);
  return rows[0]?.content ?? null;
}

/** Evaluate all applicable rules for one device against its latest backup. */
export async function evaluateDevice(deviceId: string): Promise<{ evaluated: number; passed: number }> {
  const config = await latestConfig(deviceId);
  if (config === null) return { evaluated: 0, passed: 0 };

  const dev = await query('SELECT site_id FROM devices WHERE id=$1', [deviceId]);
  const siteId = dev.rows[0]?.site_id ?? null;

  // rules that apply to this device: global (site_id NULL) or matching its site
  const { rows: rules } = await query<ComplianceRule>(
    `SELECT * FROM compliance_rules WHERE enabled AND (site_id IS NULL OR site_id=$1)`, [siteId]);

  let passedCount = 0;
  for (const rule of rules) {
    const { passed, detail } = evaluateRule(rule, config);
    if (passed) passedCount++;
    await query(
      `INSERT INTO compliance_results (device_id, rule_id, passed, detail, checked_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (device_id, rule_id) DO UPDATE SET passed=$3, detail=$4, checked_at=now()`,
      [deviceId, rule.id, passed, detail.slice(0, 500)]);
  }
  // drop stale results for rules that no longer apply/exist
  await query(
    `DELETE FROM compliance_results r WHERE r.device_id=$1
       AND NOT EXISTS (SELECT 1 FROM compliance_rules cr
         WHERE cr.id=r.rule_id AND cr.enabled AND (cr.site_id IS NULL OR cr.site_id=$2))`,
    [deviceId, siteId]);

  return { evaluated: rules.length, passed: passedCount };
}

/** Evaluate every monitored device. Called by the scheduler. */
export async function evaluateAllCompliance(concurrency = 8): Promise<void> {
  const { rows } = await query('SELECT id FROM devices WHERE monitor_enabled');
  const queue = [...rows];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const d = queue.shift()!;
      await evaluateDevice(d.id).catch(err => console.warn(`compliance eval failed for ${d.id}: ${err.message}`));
    }
  });
  await Promise.all(workers);
}

/** Push a rule's remediation lines to a device, then re-evaluate it. */
export async function remediate(deviceId: string, ruleId: string, by: string): Promise<string> {
  const { rows } = await query<ComplianceRule>('SELECT * FROM compliance_rules WHERE id=$1', [ruleId]);
  const rule = rows[0];
  if (!rule) throw new Error('Rule not found');

  // {platform_host} lets the seeded syslog rule target this deployment
  const platformHost = (process.env.PLATFORM_URL ?? '').match(/^https?:\/\/([^:/]+)/)?.[1];
  let remediation = rule.remediation;
  if (remediation.includes('{platform_host}')) {
    if (!platformHost) throw new Error('Remediation uses {platform_host} but PLATFORM_URL is not set');
    remediation = remediation.replaceAll('{platform_host}', platformHost);
  }
  const lines = remediation.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Rule has no remediation configured');

  await backupDevice(deviceId, by, { reason: `pre-remediation: ${rule.name}` });
  const output = await devicePushConfig(deviceId, lines, true);
  // Evaluation reads the latest backup - take a fresh one so the re-evaluation
  // sees the change we just pushed instead of the pre-remediation snapshot.
  await backupDevice(deviceId, by, { reason: `post-remediation: ${rule.name}` });
  await evaluateDevice(deviceId);
  return output;
}
