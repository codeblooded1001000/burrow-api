import { listingIsPubliclyVisible, profileIsPubliclyVisible } from './visibility-rules';

describe('visibility rules', () => {
  it('profile hidden when owner deleted', () => {
    expect(
      profileIsPubliclyVisible({
        ownerDeletedAt: new Date(),
        ownerCompanyVerified: true,
        profileRowExists: true,
        profileDeletedAt: null,
        viewerIsBlockedByOwner: false,
        viewerHasBlockedOwner: false,
      }),
    ).toBe(false);
  });

  it('profile hidden when viewer blocked by owner', () => {
    expect(
      profileIsPubliclyVisible({
        ownerDeletedAt: null,
        ownerCompanyVerified: true,
        profileRowExists: true,
        profileDeletedAt: null,
        viewerIsBlockedByOwner: true,
        viewerHasBlockedOwner: false,
      }),
    ).toBe(false);
  });

  it('profile hidden when viewer has blocked owner', () => {
    expect(
      profileIsPubliclyVisible({
        ownerDeletedAt: null,
        ownerCompanyVerified: true,
        profileRowExists: true,
        profileDeletedAt: null,
        viewerIsBlockedByOwner: false,
        viewerHasBlockedOwner: true,
      }),
    ).toBe(false);
  });

  it('listing hidden when inactive', () => {
    expect(
      listingIsPubliclyVisible({
        isActive: false,
        ownerDeletedAt: null,
        ownerCompanyVerified: true,
        ownerProfileDeletedAt: null,
        viewerIsBlockedByOwner: false,
        viewerHasBlockedOwner: false,
      }),
    ).toBe(false);
  });

  it('listing visible when all gates pass', () => {
    expect(
      listingIsPubliclyVisible({
        isActive: true,
        ownerDeletedAt: null,
        ownerCompanyVerified: true,
        ownerProfileDeletedAt: null,
        viewerIsBlockedByOwner: false,
        viewerHasBlockedOwner: false,
      }),
    ).toBe(true);
  });
});
