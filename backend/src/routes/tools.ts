import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { getDevice, runDeviceTool } from '../services/deviceComms.js';
import { driverFor } from '../drivers/index.js';

// Charset guard at the HTTP edge: mirrors drivers/types TOOL_TARGET_RE. Blocks
// whitespace and every CLI metacharacter, so a target can never inject extra
// IOS/RouterOS commands. Per-tool semantic checks (host vs CIDR) run below, and
// the driver re-guards before interpolating - belt and suspenders.
const TOOL_TARGET_PATTERN = '^[A-Za-z0-9._:/-]{1,64}$';

export default async function toolRoutes(app: FastifyInstance) {
  // Which diagnostic tools this device's vendor supports (drives the UI).
  app.get('/api/devices/:id/tools', { preHandler: requireRole('readonly'), schema: { tags: ['tools'] } },
    async (req) => {
      const device = await getDevice((req.params as any).id);
      // Vendors with no CLI driver (Aruba Instant On, SNMP-only) support no
      // device-side tools; an empty list renders as such instead of a 501.
      try { return { tools: driverFor(device).tools }; }
      catch { return { tools: [] }; }
    });

  // Run a diagnostic tool against a target and return the raw device output.
  app.post('/api/devices/:id/tools/:tool', {
    preHandler: requireRole('helpdesk'),
    schema: {
      tags: ['tools'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tool: { type: 'string', enum: ['ping', 'traceroute', 'ip-scan'] }
        }
      },
      body: {
        type: 'object',
        required: ['target'],
        properties: {
          target: { type: 'string', pattern: TOOL_TARGET_PATTERN },
          count: { type: 'integer', minimum: 1, maximum: 10, default: 5 }
        }
      }
    }
  }, async (req) => {
    const { id, tool } = req.params as any;
    const { target, count = 5 } = req.body as any;
    const me = req.user as any;

    // Semantic guard beyond the charset: ip-scan wants an IPv4 address/CIDR;
    // ping/traceroute want a single host or IP (a CIDR is meaningless there).
    if (tool === 'ip-scan') {
      if (!/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(target)) {
        throw Object.assign(new Error('ip-scan target must be an IPv4 address or CIDR (e.g. 192.168.1.0/24)'), { statusCode: 400 });
      }
    } else if (target.includes('/')) {
      throw Object.assign(new Error(`${tool} target must be a host or IP, not a CIDR`), { statusCode: 400 });
    }

    const output = await runDeviceTool(id, tool, { target, count });
    await audit(me.username, `device.tool.${tool}`, id, { target, count }, req.ip);
    return { tool, target, output };
  });
}
