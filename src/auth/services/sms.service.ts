import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';

@Injectable()
export class SmsService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    @InjectPinoLogger(SmsService.name) private readonly logger: PinoLogger,
  ) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const authKey = this.config.get('MSG91_AUTH_KEY', { infer: true });
    const templateId = this.config.get('MSG91_FLOW_TEMPLATE_ID', { infer: true }).trim();
    if (!authKey || !templateId) {
      this.logger.warn('MSG91 not configured; SMS not sent');
      throw new Error('SMS_NOT_CONFIGURED');
    }
    const mobile = phone.replace(/^\+/, '');
    const body = {
      template_id: templateId,
      short_url: '0',
      recipients: [{ mobiles: mobile, OTP: otp }],
    };
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: authKey,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.warn({ status: res.status, body: text }, 'msg91_send_failed');
      throw new Error('SMS_SEND_FAILED');
    }
    this.logger.info({ phone: createHash('sha256').update(phone).digest('hex').slice(0, 12) }, 'msg91_send_ok');
  }
}
