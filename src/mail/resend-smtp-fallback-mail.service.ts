import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import type { Env } from '../config/env.schema';
import { MailService, type MailSendOtpParams, type MailSendParams } from './mail.service';
import { buildOtpMailSendParams } from './otp-mail-parts';
import { sendWithResend } from './resend-send';
import { createSmtpTransporter } from './smtp-transport';

/**
 * Tries Resend first. On any failure, sends the same message via Nodemailer when
 * `SMTP_HOST` (and optional auth) are configured.
 */
@Injectable()
export class ResendSmtpFallbackMailService extends MailService {
  private readonly log = new Logger(ResendSmtpFallbackMailService.name);
  private readonly resend: Resend;
  private readonly smtp: Transporter | null;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
    const key = this.config.get('RESEND_API_KEY', { infer: true });
    this.resend = new Resend(key);
    this.smtp = createSmtpTransporter(config);
  }

  async send(params: MailSendParams): Promise<void> {
    const from = this.config.get('EMAIL_FROM', { infer: true });
    try {
      await sendWithResend(this.resend, from, params);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`Resend failed (${msg}).`);
    }
    if (!this.smtp) {
      this.log.warn('SMTP fallback not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS as needed).');
      throw new Error('MAIL_SEND_FAILED');
    }
    try {
      await this.smtp.sendMail({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      this.log.log('Mail delivered via SMTP fallback after Resend failure.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`SMTP fallback failed (${msg}).`);
      throw new Error('MAIL_SEND_FAILED');
    }
  }

  async sendOtp(params: MailSendOtpParams): Promise<void> {
    await this.send(buildOtpMailSendParams(params));
  }
}
