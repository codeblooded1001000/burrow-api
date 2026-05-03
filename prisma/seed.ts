import { readFileSync } from 'fs';
import { join } from 'path';
import argon2 from 'argon2';
import {
  FoodPref,
  Gender,
  PrismaClient,
  Role,
  SmokingPref,
  WorkSchedule,
} from '@prisma/client';
import { DEMO_STATIC_PIN } from '../src/auth/data/demo-bypass';
import { upsertAltMobilityShowcaseUser } from '../src/auth/demo-showcase-upsert';
import { computeProfileCompletion } from '../src/profiles/profile-completion';
import { spreadListingLatLng } from '../src/dev-seed/listing-lat-lng-dev';
import { listingPhotosForListerIndex } from '../src/dev-seed/seed-listing-photos';

const prisma = new PrismaClient();

/** 6-digit PIN for all dev seed accounts (not a weak pattern; safe for local only). */
const DEV_SEED_PIN = '847291';

type AllowlistRow = { domain: string; companyName: string };

/** Parallel upserts per batch (hundreds of serial round-trips look like a hang on slow DBs). */
const ALLOWLIST_UPSERT_CONCURRENCY = 12;

async function seedAllowlist(): Promise<void> {
  const filePath = join(__dirname, '..', 'src', 'auth', 'data', 'company-allowlist.json');
  const raw = readFileSync(filePath, 'utf8') as string;
  const rows = JSON.parse(raw) as AllowlistRow[];
  process.stdout.write(
    `[seed] Company allowlist: upserting ${rows.length} domains (${ALLOWLIST_UPSERT_CONCURRENCY} concurrent)…\n`,
  );
  for (let i = 0; i < rows.length; i += ALLOWLIST_UPSERT_CONCURRENCY) {
    const chunk = rows.slice(i, i + ALLOWLIST_UPSERT_CONCURRENCY);
    await Promise.all(
      chunk.map((row) => {
        const domain = row.domain.toLowerCase();
        return prisma.companyAllowlist.upsert({
          where: { domain },
          create: {
            domain,
            companyName: row.companyName,
            isActive: true,
          },
          update: { companyName: row.companyName, isActive: true },
        });
      }),
    );
    const done = Math.min(i + chunk.length, rows.length);
    process.stdout.write(`[seed] Allowlist ${done}/${rows.length}\n`);
  }
  process.stdout.write(`[seed] Company allowlist: ${rows.length} domains upserted.\n`);
}

const SEED_USERS_CONFIG: {
  email: string;
  role: Role;
  companyName: string;
  /** If true, no profile row (for onboarding flows). */
  skipProfile?: boolean;
}[] = [
  { email: 'alice.seed@infosys.com', role: Role.LISTER, companyName: 'Infosys' },
  { email: 'bob.seed@tcs.com', role: Role.SEEKER, companyName: 'Tata Consultancy Services' },
  { email: 'carol.seed@wipro.com', role: Role.BOTH, companyName: 'Wipro' },
  { email: 'dan.seed@hcltech.com', role: Role.LISTER, companyName: 'HCL Technologies' },
  { email: 'eve.seed@razorpay.com', role: Role.SEEKER, companyName: 'Razorpay' },
  { email: 'frank.seed@zomato.com', role: Role.BOTH, companyName: 'Zomato' },
  { email: 'grace.seed@deloitte.com', role: Role.LISTER, companyName: 'Deloitte' },
  {
    email: 'onboarding.seed@accenture.com',
    role: Role.ONBOARDING,
    companyName: 'Accenture',
    skipProfile: true,
  },
];

/** Dev profile avatar (Unsplash — free to use). */
const SEED_PHOTO =
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80';

