import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import type { Env } from '../config/env.schema';
import { MailService, type MailSendOtpParams, type MailSendParams } from './mail.service';
import { buildOtpMailSendParams } from './otp-mail-parts';
import { sendWithResend } from './resend-send';
import { createSmtpTransporter } from './smtp-transport';

function recipientDomain(to: string): string {
  const i = to.lastIndexOf('@');
  if (i <= 0 || i === to.length - 1) return '(invalid-address)';
  return to.slice(i + 1).toLowerCase();
}

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

    const emailFrom = this.config.get('EMAIL_FROM', { infer: true });
    const smtpHost = this.config.get('SMTP_HOST', { infer: true });
    const smtpPort = this.config.get('SMTP_PORT', { infer: true });
    const smtpUser = this.config.get('SMTP_USER', { infer: true });
    const smtpPass = this.config.get('SMTP_PASS', { infer: true });
    this.log.log(
      [
        'mail_service_boot',
        `resendApiKeyConfigured=${key.length > 0}`,
        `resendApiKeyCharLength=${key.length}`,
        `emailFromCharLength=${emailFrom.length}`,
        `emailFrom=${emailFrom.length > 0 ? JSON.stringify(emailFrom) : '""'}`,
        `smtpHostConfigured=${smtpHost.length > 0}`,
        `smtpHost=${smtpHost.length > 0 ? JSON.stringify(smtpHost) : '""'}`,
        `smtpPortRaw=${smtpPort.length > 0 ? JSON.stringify(smtpPort) : '"587-default"'}`,
        `smtpTransporterCreated=${this.smtp !== null}`,
        `smtpUserConfigured=${smtpUser.length > 0}`,
        `smtpPassConfigured=${smtpPass.length > 0}`,
      ].join(' '),
    );
  }

  async send(params: MailSendParams): Promise<void> {
    const from = this.config.get('EMAIL_FROM', { infer: true });
    const smtpUser = this.config.get('SMTP_USER', { infer: true });
    const domain = recipientDomain(params.to);
    this.log.log(
      [
        'mail_send_attempt',
        `from=${JSON.stringify(from)}`,
        `recipientDomain=${JSON.stringify(domain)}`,
        `subjectPreview=${JSON.stringify(params.subject.slice(0, 80))}`,
      ].join(' '),
    );
    try {
      await sendWithResend(this.resend, from, params);
      this.log.log(`mail_resend_ok recipientDomain=${JSON.stringify(domain)}`);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(
        [
          'mail_resend_failed',
          `reason=${JSON.stringify(msg)}`,
          `from=${JSON.stringify(from)}`,
          `recipientDomain=${JSON.stringify(domain)}`,
        ].join(' '),
      );
    }
    if (!this.smtp) {
      this.log.warn(
        [
          'mail_smtp_fallback_missing',
          `from=${JSON.stringify(from)}`,
          `recipientDomain=${JSON.stringify(domain)}`,
          'hint=set SMTP_HOST (and SMTP_USER/SMTP_PASS if required)',
        ].join(' '),
      );
      throw new Error('MAIL_SEND_FAILED');
    }
    try {
      this.log.log(
        [
          'mail_smtp_fallback_attempt',
          `from=${JSON.stringify(from)}`,
          `recipientDomain=${JSON.stringify(domain)}`,
        ].join(' '),
      );
      await this.smtp.sendMail({
        from: smtpUser,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      this.log.log(
        ['mail_smtp_fallback_ok', `recipientDomain=${JSON.stringify(domain)}`].join(' '),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(
        [
          'mail_smtp_fallback_failed',
          `reason=${JSON.stringify(msg)}`,
          `from=${JSON.stringify(from)}`,
          `recipientDomain=${JSON.stringify(domain)}`,
        ].join(' '),
      );
      throw new Error('MAIL_SEND_FAILED');
    }
  }

  async sendOtp(params: MailSendOtpParams): Promise<void> {
    await this.send(buildOtpMailSendParams(params));
  }
}
