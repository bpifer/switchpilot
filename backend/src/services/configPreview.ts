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

/**
 * Vendor-aware management-plane self-lockout check: flags pushed lines that would
 * cut the platform's own SSH/management access (disabling SSH, an inbound VTY
 * ACL, resetting the device, dropping management in the firewall). Complements
 * the interface-level guardrails in classifyConfigLines (which are IOS-syntax and
 * cover the management *interface*). Pure; exported for tests. This is the
 * self-lockout guard half of commit-confirm - surfaced in the preview today.
 */
export function detectMgmtLockout(lines: string[], vendor: string): string[] {
  const warnings: string[] = [];
  const clean = lines.map(l => l.trim()).filter(l => l && !l.startsWith('!') && !l.startsWith('#'));

  if (vendor === 'mikrotik') {
    for (const line of clean) {
      const l = line.toLowerCase();
      if (/\/system[\s/]+reset/.test(l)) {
        warnings.push(`"${line}" resets the device to defaults - total loss of configuration and access.`);
      } else if (/\/ip[\s/]+service/.test(l) && /\b(ssh|api)\b/.test(l) && /\bdisable\b|disabled=yes/.test(l)) {
        warnings.push(`"${line}" disables an SSH/API management service - the platform connects over it and would lose access.`);
      } else if (/\/ip[\s/]+firewall[\s/]+filter/.test(l) && /chain=input/.test(l) && /action=(drop|reject)/.test(l)) {
        warnings.push(`"${line}" adds an input drop/reject firewall rule - if it matches the platform's source, management is blocked.`);
      } else if (/\/user[\s/]+(remove|disable)/.test(l)) {
        warnings.push(`"${line}" removes or disables a user account - make sure another admin login remains.`);
      }
    }
    return warnings;
  }

  // Cisco (default): track line-vty context for the transport / access-class checks.
  let inVty = false;
  for (const line of clean) {
    const l = line.toLowerCase();
    if (/^line\b/.test(l)) { inVty = /^line vty\b/.test(l); continue; }
    if (/^interface\b/.test(l) || l === 'exit' || l === 'end') { inVty = false; continue; }
    if (/^no ip ssh\b/.test(l) || /^crypto key zeroize rsa\b/.test(l)) {
      warnings.push(`"${line}" disables SSH - the platform connects over SSH and would lose access to this switch.`);
    } else if (inVty && /^no transport input.*\bssh\b/.test(l)) {
      warnings.push(`"${line}" removes SSH from the VTY transport - the platform would lose access.`);
    } else if (inVty && /^transport input\b/.test(l) && !/\bssh\b/.test(l) && !/\ball\b/.test(l)) {
      warnings.push(`"${line}" sets a VTY transport that excludes SSH - the platform would lose access.`);
    } else if (inVty && /^access-class \S+ in\b/.test(l)) {
      warnings.push(`"${line}" applies an inbound ACL to the VTYs - if it does not permit the platform's IP, SSH is blocked.`);
    }
  }
  return warnings;
}

/** Fetch the device's running config + management IP, then classify the lines. */
export async function previewConfigLines(deviceId: string, lines: string[]): Promise<ConfigPreview> {
  const device = await getDevice(deviceId);
  const driver = driverFor(device);
  const out = await deviceExec(deviceId, [driver.configCommand]);
  const runningConfig = Object.values(out)[0] ?? '';
  const devRow = await query<{ ip: string }>('SELECT host(mgmt_ip) AS ip FROM devices WHERE id=$1', [deviceId]);
  const preview = classifyConfigLines(lines, runningConfig, devRow.rows[0]?.ip ?? '');
  preview.warnings.push(...detectMgmtLockout(lines, driver.vendor));
  return preview;
}
