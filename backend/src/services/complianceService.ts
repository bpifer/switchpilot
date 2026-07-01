// Configuration compliance engine: evaluate each device's latest config backup
// against a set of rules, store pass/fail, and roll up a fleet score.
import { query } from '../db.js';
import { devicePushConfig } from './deviceComms.js';
import { backupDevice } from './configService.js';
import { previewConfigLines } from './configPreview.js';
import { forEachLimit } from '../util/concurrency.js';

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
      const matches = lines.filter(l => { try { return re.test(l); } catch { return false; } });
      const matched = matches.length > 0 || re.test(configText);
      if (rule.match_type === 'regex_present') {
        if (matched) return { passed: true, detail: matches[0]?.trim() || 'pattern matched' };
        // Help diagnosis: show config lines that look related (share a keyword)
        const keyword = (rule.pattern.match(/[a-z][a-z-]{2,}/i)?.[0] ?? '').toLowerCase();
        const near = keyword
          ? lines.filter(l => l.toLowerCase().includes(keyword)).slice(0, 3).map(l => l.trim())
          : [];
        return {
          passed: false,
          detail: near.length
            ? `pattern not found. related lines on device:\n${near.join('\n')}`
            : `pattern /${rule.pattern}/ not found - nothing related is configured`
        };
      }
      return matched
        ? { passed: false, detail: `forbidden lines present:\n${matches.slice(0, 3).map(l => l.trim()).join('\n')}` }
        : { passed: true, detail: '' };
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

  const dev = await query('SELECT site_id, vendor FROM devices WHERE id=$1', [deviceId]);
  const siteId = dev.rows[0]?.site_id ?? null;
  const vendor = dev.rows[0]?.vendor ?? 'cisco';

  // rules that apply: enabled, this vendor, and global or matching the site
  const { rows: rules } = await query<ComplianceRule>(
    `SELECT * FROM compliance_rules WHERE enabled AND vendor=$2 AND (site_id IS NULL OR site_id=$1)`,
    [siteId, vendor]);

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
         WHERE cr.id=r.rule_id AND cr.enabled AND cr.vendor=$3 AND (cr.site_id IS NULL OR cr.site_id=$2))`,
    [deviceId, siteId, vendor]);

  return { evaluated: rules.length, passed: passedCount };
}

/** Evaluate every monitored device. Called by the scheduler. */
export async function evaluateAllCompliance(concurrency = 8): Promise<void> {
  const { rows } = await query<{ id: string }>('SELECT id FROM devices WHERE monitor_enabled');
  await forEachLimit(rows, concurrency, d => evaluateDevice(d.id).then(() => {}),
    (d, err) => console.warn(`compliance eval failed for ${d.id}: ${err.message}`));
}

/** Resolve a rule's remediation template into pushable config lines.
 *  Pure apart from the PLATFORM_URL env read; exported for tests. */
export function buildRemediationLines(rule: Pick<ComplianceRule, 'remediation'>): string[] {
  // {platform_host} lets the seeded syslog rule target this deployment
  const platformHost = (process.env.PLATFORM_URL ?? '').match(/^https?:\/\/([^:/]+)/)?.[1];
  let remediation = rule.remediation;
  if (remediation.includes('{platform_host}')) {
    if (!platformHost) throw new Error('Remediation uses {platform_host} but PLATFORM_URL is not set');
    remediation = remediation.replaceAll('{platform_host}', platformHost);
  }
  const lines = remediation.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Rule has no remediation configured');
  return lines;
}

async function ruleById(ruleId: string): Promise<ComplianceRule> {
  const { rows } = await query<ComplianceRule>('SELECT * FROM compliance_rules WHERE id=$1', [ruleId]);
  if (!rows[0]) throw new Error('Rule not found');
  return rows[0];
}

/** Dry run: classify a rule's remediation lines against the device's live
 *  running config without pushing anything. */
export async function remediatePreview(deviceId: string, ruleId: string) {
  const rule = await ruleById(ruleId);
  const preview = await previewConfigLines(deviceId, buildRemediationLines(rule));
  return { rule: rule.name, ...preview };
}

/** Push a rule's remediation lines to a device, then re-evaluate it. */
export async function remediate(deviceId: string, ruleId: string, by: string): Promise<string> {
  const rule = await ruleById(ruleId);
  const lines = buildRemediationLines(rule);

  await backupDevice(deviceId, by, { reason: `pre-remediation: ${rule.name}` });
  const output = await devicePushConfig(deviceId, lines, true);
  // Evaluation reads the latest backup - take a fresh one so the re-evaluation
  // sees the change we just pushed instead of the pre-remediation snapshot.
  await backupDevice(deviceId, by, { reason: `post-remediation: ${rule.name}` });
  await evaluateDevice(deviceId);
  return output;
}
