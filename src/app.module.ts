import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AuthModule } from './auth/auth.module';
import { BrowseModule } from './browse/browse.module';
import { ConstantsModule } from './constants/constants.module';
import { HealthModule } from './health/health.module';
import { ListingsModule } from './listings/listings.module';
import { ProfilesModule } from './profiles/profiles.module';
import { UsersModule } from './users/users.module';
import { MailModule } from './mail/mail.module';
import { MessagingModule } from './messaging/messaging.module';
import { SafetyModule } from './safety/safety.module';
import { AdminModule } from './admin/admin.module';
import { MapsModule } from './maps/maps.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.body.pin',
            'req.body.otp',
            'req.body.newPin',
            'req.body.confirmPin',
            'req.body.confirmNewPin',
            'req.body.signupToken',
            'req.body.recoveryToken',
            'req.headers.x-admin-token',
          ],
          remove: true,
        },
        transport:
          process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              },
      },
    }),
    AppConfigModule,
    PrismaModule,
    RedisModule,
    UploadsModule,
    MailModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    ListingsModule,
    BrowseModule,
    MessagingModule,
    SafetyModule,
    AdminModule,
    MapsModule,
    ConstantsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
