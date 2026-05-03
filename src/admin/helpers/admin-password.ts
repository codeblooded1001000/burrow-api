import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time comparison via SHA-256 digests (fixed length). */
export function adminPasswordMatches(plain: string, expectedFromEnv: string): boolean {
  if (expectedFromEnv.length === 0) return false;
  const ha = createHash('sha256').update(plain, 'utf8').digest();
  const hb = createHash('sha256').update(expectedFromEnv, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
