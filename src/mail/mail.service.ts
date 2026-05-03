import { Injectable } from '@nestjs/common';

export interface MailSendParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type OtpMailPurpose = 'signup' | 'recover' | 'manual-review' | 'email-change';

export interface MailSendOtpParams {
  to: string;
  otp: string;
  purpose: OtpMailPurpose;
}

@Injectable()
export abstract class MailService {
  abstract send(params: MailSendParams): Promise<void>;

  abstract sendOtp(params: MailSendOtpParams): Promise<void>;
}
