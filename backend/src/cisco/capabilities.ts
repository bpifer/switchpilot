import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const capDb = require('./capabilities.json') as CapabilityDatabase;

export interface FamilyDef {
  label: string;
  modelPatterns: string[];
  os: 'ios' | 'iosxe';
  capabilities: Record<string, unknown>;
  commands: Record<string, string>;
}

export interface CapabilityDatabase {
  families: Record<string, FamilyDef>;
}

export function listFamilies(): Record<string, FamilyDef> {
  return capDb.families;
}

/** Match a model string (e.g. "WS-C2960X-48FPD-L", "C9300-48P") to a family key. */
export function familyForModel(model: string): string | null {
  for (const [key, def] of Object.entries(capDb.families)) {
    if (def.modelPatterns.some(p => new RegExp(p, 'i').test(model.trim()))) return key;
  }
  return null;
}

/**
 * Resolve effective capabilities for a specific model + IOS version.
 * "model"-conditional capabilities (PoE, stacking, dual PSU) are resolved
 * from model suffixes: P/FP/LP => PoE; 2960X/XR & 3750 => stackable.
 */
export function resolveCapabilities(model: string, iosVersion: string): Record<string, unknown> {
  const familyKey = familyForModel(model);
  if (!familyKey) return { family: null, os: 'ios' };
  const def = capDb.families[familyKey];
  const caps: Record<string, unknown> = { ...def.capabilities, family: familyKey, os: def.os };

  const m = model.toUpperCase();
  if (caps.poe === 'model') {
    caps.poe = /(\d+(FP|LP|P|PD|FPD|FPS|PS)\b|-P\b|PWR)/.test(m) || /-(24|48)(P|FP|LP|U|UX|UN|H)/.test(m);
  }
  if (caps.stacking === 'model') {
    caps.stacking = /2960(X|XR|S)/.test(m);
  }
  if (caps.dual_psu === 'model') {
    caps.dual_psu = /(XR|9\d{3})/.test(m);
  }
  // RESTCONF requires IOS-XE 16.6+
  if (caps.restconf) {
    const major = parseInt(iosVersion.split('.')[0] ?? '0', 10);
    const minor = parseInt(iosVersion.split('.')[1] ?? '0', 10);
    caps.restconf = major > 16 || (major === 16 && minor >= 6);
    caps.netconf = caps.restconf;
  }
  return caps;
}

export function commandsForFamily(familyKey: string): Record<string, string> {
  return capDb.families[familyKey]?.commands ?? {};
}
