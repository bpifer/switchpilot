import type { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { onEvent } from '../redis.js';

export default async function wsRoutes(app: FastifyInstance) {
  await app.register(websocketPlugin);

  app.get('/ws', { websocket: true }, (connection) => {
    const ws = connection.socket;
    // publishEvent serialises events to JSON before publishing; relay the raw JSON string directly.
    const unsub = onEvent(json => {
      if (ws.readyState === 1 /* OPEN */) ws.send(json);
    });
    ws.on('close', unsub);
    ws.on('error', unsub);
  });
}
