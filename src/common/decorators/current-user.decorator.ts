import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserDto } from '../../auth/schemas/auth.schemas';

interface RequestWithUser {
  user?: UserDto;
}

/** Resolves the authenticated user from the request (JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserDto | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    return req.user;
  },
);
