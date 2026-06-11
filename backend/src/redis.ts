import { Redis } from 'ioredis';
import { config } from './config.js';

// Main client for regular commands (get/set/hset/publish/etc.)
export const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });

// The Redis protocol requires a dedicated connection once a client enters
// subscribe mode — it can no longer send regular commands on that connection.
let subscriber: Redis | null = null;
const listeners = new Set<(json: string) => void>();

/** Publish a typed event to all connected API instances. */
export async function publishEvent(event: Record<string, unknown>): Promise<void> {
  await redis.publish('switchpilot:events', JSON.stringify(event)).catch(() => { /* redis unavailable */ });
}

/** Register a callback invoked with the raw JSON string for each incoming event.
 *  Returns an unsubscribe function — call it when the listener is no longer needed. */
export function onEvent(fn: (json: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Initialise the pub/sub subscriber connection.  Call once at startup after redis.connect(). */
export async function initPubSub(): Promise<void> {
  // maxRetriesPerRequest: null — ioredis retries indefinitely; pub/sub connections must stay alive.
  subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  subscriber.on('error', err => console.warn(`[redis/sub] ${err.message}`));
  await subscriber.subscribe('switchpilot:events');
  // ioredis auto-resubscribes after reconnect, so we set the message handler once.
  subscriber.on('message', (_ch, msg) => listeners.forEach(fn => fn(msg)));
}

/** Cache helper: JSON get-or-compute with TTL. */
export async function cached<T>(key: string, ttlSec: number, compute: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch { /* cache unavailable — fall through to compute */ }
  const value = await compute();
  try { await redis.set(key, JSON.stringify(value), 'EX', ttlSec); } catch { /* best-effort */ }
  return value;
}
