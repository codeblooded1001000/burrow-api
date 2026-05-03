import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createGlobalZodPipe } from '../common/pipes/global-zod.pipe';
import { DEFAULT_CORS_ORIGIN, type Env } from '../config/env.schema';

export function configureHttpApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createGlobalZodPipe());
  app.use(cookieParser());
  app.use(helmet());
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });
  const origin = corsOrigin.length > 0 ? corsOrigin : DEFAULT_CORS_ORIGIN;
  app.enableCors({
    origin,
    credentials: true,
  });
}
