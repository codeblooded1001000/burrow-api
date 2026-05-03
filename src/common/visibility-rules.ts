export function profileIsPubliclyVisible(args: {
  ownerDeletedAt: Date | null;
  ownerCompanyVerified: boolean;
  profileRowExists: boolean;
  profileDeletedAt: Date | null | undefined;
  viewerIsBlockedByOwner: boolean;
  viewerHasBlockedOwner: boolean;
}): boolean {
  if (!args.profileRowExists) return false;
  if (args.ownerDeletedAt !== null) return false;
  if (!args.ownerCompanyVerified) return false;
  if (args.profileDeletedAt) return false;
  if (args.viewerIsBlockedByOwner) return false;
  if (args.viewerHasBlockedOwner) return false;
  return true;
}

export function listingIsPubliclyVisible(args: {
  isActive: boolean;
  ownerDeletedAt: Date | null;
  ownerCompanyVerified: boolean;
  ownerProfileDeletedAt: Date | null | undefined;
  viewerIsBlockedByOwner: boolean;
  viewerHasBlockedOwner: boolean;
}): boolean {
  if (!args.isActive) return false;
  if (args.ownerDeletedAt !== null) return false;
  if (!args.ownerCompanyVerified) return false;
  if (args.ownerProfileDeletedAt) return false;
  if (args.viewerIsBlockedByOwner) return false;
  if (args.viewerHasBlockedOwner) return false;
  return true;
}
