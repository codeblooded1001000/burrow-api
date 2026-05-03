import type { Listing, Profile } from '@prisma/client';
import type { BrowseQueryValidated } from '../schemas/browse.schemas';

/** MVP stub: baseline 100 minus simple mismatches for soft preferences. */
export function scoreListingForBrowse(
  listing: Listing,
  listerProfile: Profile | null,
  query: BrowseQueryValidated,
): number {
  let score = 100;
  if (query.workSchedule && listing.workSchedulePref && query.workSchedule !== listing.workSchedulePref) {
    score -= 10;
  }
  if (query.lifestyleTags.length > 0 && listerProfile && listerProfile.lifestyleTags.length > 0) {
    const overlap = query.lifestyleTags.filter((t) => listerProfile.lifestyleTags.includes(t));
    if (overlap.length === 0) score -= 10;
  }
  return Math.max(0, Math.min(100, score));
}

export function scoreProfileForBrowse(profile: Profile, query: BrowseQueryValidated): number {
  let score = 100;
  if (query.workSchedule && profile.workSchedule && query.workSchedule !== profile.workSchedule) {
    score -= 10;
  }
  if (query.lifestyleTags.length > 0 && profile.lifestyleTags.length > 0) {
    const overlap = query.lifestyleTags.filter((t) => profile.lifestyleTags.includes(t));
    if (overlap.length === 0) score -= 10;
  }
  return Math.max(0, Math.min(100, score));
}
