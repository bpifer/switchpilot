// Dry-run classifier for proposed config lines. Compares each line against the
// device's LIVE running config (a line-presence check, not a semantic diff) and
// flags lines that could cut connectivity or access. Shared by the generic
// /config/preview route and the per-port preview so structured edits (Ports tab)
// get the same before/apply safety net as a raw config push.
import { query } from '../db.js';
import { deviceExec, getDevice } from './deviceComms.js';
import { driverFor } from '../drivers/index.js';
import { expandInterfaceName } from '../cisco/parsers.js';

export interface PreviewLine { line: string; status: 'new' | 'present' | 'removes' | 'no-op' | 'context'; note: string; }
export interface ConfigPreview {
  lines: PreviewLine[];
  warnings: string[];
  summary: { new: number; present: number; removes: number };
}

/**
 * Pure classification: given the proposed lines, the device's running config,
 * and its management IP, return per-line status + connectivity guardrail
 * warnings. No I/O, so it's directly unit-testable.
 */
export function classifyConfigLines(lines: string[], runningConfig: string, mgmtIp: string): ConfigPreview {
  const runningLines = runningConfig.replace(/\r/g, '').split('\n');
  const running = new Set(runningLines.map(l => l.trim()).filter(Boolean));

  const result: PreviewLine[] = lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('!'))
    .map(line => {
      if (line.startsWith('no ')) {
        const positive = line.slice(3).trim();
        return running.has(positive)
          ? { line, status: 'removes' as const, note: 'currently configured - this removes it' }
          : { line, status: 'no-op' as const, note: 'nothing to remove - already absent' };
      }
      if (line.startsWith('interface ') || line === 'end' || line === 'exit') {
        return { line, status: 'context' as const, note: 'mode selector' };
      }
      return running.has(line)
        ? { line, status: 'present' as const, note: 'already in running config' }
        : { line, status: 'new' as const, note: 'will be added' };
    });

  // ----- Guardrails: flag lines that could cut connectivity or access -----
  // Learn which interfaces are trunks and which carries the management IP.
  const trunkIfaces = new Set<string>();
  let mgmtIface = '';
  let cur = '';
  for (const raw of runningLines) {
    const ifm = raw.match(/^interface (\S+)/);
    if (ifm) { cur = expandInterfaceName(ifm[1]); continue; }
    if (!cur) continue;
    if (/^\s*switchport mode trunk/.test(raw)) trunkIfaces.add(cur);
    if (mgmtIp && new RegExp(`ip address ${mgmtIp.replace(/\./g, '\\.')}\\b`).test(raw)) mgmtIface = cur;
    if (/^\S/.test(raw)) cur = '';   // a non-indented line ends the interface block
  }

  const warnings: string[] = [];
  let ctx = '';
  for (const { line } of result) {
    const ifm = line.match(/^interface (\S+)/i);
    if (ifm) { ctx = expandInterfaceName(ifm[1]); continue; }
    const onTrunk = trunkIfaces.has(ctx);
    const onMgmt = !!ctx && ctx === mgmtIface;
    if (/^shutdown\b/i.test(line)) {
      if (onMgmt) warnings.push(`"shutdown" on ${ctx} (the management interface) will likely cut your access to this switch.`);
      else if (onTrunk) warnings.push(`"shutdown" on ${ctx} (a trunk/uplink) may disconnect downstream devices.`);
    }
    if (onTrunk && /^switchport trunk allowed vlan (?!add|remove|none|all)/i.test(line)) {
      warnings.push(`On trunk ${ctx}: this REPLACES the allowed VLAN list - any VLAN not listed is removed from the uplink. Use "switchport trunk allowed vlan add ..." to extend instead.`);
    }
    if (onMgmt && /^no ip address/i.test(line)) {
      warnings.push(`"no ip address" on ${ctx} removes the management IP - you will lose access to this switch.`);
    }
    const noVlan = line.match(/^no vlan (\d+)/i);
    if (noVlan) warnings.push(`Deleting VLAN ${noVlan[1]} - access ports assigned to it lose connectivity.`);
    if (/^no username \S/i.test(line)) warnings.push(`${line} removes a login account - make sure another admin account remains.`);
  }

  return {
    lines: result,
    warnings,
    summary: {
      new: result.filter(r => r.status === 'new').length,
      present: result.filter(r => r.status === 'present').length,
      removes: result.filter(r => r.status === 'removes').length
    }
  };
}

/** Fetch the device's running config + management IP, then classify the lines. */
export async function previewConfigLines(deviceId: string, lines: string[]): Promise<ConfigPreview> {
  const out = await deviceExec(deviceId, [driverFor(await getDevice(deviceId)).configCommand]);
  const runningConfig = Object.values(out)[0] ?? '';
  const devRow = await query<{ ip: string }>('SELECT host(mgmt_ip) AS ip FROM devices WHERE id=$1', [deviceId]);
  return classifyConfigLines(lines, runningConfig, devRow.rows[0]?.ip ?? '');
}
