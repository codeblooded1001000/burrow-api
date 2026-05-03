import type { UserDto } from '../auth/schemas/auth.schemas';

declare global {
  namespace Express {
    interface Request {
      /** Populated by JwtAuthGuard after session verification */
      user?: UserDto;
    }
  }
}

export {};
