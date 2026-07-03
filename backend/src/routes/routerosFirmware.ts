import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/rbac.js';
import {
  getRouterosFirmware, downloadRouterosPackage, stageRouterboardUpgrade, rebootRouterosDevice,
} from '../services/routerosFirmware.js';

export default async function routerosFirmwareRoutes(app: FastifyInstance) {
  // Read both firmware layers (RouterOS package + RouterBOARD bootloader).
  app.get('/api/devices/:id/routeros-firmware', { preHandler: requireRole('readonly'), schema: { tags: ['firmware'] } },
    async (req) => getRouterosFirmware((req.params as any).id));

  // Download the newest RouterOS package for the channel (staged, no reboot).
  app.post('/api/devices/:id/routeros-firmware/download', { preHandler: requireRole('netadmin'), schema: { tags: ['firmware'] } },
    async (req) => {
      const me = req.user as any;
      const output = await downloadRouterosPackage((req.params as any).id, me.username, req.ip);
      return { ok: true, output };
    });

  // Stage the bundled RouterBOARD bootloader-firmware upgrade (no reboot).
  app.post('/api/devices/:id/routeros-firmware/routerboard-upgrade', { preHandler: requireRole('netadmin'), schema: { tags: ['firmware'] } },
    async (req) => {
      const me = req.user as any;
      const output = await stageRouterboardUpgrade((req.params as any).id, me.username, req.ip);
      return { ok: true, output };
    });

  // Reboot to APPLY staged upgrades. Disruptive - requires an explicit confirm.
  app.post('/api/devices/:id/routeros-firmware/reboot', {
    preHandler: requireRole('netadmin'),
    schema: { tags: ['firmware'], body: { type: 'object', properties: { confirm: { type: 'string' } } } },
  }, async (req, reply) => {
    const me = req.user as any;
    if ((req.body as any)?.confirm !== 'REBOOT') {
      return reply.code(400).send({ error: 'Reboot not confirmed. Send confirm="REBOOT".' });
    }
    await rebootRouterosDevice((req.params as any).id, me.username, req.ip);
    return { ok: true, rebooting: true };
  });
}
