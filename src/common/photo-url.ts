/** Default public CDN host when `R2_PUBLIC_URL` is unset (dev / stub uploads). */
export const DEFAULT_R2_PUBLIC_BASE = 'https://cdn.burrow.in';

export function resolveR2PublicBase(configured: string): string {
  const t = configured.trim();
  return t.length > 0 ? t.replace(/\/$/, '') : DEFAULT_R2_PUBLIC_BASE;
}

export function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Legacy rows or dev R2 may use full `http://…` URLs; treat like https so we do not prefix again. */
export function isAbsoluteHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === 'https:' || p === 'http:';
  } catch {
    return false;
  }
}

/** Profile/listing photo URLs must be HTTPS and under the configured public R2 base. */
export function isAllowedPhotoPublicUrl(url: string, r2PublicBase: string): boolean {
  if (!isHttpsUrl(url)) return false;
  const base = resolveR2PublicBase(r2PublicBase);
  return url.startsWith(`${base}/`);
}

/**
 * Stored value is an R2 object key (no scheme), e.g. `listings/{userId}/….jpg` or `profiles/{userId}/….webp`.
 * Legacy rows may still store a full HTTPS URL under the public CDN.
 */
export function isR2ObjectKey(ref: string): boolean {
  const t = ref.trim();
  if (t.length === 0) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (t.includes('..') || t.startsWith('/')) return false;
  return /^(listings|profiles)\/[^/]+\/[^/]+$/.test(t);
}

/** Turn DB value into browser-loadable URL. Full HTTPS strings are returned unchanged (legacy). */
export function resolveMediaRefToPublicUrl(
  ref: string | null | undefined,
  r2PublicUrlEnv: string,
): string | null {
  if (ref === null || ref === undefined) return null;
  const t = ref.trim();
  if (t.length === 0) return null;
  if (isAbsoluteHttpUrl(t)) return t;
  const base = resolveR2PublicBase(r2PublicUrlEnv);
  const path = t.replace(/^\/+/, '');
  return `${base}/${path}`;
}

export function resolveMediaRefsToPublicUrls(
  refs: string[],
  r2PublicUrlEnv: string,
): string[] {
  return refs.map((r) => resolveMediaRefToPublicUrl(r, r2PublicUrlEnv) ?? '');
}

function keyOwnedByUser(key: string, userId: string, kind: 'listings' | 'profiles'): boolean {
  const prefix = `${kind}/${userId}/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return rest.length > 0 && !rest.includes('/');
}

/** Accept legacy HTTPS URL under CDN, or an object key under this user's prefix. */
export function isAllowedListingPhotoWrite(ref: string, ownerUserId: string, r2PublicUrlEnv: string): boolean {
  if (isAllowedPhotoPublicUrl(ref, r2PublicUrlEnv)) return true;
  return isR2ObjectKey(ref) && keyOwnedByUser(ref, ownerUserId, 'listings');
}

export function isAllowedProfilePhotoWrite(ref: string, ownerUserId: string, r2PublicUrlEnv: string): boolean {
  if (isAllowedPhotoPublicUrl(ref, r2PublicUrlEnv)) return true;
  return isR2ObjectKey(ref) && keyOwnedByUser(ref, ownerUserId, 'profiles');
}
