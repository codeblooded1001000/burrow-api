import { Body, Controller, Get, Post, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { AuthIpRateLimitInterceptor } from './interceptors/auth-ip-rate-limit.interceptor';
import type { UserDto } from './schemas/auth.schemas';
import {
  ConfirmNewEmailBodyDto,
  LoginBodyDto,
  ManualReviewBodyDto,
  PhoneRequestOtpBodyDto,
  PhoneUpdateEmailBodyDto,
  PhoneVerifyBodyDto,
  RecoverRequestOtpBodyDto,
  RecoverVerifyAndResetBodyDto,
  SignupRequestOtpBodyDto,
  SignupSetPinBodyDto,
  SignupVerifyOtpBodyDto,
} from './schemas/auth.schemas';

@Controller('auth')
@UseInterceptors(AuthIpRateLimitInterceptor)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup/request-otp')
  signupRequestOtp(@Body() dto: SignupRequestOtpBodyDto) {
    return this.auth.signupRequestOtp(dto);
  }

  @Public()
  @Post('signup/verify-otp')
  signupVerifyOtp(@Body() dto: SignupVerifyOtpBodyDto) {
    return this.auth.signupVerifyOtp(dto);
  }

  @Public()
  @Post('signup/set-pin')
  signupSetPin(@Body() dto: SignupSetPinBodyDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.signupSetPin(dto, res);
  }

  @Public()
  @Post('signup/manual-review')
  manualReview(@Body() dto: ManualReviewBodyDto) {
    return this.auth.manualReview(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginBodyDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, res);
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    return this.auth.logout(res);
  }

  @Public()
  @Post('recover/request-otp')
  recoverRequestOtp(@Body() dto: RecoverRequestOtpBodyDto) {
    return this.auth.recoverRequestOtp(dto);
  }

  @Public()
  @Post('recover/verify-and-reset')
  recoverVerifyAndReset(@Body() dto: RecoverVerifyAndResetBodyDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.recoverVerifyAndReset(dto, res);
  }

  @Public()
  @Post('recover/phone-request-otp')
  phoneRequestOtp(@Body() dto: PhoneRequestOtpBodyDto) {
    return this.auth.phoneRequestOtp(dto);
  }

  @Public()
  @Post('recover/phone-verify')
  phoneVerify(@Body() dto: PhoneVerifyBodyDto) {
    return this.auth.phoneVerify(dto);
  }

  @Public()
  @Post('recover/phone-update-email')
  phoneUpdateEmail(@Body() dto: PhoneUpdateEmailBodyDto) {
    return this.auth.phoneUpdateEmail(dto);
  }

  /** Completes phone recovery email change after OTP is sent to the new address. */
  @Public()
  @Post('recover/confirm-new-email')
  confirmNewEmail(@Body() dto: ConfirmNewEmailBodyDto) {
    return this.auth.confirmNewEmail(dto);
  }

  @Get('me')
  me(@CurrentUser() user: UserDto) {
    return this.auth.getMe(user.id);
  }
}
