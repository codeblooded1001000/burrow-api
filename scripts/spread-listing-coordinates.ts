/**
 * Updates every listing row so `lat` / `lng` are unique (grid inside Gurgaon bbox).
 * Safe to re-run; coordinates are deterministic from row order (`id` ascending).
 *
 *   cd burrow-api && npm run seed:spread-listings
 *
 * Uses `DATABASE_URL` from `.env` in cwd.
 */
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { spreadListingLatLng } from '../prisma/listing-lat-lng-dev';

config({ path: resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const listings = await prisma.listing.findMany({
    orderBy: { id: 'asc' },
    select: { id: true },
  });

  if (listings.length === 0) {
    process.stdout.write('[spread-listings] No listing rows found.\n');
    return;
  }

  const n = listings.length;
  await prisma.$transaction(
    listings.map((row, index) => {
      const { lat, lng } = spreadListingLatLng(index, n);
      return prisma.listing.update({
        where: { id: row.id },
        data: { lat, lng },
      });
    }),
  );

  process.stdout.write(
    `[spread-listings] Updated ${String(listings.length)} listing(s) with distinct coordinates (Gurgaon grid).\n`,
  );
}

void main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e: unknown) => {
    process.stderr.write(`${String(e)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