async function seedDevUsers(): Promise<void> {
  const allow =
    process.env.SEED_USERS === 'true' &&
    (process.env.NODE_ENV === 'development' || process.env.SEED_ALLOW_NON_DEV === 'true');
  if (!allow) {
    process.stdout.write(
      '[seed] Skipping dev users (set SEED_USERS=true and NODE_ENV=development, or add SEED_ALLOW_NON_DEV=true for staging).\n',
    );
    return;
  }

  const pinHash = await argon2.hash(DEV_SEED_PIN, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const createdIds: { email: string; id: string; role: Role }[] = [];
  let listerPhotoIndex = 0;

  for (let i = 0; i < SEED_USERS_CONFIG.length; i += 1) {
    const cfg = SEED_USERS_CONFIG[i] ?? SEED_USERS_CONFIG[0];
    const user = await prisma.user.upsert({
      where: { email: cfg.email },
      create: {
        email: cfg.email,
        emailVerified: true,
        pinHash,
        role: cfg.role,
        companyName: cfg.companyName,
        companyVerified: true,
      },
      update: {
        emailVerified: true,
        pinHash,
        role: cfg.role,
        companyName: cfg.companyName,
        companyVerified: true,
        deletedAt: null,
      },
    });
    createdIds.push({ email: cfg.email, id: user.id, role: cfg.role });

    if (cfg.skipProfile) {
      await prisma.profile.deleteMany({ where: { userId: user.id } });
      await prisma.listing.deleteMany({ where: { userId: user.id } });
      continue;
    }

    const bio =
      'Seeded profile for local development. Long enough bio text for profile completion scoring in Burrow.';
    const completion = computeProfileCompletion(
      {
        photoUrl: SEED_PHOTO,
        bio,
        profession: 'Engineer',
        budgetMin: 15000,
        budgetMax: 35000,
        moveInDate: new Date('2026-06-01T00:00:00.000Z'),
        lifestyleTags: ['Chill'],
      },
      { phoneVerified: false },
    );

    await prisma.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        fullName: `Seed User ${i + 1}`,
        age: 24 + (i % 30),
        gender: i % 2 === 0 ? Gender.WOMAN : Gender.MAN,
        photoUrl: SEED_PHOTO,
        bio,
        profession: 'Engineer',
        workSchedule: WorkSchedule.FLEXIBLE,
        budgetMin: 15000,
        budgetMax: 35000,
        moveInDate: new Date('2026-06-01T00:00:00.000Z'),
        preferredLocalities: ['Cyber City', 'Sector 43'],
        lifestyleTags: ['Chill'],
        smokingPref: SmokingPref.NON_SMOKER,
        foodPref: FoodPref.NON_VEG_OK,
        profileCompletion: completion,
      },
      update: {
        fullName: `Seed User ${i + 1}`,
        photoUrl: SEED_PHOTO,
        bio,
        profession: 'Engineer',
        workSchedule: WorkSchedule.FLEXIBLE,
        budgetMin: 15000,
        budgetMax: 35000,
        moveInDate: new Date('2026-06-01T00:00:00.000Z'),
        preferredLocalities: ['Cyber City', 'Sector 43'],
        lifestyleTags: ['Chill'],
        smokingPref: SmokingPref.NON_SMOKER,
        foodPref: FoodPref.NON_VEG_OK,
        profileCompletion: completion,
        deletedAt: null,
      },
    });

    if (cfg.role === Role.LISTER || cfg.role === Role.BOTH) {
      const photos = listingPhotosForListerIndex(listerPhotoIndex);
      const { lat, lng } = spreadListingLatLng(i, SEED_USERS_CONFIG.length);
      listerPhotoIndex += 1;
      await prisma.listing.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          localityName: 'Cyber City',
          lat,
          lng,
          bhk: 2,
          totalRent: 45000,
          yourShare: 22000,
          availableFrom: new Date('2026-06-01T00:00:00.000Z'),
          photos,
          description: 'Seeded listing for development. Near Cyber City metro and markets.',
          amenities: ['Wi-Fi', 'Power backup'],
          preferredGender: Gender.PREFER_NOT,
          preferredProfessions: ['Software engineer'],
          smokingAllowed: false,
          foodPref: FoodPref.NON_VEG_OK,
          workSchedulePref: WorkSchedule.FLEXIBLE,
          isActive: true,
        },
        update: {
          lat,
          lng,
          photos,
          isActive: true,
          deletedAt: null,
        },
      });
    } else {
      await prisma.listing.deleteMany({ where: { userId: user.id } });
    }
  }

  const alice = createdIds.find((u) => u.email === 'alice.seed@infosys.com');
  const bob = createdIds.find((u) => u.email === 'bob.seed@tcs.com');
  if (alice && bob) {
    await prisma.block.upsert({
      where: {
        blockerUserId_blockedUserId: { blockerUserId: bob.id, blockedUserId: alice.id },
      },
      create: { blockerUserId: bob.id, blockedUserId: alice.id },
      update: {},
    });
    process.stdout.write(
      '[seed] Block: bob.seed@tcs.com blocked alice.seed@infosys.com (alice gets 404 on bob public profile).\n',
    );
  }

  process.stdout.write(
    `[seed] Dev users: ${SEED_USERS_CONFIG.length} upserted. PIN for all: ${DEV_SEED_PIN} (local only).\n`,
  );
  process.stdout.write(
    '[seed] Log in with any seed email + PIN; use onboarding.seed@accenture.com for no-profile onboarding state.\n',
  );
}

/** Alt Mobility demo accounts (static OTP `347612` when `DEMO_AUTH_BYPASS` / dev — see demo-bypass.ts). */
async function seedAltMobilityDemoAccounts(): Promise<void> {
  const allow =
    process.env.NODE_ENV === 'development' || process.env.SEED_DEMO_ACCOUNTS === 'true';
  if (!allow) {
    process.stdout.write(
      '[seed] Skipping Alt Mobility demo accounts (set SEED_DEMO_ACCOUNTS=true, or run with NODE_ENV=development).\n',
    );
    return;
  }

  const pinHash = await argon2.hash(DEMO_STATIC_PIN, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const demoEmails = ['pushpander@alt-mobility.com', 'prince@alt-mobility.com'] as const;
  for (const em of demoEmails) {
    await upsertAltMobilityShowcaseUser(prisma, pinHash, em);
  }

  process.stdout.write(
    `[seed] Alt Mobility demo: ${demoEmails.join(', ')} — PIN ${DEMO_STATIC_PIN}; OTP ${DEMO_STATIC_PIN} with mail bypass (dev or DEMO_AUTH_BYPASS=true).\n`,
  );
}

async function main(): Promise<void> {
  process.stdout.write('[seed] Starting (allowlist → dev users → Alt Mobility demo).\n');
  await seedAllowlist();
  await seedDevUsers();
  await seedAltMobilityDemoAccounts();
  process.stdout.write('[seed] Done.\n');
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
