import type { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { internalEvents } from '../events.js';

export default async function wsRoutes(app: FastifyInstance) {
  await app.register(websocketPlugin);

  app.get('/ws', { websocket: true }, (socket) => {
    const onAlert = (data: unknown) => {
      if (socket.readyState === 1 /* OPEN */) {
        socket.send(JSON.stringify({ type: 'alert', data }));
      }
    };

    internalEvents.on('alert', onAlert);
    socket.on('close', () => internalEvents.off('alert', onAlert));
    socket.on('error', () => internalEvents.off('alert', onAlert));
  });
}
