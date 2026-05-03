import type { ListingDto } from '../listings/listings.types';
import type { ProfilePublicDto } from '../profiles/profiles.types';

export type BrowseListingItemDto = ListingDto & { matchScore: number };

export type BrowseProfileItemDto = ProfilePublicDto & { matchScore: number };
