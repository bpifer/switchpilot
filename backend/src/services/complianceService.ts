// Configuration compliance engine: evaluate each device's latest config backup
// against a set of rules, store pass/fail, and roll up a fleet score.
import { query } from '../db.js';
import { config } from '../config.js';
import { audit, redactForAudit } from '../audit.js';
import { devicePushConfig } from './deviceComms.js';
import { backupDevice } from './configService.js';
import { previewConfigLines } from './configPreview.js';
import { inMaintenanceWindow } from './alertService.js';
import { runAutomationTrigger } from './automationService.js';
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
  // A `no <feature>` line is an explicit negation, not the affirmative config,
  // so it must not satisfy a line_present/line_absent check for `<feature>`
  // (e.g. `no aaa new-model` is AAA DISABLED, not enabled). Skip `no `-prefixed
  // lines unless the rule pattern itself is a negation.
  const patternNegates = /^\s*no\s/.test(rule.pattern);
  const affirmativelyContains = (l: string) =>
    l.includes(rule.pattern) && (patternNegates || !/^\s*no\s+/.test(l));
  switch (rule.match_type) {
    case 'line_present': {
      const hit = lines.find(affirmativelyContains);
      return hit
        ? { passed: true, detail: hit.trim() }
        : { passed: false, detail: `no line contains "${rule.pattern}"` };
    }
    case 'line_absent': {
      const hit = lines.find(affirmativelyContains);
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

  // Prior pass/fail per rule, so the compliance_fail automation trigger fires
  // only on a real pass->fail transition — not for every failing rule on the
  // first-ever evaluation (which would storm on setup).
  const { rows: prior } = await query<{ rule_id: string; passed: boolean }>(
    'SELECT rule_id, passed FROM compliance_results WHERE device_id=$1', [deviceId]);
  const wasPassing = new Map(prior.map(p => [p.rule_id, p.passed]));

  let passedCount = 0;
  for (const rule of rules) {
    const { passed, detail } = evaluateRule(rule, config);
    if (passed) passedCount++;
    if (!passed && wasPassing.get(rule.id) === true) {
      await runAutomationTrigger('compliance_fail',
        { deviceId, rule: rule.name, ruleId: rule.id, severity: rule.severity }).catch(() => {});
    }
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

/** Evaluate every monitored device. Called by the scheduler.
 *  `fresh` pulls a running-config backup per device before evaluating, so the
 *  score reflects the live device instead of the last (possibly day-old)
 *  backup. backupDevice dedupes on a normalized hash, so an unchanged config
 *  is just one SSH read - no new row and no git commit. Offline devices are
 *  skipped so a fresh sweep doesn't stall on unreachable gear. */
export async function evaluateAllCompliance(
  opts: { fresh?: boolean; concurrency?: number } = {}
): Promise<void> {
  const { rows } = await query<{ id: string; status: string }>(
    'SELECT id, status FROM devices WHERE monitor_enabled');
  await forEachLimit(rows, opts.concurrency ?? 8, async d => {
    if (opts.fresh && d.status !== 'offline') {
      await backupDevice(d.id, 'compliance-scheduler', { reason: 'scheduled compliance evaluation' });
    }
    await evaluateDevice(d.id);
    // Opt-in scheduled auto-remediation for online devices (never offline: we
    // can't push, and stale results shouldn't drive changes).
    if (d.status !== 'offline') await autoRemediateDevice(d.id);
  }, (d, err) => console.warn(`compliance eval failed for ${d.id}: ${err.message}`));
}

/** Push remediation for any FAILED rule on a device that is flagged
 *  `auto_remediate`, gated by three deliberate safeguards: the global master
 *  switch (COMPLIANCE_AUTO_REMEDIATE), the per-rule flag, and maintenance-window
 *  suppression (never touch a device someone is actively working on). Each push
 *  is audited. A per-rule failure is logged and skipped, not fatal. */
export async function autoRemediateDevice(deviceId: string): Promise<void> {
  if (!config.poll.complianceAutoRemediate) return;
  const { rows } = await query<{ rule_id: string; name: string }>(
    `SELECT cr.id AS rule_id, cr.name
       FROM compliance_results r JOIN compliance_rules cr ON cr.id = r.rule_id
      WHERE r.device_id = $1 AND r.passed = false
        AND cr.enabled AND cr.auto_remediate AND COALESCE(cr.remediation, '') <> ''`,
    [deviceId]);
  if (!rows.length) return;
  // Suppressed by a maintenance window: audit the skip so an operator can see
  // WHY a failing rule wasn't fixed (otherwise the sweep is silently inert).
  // Only audited when there was actually something to remediate, so quiet
  // devices don't spam the log on every sweep.
  if (await inMaintenanceWindow(deviceId)) {
    await audit('compliance-auto-remediate', 'compliance.auto_remediate.skipped', deviceId,
      { reason: 'maintenance window', rules: rows.map(r => r.name) }).catch(() => {});
    return;
  }
  for (const r of rows) {
    try {
      const output = await remediate(deviceId, r.rule_id, 'compliance-auto-remediate');
      await audit('compliance-auto-remediate', 'compliance.auto_remediate', deviceId,
        { rule: r.name, ruleId: r.rule_id, output: redactForAudit(output) });
    } catch (err) {
      console.warn(`auto-remediate failed for ${deviceId} rule "${r.name}": ${(err as Error).message}`);
    }
  }
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
