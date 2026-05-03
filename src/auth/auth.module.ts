import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthIpRateLimitInterceptor } from './interceptors/auth-ip-rate-limit.interceptor';
import { DomainService } from './services/domain.service';
import { OtpService } from './services/otp.service';
import { PinService } from './services/pin.service';
import { SessionService } from './services/session.service';
import { SmsService } from './services/sms.service';
import { PinStrategy } from './strategies/pin.strategy';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    DomainService,
    OtpService,
    PinService,
    PinStrategy,
    SessionService,
    SmsService,
    AuthIpRateLimitInterceptor,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [DomainService, SessionService, OtpService, SmsService, PinService],
})
export class AuthModule {}
