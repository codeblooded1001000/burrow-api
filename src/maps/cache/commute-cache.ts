import type { RedisService } from '../../redis/redis.service';

/** ~11 m precision — nearby pins share cache entries. */
export function buildCommuteCacheKey(oLat: number, oLng: number, dLat: number, dLng: number): string {
  const r = (n: number): string => n.toFixed(4);
  return `commute:${r(oLat)}_${r(oLng)}:${r(dLat)}_${r(dLng)}`;
}

export interface CachedCommutePayload {
  distanceMeters: number;
  durationSeconds: number;
  durationInTrafficSeconds: number;
  /** Only `driving` rows are written to Redis; `straight_line` is never cached. */
  mode: 'driving' | 'straight_line';
}

const TTL_SEC = 7 * 24 * 60 * 60;

export async function getCachedCommute(
  redis: RedisService,
  oLat: number,
  oLng: number,
  dLat: number,
  dLng: number,
): Promise<CachedCommutePayload | null> {
  const key = buildCommuteCacheKey(oLat, oLng, dLat, dLng);
  const raw = await redis.get(key);
  if (raw === null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isCachedCommutePayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedCommute(
  redis: RedisService,
  oLat: number,
  oLng: number,
  dLat: number,
  dLng: number,
  result: CachedCommutePayload,
): Promise<void> {
  const key = buildCommuteCacheKey(oLat, oLng, dLat, dLng);
  await redis.set(key, JSON.stringify(result), TTL_SEC);
}

function isCachedCommutePayload(v: unknown): v is CachedCommutePayload {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.distanceMeters === 'number' &&
    typeof o.durationSeconds === 'number' &&
    typeof o.durationInTrafficSeconds === 'number' &&
    o.mode === 'driving'
  );
}
