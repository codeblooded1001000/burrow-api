import {
  buildListingPhotoObjectKey,
  buildProfilePhotoObjectKey,
  fileExtFromImageContentType,
  objectKeyOwnedByUser,
} from './upload-keys';

describe('fileExtFromImageContentType', () => {
  it('maps content types to extensions', () => {
    expect(fileExtFromImageContentType('image/jpeg')).toBe('jpg');
    expect(fileExtFromImageContentType('image/png')).toBe('png');
    expect(fileExtFromImageContentType('image/webp')).toBe('webp');
  });
});

describe('buildListingPhotoObjectKey', () => {
  it('uses listings prefix and unique suffix', () => {
    const a = buildListingPhotoObjectKey('user-1', 'image/jpeg');
    const b = buildListingPhotoObjectKey('user-1', 'image/jpeg');
    expect(a).toMatch(/^listings\/user-1\/[a-zA-Z0-9_-]+\.jpg$/);
    expect(b).toMatch(/^listings\/user-1\/[a-zA-Z0-9_-]+\.jpg$/);
    expect(a).not.toBe(b);
  });
});

describe('buildProfilePhotoObjectKey', () => {
  it('uses profiles prefix', () => {
    const k = buildProfilePhotoObjectKey('user-1', 'image/png');
    expect(k).toMatch(/^profiles\/user-1\/[a-zA-Z0-9_-]+\.png$/);
  });
});

describe('objectKeyOwnedByUser', () => {
  it('accepts owned listing key', () => {
    expect(objectKeyOwnedByUser('listings/u1/a.jpg', 'u1', 'listing-photo')).toBe(true);
  });

  it('rejects wrong user prefix', () => {
    expect(objectKeyOwnedByUser('listings/u1/a.jpg', 'u2', 'listing-photo')).toBe(false);
  });

  it('rejects nested paths under user prefix', () => {
    expect(objectKeyOwnedByUser('listings/u1/sub/a.jpg', 'u1', 'listing-photo')).toBe(false);
  });
});
