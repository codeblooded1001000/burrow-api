import { FoodPref, Gender, Role, SmokingPref, WorkSchedule, type PrismaClient } from '@prisma/client';
import { computeProfileCompletion } from '../profiles/profile-completion';
import { isDemoBypassEmail } from './data/demo-bypass';
import { spreadListingLatLng } from '../dev-seed/listing-lat-lng-dev';
import { listingPhotosForListerIndex } from '../dev-seed/seed-listing-photos';

/** Same hero image as `prisma/seed.ts` (Unsplash). */
export const DEMO_SHOWCASE_PHOTO =
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80';

const DEMO_COMPANY = 'Alt Mobility';

type DemoCfg = { email: string; role: Role; fullName: string; withListing: boolean; listerIndex: number };

function demoCfgForEmail(email: string): DemoCfg | null {
  const e = email.trim().toLowerCase();
  if (e === 'pushpander@alt-mobility.com') {
    return {
      email: e,
      role: Role.BOTH,
      fullName: 'Pushpander (demo)',
      withListing: true,
      listerIndex: 0,
    };
  }
  if (e === 'prince@alt-mobility.com') {
    return {
      email: e,
      role: Role.SEEKER,
      fullName: 'Prince (demo)',
      withListing: false,
      listerIndex: 0,
    };
  }
  return null;
}

/**
 * Upsert demo user + profile (+ listing for lister) for Alt Mobility showcase accounts.
 * Caller supplies `pinHash` (e.g. from {@link PinService.hashPin}(DEMO_STATIC_PIN)).
 */
export async function upsertAltMobilityShowcaseUser(
  prisma: Pick<PrismaClient, 'user' | 'profile' | 'listing'>,
  pinHash: string,
  email: string,
): Promise<void> {
  const cfg = demoCfgForEmail(email);
  if (!cfg || !isDemoBypassEmail(email)) return;

  const user = await prisma.user.upsert({
    where: { email: cfg.email },
    create: {
      email: cfg.email,
      emailVerified: true,
      pinHash,
      role: cfg.role,
      companyName: DEMO_COMPANY,
      companyVerified: true,
    },
    update: {
      emailVerified: true,
      pinHash,
      role: cfg.role,
      companyName: DEMO_COMPANY,
      companyVerified: true,
      deletedAt: null,
    },
  });

  const bio =
    'Demo account for Alt Mobility (OTP/PIN bypass in dev or when DEMO_AUTH_BYPASS=true on the API).';
  const completion = computeProfileCompletion(
    {
      photoUrl: DEMO_SHOWCASE_PHOTO,
      bio,
      profession: 'Product',
      budgetMin: 15000,
      budgetMax: 40000,
      moveInDate: new Date('2026-06-01T00:00:00.000Z'),
      lifestyleTags: ['Chill'],
    },
    { phoneVerified: false },
  );

  await prisma.profile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: cfg.fullName,
      age: 28,
      gender: Gender.MAN,
      photoUrl: DEMO_SHOWCASE_PHOTO,
      bio,
      profession: 'Product',
      workSchedule: WorkSchedule.FLEXIBLE,
      budgetMin: 15000,
      budgetMax: 40000,
      moveInDate: new Date('2026-06-01T00:00:00.000Z'),
      preferredLocalities: ['Gurugram', 'Cyber City'],
      lifestyleTags: ['Chill'],
      smokingPref: SmokingPref.NON_SMOKER,
      foodPref: FoodPref.NON_VEG_OK,
      profileCompletion: completion,
    },
    update: {
      fullName: cfg.fullName,
      photoUrl: DEMO_SHOWCASE_PHOTO,
      bio,
      profession: 'Product',
      workSchedule: WorkSchedule.FLEXIBLE,
      budgetMin: 15000,
      budgetMax: 40000,
      moveInDate: new Date('2026-06-01T00:00:00.000Z'),
      preferredLocalities: ['Gurugram', 'Cyber City'],
      lifestyleTags: ['Chill'],
      smokingPref: SmokingPref.NON_SMOKER,
      foodPref: FoodPref.NON_VEG_OK,
      profileCompletion: completion,
      deletedAt: null,
    },
  });

  if (cfg.withListing) {
    const photos = listingPhotosForListerIndex(cfg.listerIndex);
    const { lat, lng } = spreadListingLatLng(cfg.listerIndex, 2);
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
        description: 'Demo listing for Alt Mobility.',
        amenities: ['Wi-Fi', 'Parking'],
        preferredGender: Gender.PREFER_NOT,
        preferredProfessions: ['Engineer'],
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
