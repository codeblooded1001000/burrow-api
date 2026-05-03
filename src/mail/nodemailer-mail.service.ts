import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import type { Env } from '../config/env.schema';
import { MailService, type MailSendOtpParams, type MailSendParams } from './mail.service';
import { buildOtpMailSendParams } from './otp-mail-parts';
import { createSmtpTransporter } from './smtp-transport';

@Injectable()
export class NodemailerMailService extends MailService {
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
    const t = createSmtpTransporter(config);
    if (!t) {
      throw new Error('NodemailerMailService requires SMTP_HOST');
    }
    this.transporter = t;
  }

  async send(params: MailSendParams): Promise<void> {
    const from = this.config.get('SMTP_USER', { infer: true });
    await this.transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  }

  async sendOtp(params: MailSendOtpParams): Promise<void> {
    await this.send(buildOtpMailSendParams(params));
  }
}
