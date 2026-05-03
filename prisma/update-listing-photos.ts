/**
 * Sets `photos` on every listing to the curated URLs from `seed-listing-photos.ts`
 * (same triple rotation as seed, by row order). Use after seed or to refresh images
 * without re-running full seed.
 *
 * Safety: runs only when `NODE_ENV=development` or `UPDATE_LISTING_PHOTOS=true`.
 *
 * Usage: `npm run update-listing-photos`
 */

import { resolve } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { listingPhotosForListerIndex } from './seed-listing-photos';

config({ path: resolve(__dirname, '..', '.env') });

const allowed =
  process.env.NODE_ENV === 'development' || process.env.UPDATE_LISTING_PHOTOS === 'true';

async function main(): Promise<void> {
  if (!allowed) {
    process.stderr.write(
      'Refusing to run: set NODE_ENV=development or UPDATE_LISTING_PHOTOS=true (staging only).\n',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const listings = await prisma.listing.findMany({
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    let updated = 0;
    for (let i = 0; i < listings.length; i += 1) {
      const row = listings[i];
      if (!row) continue;
      const photos = listingPhotosForListerIndex(i);
      await prisma.listing.update({
        where: { id: row.id },
        data: { photos },
      });
      updated += 1;
    }

    process.stdout.write(`[update-listing-photos] Updated photos on ${String(updated)} listing(s).\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
