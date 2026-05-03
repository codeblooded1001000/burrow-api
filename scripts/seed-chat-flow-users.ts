/**
 * Seeds two fixed dev accounts for messaging / request-gate testing:
 * - Lister: has profile + active listing
 * - Seeker: has profile, no listing
 * - Clears any block between them
 * - Optionally replaces any existing conversation pair with a PENDING chat (seeker → lister first message)
 *
 * Run from repo root of the API package:
 *   cd burrow-api && npx tsx scripts/seed-chat-flow-users.ts
 * or:
 *   npm run seed:chat-flow
 *
 * Requires DATABASE_URL (load `.env` from cwd). Company domains must be on the allowlist (run `npm run seed`
 * once so `seedAllowlist` has run, or rely on existing DB allowlist).
 */
import { resolve } from 'node:path';
import { config } from 'dotenv';
import argon2 from 'argon2';
import {
  ConversationStatus,
  FoodPref,
  Gender,
  PrismaClient,
  Role,
  SmokingPref,
  WorkSchedule,
} from '@prisma/client';
import { orderedParticipantIds } from '../src/common/types/conversation-order';
import { computeProfileCompletion } from '../src/profiles/profile-completion';
import { spreadListingLatLng } from '../src/dev-seed/listing-lat-lng-dev';
import { listingPhotosForListerIndex } from '../src/dev-seed/seed-listing-photos';

config({ path: resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

/** Dedicated accounts — avoid clashing with main `prisma/seed.ts` users. */
const CHAT_FLOW_LISTER_EMAIL = 'chatflow.lister@infosys.com';
const CHAT_FLOW_SEEKER_EMAIL = 'chatflow.seeker@tcs.com';

/** 6-digit PIN (local dev only). */
const CHAT_FLOW_PIN = '889900';

const SEED_PHOTO =
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80';

async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

async function upsertUserWithProfile(params: {
  email: string;
  role: Role;
  companyName: string;
  fullName: string;
  pinHash: string;
}): Promise<{ id: string }> {
  const user = await prisma.user.upsert({
    where: { email: params.email },
    create: {
      email: params.email,
      emailVerified: true,
      pinHash: params.pinHash,
      role: params.role,
      companyName: params.companyName,
      companyVerified: true,
    },
    update: {
      emailVerified: true,
      pinHash: params.pinHash,
      role: params.role,
      companyName: params.companyName,
      companyVerified: true,
      deletedAt: null,
    },
  });

  const bio =
    'Chat-flow seed profile. Long enough bio text for profile completion scoring in Burrow.';
  const completion = computeProfileCompletion(
    {
      photoUrl: SEED_PHOTO,
      bio,
      profession: 'Engineer',
      budgetMin: 18000,
      budgetMax: 40000,
      moveInDate: new Date('2026-07-01T00:00:00.000Z'),
      lifestyleTags: ['Chill'],
    },
    { phoneVerified: false },
  );

  await prisma.profile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: params.fullName,
      age: 28,
      gender: Gender.WOMAN,
      photoUrl: SEED_PHOTO,
      bio,
      profession: 'Engineer',
      workSchedule: WorkSchedule.OFFICE,
      budgetMin: 18000,
      budgetMax: 40000,
      moveInDate: new Date('2026-07-01T00:00:00.000Z'),
      preferredLocalities: ['Cyber City', 'Sector 43'],
      lifestyleTags: ['Chill'],
      smokingPref: SmokingPref.NON_SMOKER,
      foodPref: FoodPref.NON_VEG_OK,
      profileCompletion: completion,
    },
    update: {
      fullName: params.fullName,
      photoUrl: SEED_PHOTO,
      bio,
      profession: 'Engineer',
      workSchedule: WorkSchedule.OFFICE,
      budgetMin: 18000,
      budgetMax: 40000,
      moveInDate: new Date('2026-07-01T00:00:00.000Z'),
      preferredLocalities: ['Cyber City', 'Sector 43'],
      lifestyleTags: ['Chill'],
      smokingPref: SmokingPref.NON_SMOKER,
      foodPref: FoodPref.NON_VEG_OK,
      profileCompletion: completion,
      deletedAt: null,
    },
  });

  return user;
}

