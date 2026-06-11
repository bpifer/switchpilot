import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });

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
