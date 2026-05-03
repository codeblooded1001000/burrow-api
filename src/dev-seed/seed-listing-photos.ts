/**
 * Curated flat / room photos (Unsplash CDN, static URLs). Shared by seeds and
 * `update-listing-photos.ts`. https://unsplash.com/license
 */
export const SEED_LISTING_PHOTOS = [
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1631679706909-1844bbd07221?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1620626011763-221c284169b9?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600566753190-bf308bd39744?auto=format&fit=crop&w=1200&q=80',
] as const;

/** Three photos from the pool, rotated by lister / row index (same logic as seed listings). */
export function listingPhotosForListerIndex(listerIndex: number): string[] {
  const pool = SEED_LISTING_PHOTOS;
  const n = pool.length;
  const a = listerIndex % n;
  const one = pool[a];
  const two = pool[(a + 1) % n];
  const three = pool[(a + 2) % n];
  return [one, two, three];
}