async function main(): Promise<void> {
  const pinHash = await hashPin(CHAT_FLOW_PIN);

  const lister = await upsertUserWithProfile({
    email: CHAT_FLOW_LISTER_EMAIL,
    role: Role.LISTER,
    companyName: 'Infosys',
    fullName: 'Chat Flow Lister',
    pinHash,
  });

  const seeker = await upsertUserWithProfile({
    email: CHAT_FLOW_SEEKER_EMAIL,
    role: Role.SEEKER,
    companyName: 'Tata Consultancy Services',
    fullName: 'Chat Flow Seeker',
    pinHash,
  });

  await prisma.listing.deleteMany({ where: { userId: seeker.id } });

  const photos = listingPhotosForListerIndex(42);
  const { lat, lng } = spreadListingLatLng(62, 64);
  await prisma.listing.upsert({
    where: { userId: lister.id },
    create: {
      userId: lister.id,
      localityName: 'Cyber City',
      lat,
      lng,
      bhk: 2,
      totalRent: 48000,
      yourShare: 24000,
      availableFrom: new Date('2026-07-01T00:00:00.000Z'),
      photos,
      description: 'Chat-flow seed listing — use the seeker account to message from Browse.',
      amenities: ['Wi-Fi', 'Power backup', 'Lift'],
      preferredGender: Gender.PREFER_NOT,
      preferredProfessions: ['Software engineer'],
      smokingAllowed: false,
      foodPref: FoodPref.NON_VEG_OK,
      workSchedulePref: WorkSchedule.FLEXIBLE,
      isActive: true,
    },
    update: {
      photos,
      isActive: true,
      deletedAt: null,
    },
  });

  await prisma.block.deleteMany({
    where: {
      OR: [
        { blockerUserId: seeker.id, blockedUserId: lister.id },
        { blockerUserId: lister.id, blockedUserId: seeker.id },
      ],
    },
  });

  const { participantAUserId, participantBUserId } = orderedParticipantIds(seeker.id, lister.id);

  await prisma.conversation.deleteMany({
    where: { participantAUserId, participantBUserId },
  });

  const now = new Date();
  const conv = await prisma.conversation.create({
    data: {
      participantAUserId,
      participantBUserId,
      lastMessageAt: now,
      status: ConversationStatus.PENDING,
      initiatedByUserId: seeker.id,
    },
  });

  await prisma.message.create({
    data: {
      conversationId: conv.id,
      senderId: seeker.id,
      body: 'Hi — I saw your listing on Burrow and would love to chat about the room.',
    },
  });

  const listing = await prisma.listing.findUniqueOrThrow({
    where: { userId: lister.id },
    select: { id: true },
  });

  process.stdout.write('\n=== Chat flow seed OK ===\n\n');
  process.stdout.write('Lister (has listing — check Inbox for pending request):\n');
  process.stdout.write(`  Email: ${CHAT_FLOW_LISTER_EMAIL}\n`);
  process.stdout.write(`  PIN:   ${CHAT_FLOW_PIN}\n\n`);
  process.stdout.write('Seeker (browse → message, or continue this thread):\n');
  process.stdout.write(`  Email: ${CHAT_FLOW_SEEKER_EMAIL}\n`);
  process.stdout.write(`  PIN:   ${CHAT_FLOW_PIN}\n\n`);
  process.stdout.write('Pre-seeded conversation:\n');
  process.stdout.write(`  Conversation id: ${conv.id}\n`);
  process.stdout.write('  Status: PENDING (seeker sent the first message; lister can Accept / Reject in Inbox.)\n\n');
  process.stdout.write(`Lister listing id (detail URL /api or UI): ${listing.id}\n\n`);
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
