import { SetMetadata } from '@nestjs/common';

/** Metadata marker for admin-only routes (used with {@link AdminAuthGuard}). */
export const IS_ADMIN_ROUTE_KEY = 'burrow:isAdminRoute';

export const AdminOnly = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_ADMIN_ROUTE_KEY, true);
