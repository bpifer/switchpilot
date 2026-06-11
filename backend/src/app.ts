// Builds the Fastify application (plugins, routes, schema migration) WITHOUT
// starting background services or listening — so tests can drive it via
// `app.inject(...)`. index.ts wraps this with redis/scheduler/leader + listen.
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { config } from './config.js';
import { migrate, seedAdmin, query } from './db.js';
import { redis } from './redis.js';
import { registry, refreshGauges, httpDuration } from './metrics.js';

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
import maintenanceRoutes from './routes/maintenance.js';
import discoveryRoutes from './routes/discovery.js';
import locateRoutes from './routes/locate.js';
import poeRoutes from './routes/poe.js';
import campaignRoutes from './routes/campaigns.js';
import lifecycleRoutes from './routes/lifecycle.js';
import complianceRoutes from './routes/compliance.js';
import securityRoutes from './routes/security.js';
import wsRoutes from './routes/ws.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

  // Refuse to run in production with the built-in development secrets.
  if (config.nodeEnv === 'production') {
    if (config.jwtSecret === 'dev-only-secret') throw new Error('JWT_SECRET must be set in production');
    if (config.credentialKey === '00'.repeat(32)) throw new Error('CREDENTIAL_KEY must be set in production');
  }

  // Security headers. CSP is disabled here because the API serves JSON + the
  // Swagger UI (which uses inline scripts); the SPA is served by its own nginx.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.allowedOrigins ?? true,   // explicit list in prod; reflect any origin in dev
    credentials: true
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtExpires } });
  await app.register(multipart);

  if (config.enableDocs) {
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
  }

  // Record request latency by method/route/status for Prometheus.
  app.addHook('onResponse', async (req, reply) => {
    const route = (req as any).routeOptions?.url ?? req.url;
    httpDuration.observe(
      { method: req.method, route, status: String(reply.statusCode) },
      reply.elapsedTime / 1000
    );
  });

  // Prometheus scrape endpoint (unauthenticated by convention — restrict at the
  // network layer; it exposes only aggregate counts, no device/credential data).
  app.get('/metrics', { schema: { hide: true } }, async (_req, reply) => {
    await refreshGauges();
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  app.get('/api/health', { schema: { tags: ['system'] } }, async (_req, reply) => {
    let db = 'ok';
    try { await query('SELECT 1'); } catch { db = 'down'; }
    const status = db === 'ok' ? 'ok' : 'degraded';
    return reply.code(status === 'ok' ? 200 : 503).send({
      status, db, redis: redis.status, time: new Date().toISOString()
    });
  });

  app.get('/api/summary', { schema: { tags: ['system'] } }, async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Authentication required' }); }
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
  await app.register(maintenanceRoutes);
  await app.register(discoveryRoutes);
  await app.register(locateRoutes);
  await app.register(poeRoutes);
  await app.register(campaignRoutes);
  await app.register(lifecycleRoutes);
  await app.register(complianceRoutes);
  await app.register(securityRoutes);
  await app.register(wsRoutes);

  await migrate();
  await seedAdmin();

  return app;
}
