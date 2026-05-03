import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../services/session.service';
import { mapUserToDto } from '../user-mapper';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{ cookies?: Record<string, string>; user?: unknown }>();
    const token = this.session.readSessionCookie(req);
    if (!token) {
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }
    let sub: string;
    try {
      ({ sub } = this.session.verifySessionToken(token));
    } catch {
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED', message: 'Your session has expired. Sign in again.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const user = await this.prisma.user.findFirst({
      where: { id: sub, deletedAt: null },
      include: { profile: true, listing: true },
    });
    if (!user) {
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED', message: 'Your session is no longer valid.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }
    req.user = mapUserToDto(user, user.profile, user.listing, this.config.get('R2_PUBLIC_URL', { infer: true }));
    return true;
  }
}
