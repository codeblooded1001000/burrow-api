import type { Prisma } from '@prisma/client';
import { FoodPref, Gender, Role, SmokingPref } from '@prisma/client';
import type { BrowseCursorPayload } from './cursor';
import type { BrowseQueryValidated } from '../schemas/browse.schemas';

/** Shared `User` filters for browse (verified, not deleted, not self, block graph). */
export function buildBrowseUserWhere(viewerId: string): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    companyVerified: true,
    id: { not: viewerId },
    NOT: {
      OR: [
        { blocksInitiated: { some: { blockedUserId: viewerId } } },
        { blocksReceived: { some: { blockerUserId: viewerId } } },
      ],
    },
  };
}

/** Flatmates tab: include listers only when they do not have an active listing (or SEEKER/BOTH). */
export function buildFlatmateUserRoleWhere(): Prisma.UserWhereInput {
  return {
    role: { in: [Role.LISTER, Role.SEEKER, Role.BOTH] },
    OR: [{ role: { not: Role.LISTER } }, { listing: null }, { listing: { is: { isActive: false } } }],
  };
}

export function buildListingBrowseWhere(viewerId: string, query: BrowseQueryValidated): Prisma.ListingWhereInput {
  const andParts: Prisma.ListingWhereInput[] = [];

  if (query.localities.length > 0) {
    andParts.push({ localityName: { in: query.localities } });
  }

  if (query.budgetMin !== undefined || query.budgetMax !== undefined) {
    const share: Prisma.IntFilter = {};
    if (query.budgetMin !== undefined) share.gte = query.budgetMin;
    if (query.budgetMax !== undefined) share.lte = query.budgetMax;
    andParts.push({ yourShare: share });
  }

  if (query.gender === 'WOMAN') {
    andParts.push({
      OR: [{ preferredGender: Gender.WOMAN }, { preferredGender: Gender.PREFER_NOT }],
    });
  } else if (query.gender === 'MAN') {
    andParts.push({
      OR: [{ preferredGender: Gender.MAN }, { preferredGender: Gender.PREFER_NOT }],
    });
  }
  // query.gender === 'ANYONE' or omitted: no listing-side gender constraint

  if (query.moveInFrom) {
    andParts.push({ availableFrom: { gte: new Date(query.moveInFrom) } });
  }
  if (query.moveInTo) {
    andParts.push({ availableFrom: { lte: new Date(query.moveInTo) } });
  }

  if (query.bhk.length > 0) {
    andParts.push({ bhk: { in: query.bhk } });
  }

  if (query.smokingPref === SmokingPref.NON_SMOKER) {
    andParts.push({ smokingAllowed: false });
  } else if (query.smokingPref === SmokingPref.SMOKER) {
    andParts.push({ smokingAllowed: true });
  }

  if (query.foodPref === FoodPref.PURE_VEG) {
    andParts.push({ foodPref: FoodPref.PURE_VEG });
  } else if (query.foodPref === FoodPref.EGGETARIAN) {
    andParts.push({ foodPref: { in: [FoodPref.PURE_VEG, FoodPref.EGGETARIAN] } });
  } else if (query.foodPref === FoodPref.NON_VEG_OK) {
    andParts.push({
      OR: [{ foodPref: null }, { foodPref: { in: [FoodPref.EGGETARIAN, FoodPref.NON_VEG_OK] } }],
    });
  }

  const where: Prisma.ListingWhereInput = {
    isActive: true,
    deletedAt: null,
    user: {
      AND: [buildBrowseUserWhere(viewerId), { profile: { is: { deletedAt: null } } }],
    },
    ...(andParts.length > 0 ? { AND: andParts } : {}),
  };

  return where;
}

export function buildProfileBrowseWhere(viewerId: string, query: BrowseQueryValidated): Prisma.ProfileWhereInput {
  const andParts: Prisma.ProfileWhereInput[] = [];

  if (query.localities.length > 0) {
    andParts.push({ preferredLocalities: { hasSome: query.localities } });
  }

  if (query.budgetMin !== undefined && query.budgetMax !== undefined) {
    andParts.push({
      budgetMin: { not: null },
      budgetMax: { not: null },
      AND: [{ budgetMin: { lte: query.budgetMax } }, { budgetMax: { gte: query.budgetMin } }],
    });
  } else if (query.budgetMin !== undefined) {
    andParts.push({
      budgetMax: { not: null, gte: query.budgetMin },
    });
  } else if (query.budgetMax !== undefined) {
    andParts.push({
      budgetMin: { not: null, lte: query.budgetMax },
    });
  }

  if (query.gender === 'WOMAN') {
    andParts.push({ gender: Gender.WOMAN });
  } else if (query.gender === 'MAN') {
    andParts.push({ gender: Gender.MAN });
  }
  // ANYONE or omitted: no profile gender constraint

  if (query.moveInFrom) {
    andParts.push({ moveInDate: { gte: new Date(query.moveInFrom) } });
  }
  if (query.moveInTo) {
    andParts.push({ moveInDate: { lte: new Date(query.moveInTo) } });
  }

  if (query.smokingPref === SmokingPref.NON_SMOKER) {
    andParts.push({ smokingPref: SmokingPref.NON_SMOKER });
  } else if (query.smokingPref === SmokingPref.SMOKER) {
    andParts.push({ smokingPref: SmokingPref.SMOKER });
  }

  if (query.foodPref === FoodPref.PURE_VEG) {
    andParts.push({ foodPref: FoodPref.PURE_VEG });
  } else if (query.foodPref === FoodPref.EGGETARIAN) {
    andParts.push({ foodPref: { in: [FoodPref.PURE_VEG, FoodPref.EGGETARIAN] } });
  } else if (query.foodPref === FoodPref.NON_VEG_OK) {
    andParts.push({ foodPref: { in: [FoodPref.EGGETARIAN, FoodPref.NON_VEG_OK] } });
  }

  if (query.professions.length > 0) {
    andParts.push({ profession: { in: query.professions } });
  }

  const where: Prisma.ProfileWhereInput = {
    deletedAt: null,
    userId: { not: viewerId },
    profileCompletion: { gte: 70 },
    user: {
      AND: [buildBrowseUserWhere(viewerId), buildFlatmateUserRoleWhere()],
    },
    ...(andParts.length > 0 ? { AND: andParts } : {}),
  };

  return where;
}

export function buildListingCursorWhere(cursor: BrowseCursorPayload | null): Prisma.ListingWhereInput | null {
  if (!cursor) return null;
  if (cursor.sort === 'newest') {
    return {
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { AND: [{ createdAt: new Date(cursor.createdAt) }, { id: { lt: cursor.id } }] },
      ],
    };
  }
  return {
    OR: [
      { availableFrom: { gt: new Date(cursor.availableFrom) } },
      { AND: [{ availableFrom: new Date(cursor.availableFrom) }, { id: { gt: cursor.id } }] },
    ],
  };
}

export function buildProfileCursorWhere(cursor: BrowseCursorPayload | null): Prisma.ProfileWhereInput | null {
  if (cursor?.sort !== 'newest') return null;
  return {
    OR: [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { AND: [{ createdAt: new Date(cursor.createdAt) }, { id: { lt: cursor.id } }] },
    ],
  };
}
