import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createGlobalZodPipe } from '../common/pipes/global-zod.pipe';
import { DEFAULT_CORS_ORIGIN, type Env } from '../config/env.schema';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Each `*` matches one dot-separated hostname label (e.g. `https://*.vercel.app`). */
function wildcardEntryToRegex(entry: string): RegExp {
  const parts = entry.split('*');
  let body = '';
  for (let i = 0; i < parts.length; i++) {
    body += escapeRegExp(parts[i] ?? '');
    if (i < parts.length - 1) {
      body += '[^.]+';
    }
  }
  return new RegExp(`^${body}$`);
}

function parseCorsAllowlist(raw: string): { exacts: Set<string>; wildcards: RegExp[] } {
  const exacts = new Set<string>();
  const wildcards: RegExp[] = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (entry.includes('*')) {
      wildcards.push(wildcardEntryToRegex(entry));
    } else {
      exacts.add(entry);
    }
  }
  return { exacts, wildcards };
}

function createCorsOriginDelegate(
  rawAllowlist: string,
): (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void {
  const { exacts, wildcards } = parseCorsAllowlist(rawAllowlist);
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (exacts.has(origin) || wildcards.some((r) => r.test(origin))) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}

export function configureHttpApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  const httpApp = app.getHttpAdapter().getInstance() as { set?: (key: string, value: unknown) => void };
  httpApp.set?.('trust proxy', 1);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createGlobalZodPipe());
  app.use(cookieParser());
  app.use(helmet());
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });
  const allowlistRaw = corsOrigin.length > 0 ? corsOrigin : DEFAULT_CORS_ORIGIN;
  app.enableCors({
    origin: createCorsOriginDelegate(allowlistRaw),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}
