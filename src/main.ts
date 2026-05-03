import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureHttpApp } from './bootstrap/configure-http-app';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureHttpApp(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService<Env, true>);
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const ap = config.get('ADMIN_PASSWORD', { infer: true });
    if (ap.length < 16) {
      app.get(Logger).warn(
        'ADMIN_PASSWORD is missing or shorter than 16 characters — set a strong value for /admin/login before production.',
      );
    }
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  // PinoLogger is request-scoped; use Nest's LoggerService binding from nestjs-pino here.
  app.get(Logger).log({ port }, 'burrow_api_listening');
}

void bootstrap();
