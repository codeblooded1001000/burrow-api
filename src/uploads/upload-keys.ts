import { randomBytes } from 'node:crypto';

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

function newUploadObjectId(): string {
  return randomBytes(16).toString('base64url');
}

export type UploadObjectKind = 'listing-photo' | 'profile-photo';

export function fileExtFromImageContentType(contentType: ImageContentType): 'jpg' | 'png' | 'webp' {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  return 'webp';
}

export function buildListingPhotoObjectKey(userId: string, contentType: ImageContentType): string {
  const ext = fileExtFromImageContentType(contentType);
  return `listings/${userId}/${newUploadObjectId()}.${ext}`;
}

export function buildProfilePhotoObjectKey(userId: string, contentType: ImageContentType): string {
  const ext = fileExtFromImageContentType(contentType);
  return `profiles/${userId}/${newUploadObjectId()}.${ext}`;
}

/** True if `key` is under `listings/{userId}/` or `profiles/{userId}/` with a single filename segment. */
export function objectKeyOwnedByUser(key: string, userId: string, type: UploadObjectKind): boolean {
  const prefix = type === 'listing-photo' ? `listings/${userId}/` : `profiles/${userId}/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return rest.length > 0 && !rest.includes('/');
}
