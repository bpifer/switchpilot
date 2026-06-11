import { EventEmitter } from 'node:events';

// In-process event bus. Used by alertService → WebSocket handler.
// If you ever run multiple API replicas, swap this for Redis pub/sub.
export const internalEvents = new EventEmitter();
internalEvents.setMaxListeners(500);
