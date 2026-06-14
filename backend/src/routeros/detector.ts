// RouterOS identity detection from `print` output. Produces a result shaped
// like the Cisco DetectionResult so onboarding can consume both uniformly.
// vendor: mikrotik.
import { parseResource, parseRouterboard, parseIdentity } from './parsers.js';
import { resolveRosCapabilities } from './capabilities.js';

export interface RouterOsDetection {
  vendor: 'mikrotik';
  hostname: string;
  model: string;
  serial: string;
  version: string;          // RouterOS version, e.g. "7.12.1"
  uptimeSeconds: number;
  capabilities: Record<string, unknown>;
}

/** A device is RouterOS when `/system resource print` reports platform MikroTik. */
export function isRouterOs(resourceOutput: string): boolean {
  return parseResource(resourceOutput).platform.toLowerCase() === 'mikrotik';
}

/** "1w2d3h4m5s" / "12m8s" -> seconds. */
export function parseUptime(s: string): number {
  let total = 0;
  const re = /(\d+)([wdhms])/g;
  const mult: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) total += Number(m[1]) * (mult[m[2]] ?? 0);
  return total;
}

export function detectRouterOs(out: {
  resource: string;
  routerboard?: string;
  identity?: string;
}): RouterOsDetection {
  const res = parseResource(out.resource);
  const rb = out.routerboard ? parseRouterboard(out.routerboard) : null;
  const model = rb?.model || res.boardName;
  return {
    vendor: 'mikrotik',
    hostname: out.identity ? parseIdentity(out.identity) : '',
    model,
    serial: rb?.serialNumber ?? '',
    version: res.version,
    uptimeSeconds: parseUptime(res.uptime),
    capabilities: resolveRosCapabilities(model),
  };
}
