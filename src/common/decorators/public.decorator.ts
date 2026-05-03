import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'burrow:isPublic';

/** Marks a route as public (no JWT) when AuthGuard is wired in prompt 02. */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);
