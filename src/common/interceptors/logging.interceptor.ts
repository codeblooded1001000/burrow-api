import {
  HttpException,
  Injectable,
  NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(@InjectPinoLogger(LoggingInterceptor.name) private readonly logger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<{ statusCode: number }>();
          this.logger.info(
            {
              method: req.method,
              url: req.url,
              statusCode: res.statusCode,
              durationMs: Date.now() - start,
            },
            'http_request',
          );
        },
        error: (err: unknown) => {
          if (err instanceof HttpException) {
            return;
          }
          this.logger.warn(
            {
              err,
              method: req.method,
              url: req.url,
              durationMs: Date.now() - start,
            },
            'http_request_error',
          );
        },
      }),
    );
  }
}
