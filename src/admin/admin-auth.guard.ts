import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AdminTokenService } from './admin-token.service';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly tokens: AdminTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    const raw = req.headers?.['x-admin-token'];
    const headerVal = Array.isArray(raw) ? raw[0] : raw;
    if (typeof headerVal !== 'string' || headerVal.trim().length === 0) {
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED', message: 'Missing X-Admin-Token header.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const trimmed = headerVal.trim();
    const token = trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
    if (token.length === 0) {
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED', message: 'Missing admin token.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.tokens.verify(token);
    return true;
  }
}
