import type { Listing, Profile, User } from '@prisma/client';
import { Role } from '@prisma/client';
import { resolveMediaRefToPublicUrl } from '../common/photo-url';
import type { UserDto } from './schemas/auth.schemas';

export function mapUserToDto(
  user: User,
  profile: Profile | null,
  listing: Listing | null,
  r2PublicUrlEnv: string,
): UserDto {
  const r: UserDto['role'] =
    user.role === Role.ONBOARDING ? null : user.role === Role.LISTER
      ? 'LISTER'
      : user.role === Role.SEEKER
        ? 'SEEKER'
        : 'BOTH';
  const activeProfile = profile?.deletedAt === null ? profile : null;
  const activeListing = listing?.isActive ? listing : null;
  return {
    id: user.id,
    email: user.email,
    role: r,
    companyName: user.companyName,
    companyVerified: user.companyVerified,
    hasProfile: activeProfile !== null,
    hasListing: activeListing !== null,
    profileCompletion: activeProfile?.profileCompletion ?? 0,
    createdAt: user.createdAt.toISOString(),
    fullName: activeProfile?.fullName ?? null,
    photoUrl: resolveMediaRefToPublicUrl(activeProfile?.photoUrl ?? null, r2PublicUrlEnv),
  };
}
