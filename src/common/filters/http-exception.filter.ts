import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  if (!('error' in value)) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  return 'code' in err && 'message' in err && typeof (err as { code: unknown }).code === 'string';
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(HttpExceptionFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      const flat = zodError.flatten();
      const body: ErrorBody = {
        error: {
          code: 'INVALID_INPUT',
          message: 'Request validation failed',
          details: {
            formErrors: flat.formErrors,
            fieldErrors: flat.fieldErrors,
          },
        },
      };
      res.status(HttpStatus.BAD_REQUEST).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (hasRetryAfterPayload(raw)) {
        res.setHeader('Retry-After', String(raw.retryAfter));
        res.status(status).json({ error: raw.error });
        return;
      }
      if (isErrorBody(raw)) {
        res.status(status).json(raw);
        return;
      }
      const message = extractHttpExceptionMessage(raw, exception.message);
      const code = status === 404 ? 'NOT_FOUND' : mapStatusToCode(status);
      res.status(status).json({ error: { code, message } });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        res.status(HttpStatus.CONFLICT).json({
          error: {
            code: 'CONFLICT',
            message: 'A record with this value already exists',
          },
        });
        return;
      }
      if (exception.code === 'P2025') {
        res.status(HttpStatus.NOT_FOUND).json({
          error: { code: 'NOT_FOUND', message: 'Record not found' },
        });
        return;
      }
    }

    this.logger.error({ err: exception }, 'unhandled exception');
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL',
        message: 'An unexpected error occurred',
      },
    });
  }
}

function hasRetryAfterPayload(raw: unknown): raw is { error: ErrorBody['error']; retryAfter: number } {
  if (typeof raw !== 'object' || raw === null) return false;
  const o = raw as Record<string, unknown>;
  return typeof o.retryAfter === 'number' && typeof o.error === 'object' && o.error !== null;
}

function hasMessageField(obj: object): obj is { message: unknown } {
  return 'message' in obj;
}

function extractHttpExceptionMessage(raw: string | object, fallback: string): string {
  if (typeof raw === 'string') return raw;
  if (hasMessageField(raw)) {
    const msg = raw.message;
    if (typeof msg === 'string') return msg;
    if (Array.isArray(msg)) return msg.filter((m): m is string => typeof m === 'string').join(', ');
  }
  return fallback;
}

function mapStatusToCode(status: number): string {
  if (status === 400) return 'INVALID_INPUT';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 423) return 'ACCOUNT_LOCKED';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 503) return 'SERVICE_DEGRADED';
  return 'INTERNAL';
}
