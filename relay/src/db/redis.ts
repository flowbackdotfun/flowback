import Redis from "ioredis";

const redis = process.env.UPSTASH_REDIS_URL
  ? new Redis(process.env.UPSTASH_REDIS_URL)
  : null;

export async function getCache<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function setCache(
  key: string,
  val: unknown,
  ttlSec: number,
): Promise<void> {
  if (!redis) return;
  await redis.set(key, JSON.stringify(val), "EX", ttlSec);
}
