import type { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { internalEvents } from '../events.js';

export default async function wsRoutes(app: FastifyInstance) {
  await app.register(websocketPlugin);

  app.get('/ws', { websocket: true }, (connection) => {
    const ws = connection.socket;
    const onAlert = (data: unknown) => {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({ type: 'alert', data }));
      }
    };

    internalEvents.on('alert', onAlert);
    ws.on('close', () => internalEvents.off('alert', onAlert));
    ws.on('error', () => internalEvents.off('alert', onAlert));
  });
}
