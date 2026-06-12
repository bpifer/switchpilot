import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { onEvent } from '../redis.js';

export default async function wsRoutes(app: FastifyInstance) {
  await app.register(websocketPlugin);

  // Browsers can't set an Authorization header on a WebSocket, so the client
  // passes a token as ?token=. Only the 30-second single-purpose nonce from
  // POST /api/auth/ws-token is accepted (ws claim required) - the session JWT
  // itself never appears in a URL or in proxy access logs.
  const authenticate = async (req: FastifyRequest, reply: any) => {
    const token = (req.query as any)?.token;
    try {
      if (!token) throw new Error('missing token');
      const claims = app.jwt.verify<{ ws?: boolean }>(token);
      if (!claims.ws) throw new Error('not a ws token');
    } catch {
      return reply.code(401).send({ error: 'Authentication required' });
    }
  };

  app.get('/ws', { websocket: true, preHandler: authenticate }, (connection) => {
    const ws = connection.socket;
    // publishEvent serialises events to JSON before publishing; relay the raw JSON string directly.
    const unsub = onEvent(json => {
      if (ws.readyState === 1 /* OPEN */) ws.send(json);
    });
    ws.on('close', unsub);
    ws.on('error', unsub);
  });
}
