import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { config } from './config.js';
import { migrate, seedAdmin } from './db.js';
import { redis } from './redis.js';
import { startScheduler } from './scheduler.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import deviceRoutes from './routes/devices.js';
import portRoutes from './routes/ports.js';
import configRoutes from './routes/configs.js';
import templateRoutes from './routes/templates.js';
import jobRoutes from './routes/jobs.js';
import alertRoutes from './routes/alerts.js';
import topologyRoutes from './routes/topology.js';
import firmwareRoutes from './routes/firmware.js';
import analyticsRoutes from './routes/analytics.js';
import clientRoutes from './routes/clients.js';

async function main() {
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtExpires } });
  await app.register(multipart);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'SwitchPilot API',
        description: 'Cisco switch management platform — devices, ports, VLANs, configs, monitoring, alerting, firmware, automation, users.',
        version: '1.0.0'
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
      },
      security: [{ bearerAuth: [] }]
    }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/api/health', { schema: { tags: ['system'] } }, async () => ({
    status: 'ok',
    redis: redis.status,
    time: new Date().toISOString()
  }));

  // Dashboard summary
  app.get('/api/summary', { schema: { tags: ['system'] } }, async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
    const { query } = await import('./db.js');
    const [devices, alerts, jobs] = await Promise.all([
      query(`SELECT status, count(*)::int AS n FROM devices GROUP BY status`),
      query(`SELECT severity, count(*)::int AS n FROM alerts WHERE resolved_at IS NULL GROUP BY severity`),
      query(`SELECT status, count(*)::int AS n FROM jobs WHERE created_at > now() - interval '7 days' GROUP BY status`)
    ]);
    return {
      devices: Object.fromEntries(devices.rows.map(r => [r.status, r.n])),
      openAlerts: Object.fromEntries(alerts.rows.map(r => [r.severity, r.n])),
      recentJobs: Object.fromEntries(jobs.rows.map(r => [r.status, r.n]))
    };
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(deviceRoutes);
  await app.register(portRoutes);
  await app.register(configRoutes);
  await app.register(templateRoutes);
  await app.register(jobRoutes);
  await app.register(alertRoutes);
  await app.register(topologyRoutes);
  await app.register(firmwareRoutes);
  await app.register(analyticsRoutes);
  await app.register(clientRoutes);

  await migrate();
  await seedAdmin();
  await redis.connect().catch(err => app.log.warn(`redis unavailable: ${err.message}`));

  startScheduler();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`SwitchPilot API listening on :${config.port} — docs at /docs`);
}

main().catch(err => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
