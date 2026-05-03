import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { ConsoleMailService } from './console-mail.service';
import { MailService } from './mail.service';
import { NodemailerMailService } from './nodemailer-mail.service';
import { ResendSmtpFallbackMailService } from './resend-smtp-fallback-mail.service';

@Global()
@Module({
  providers: [
    {
      provide: MailService,
      useFactory: (config: ConfigService<Env, true>) => {
        const resendKey = config.get('RESEND_API_KEY', { infer: true });
        if (resendKey.length > 0) {
          return new ResendSmtpFallbackMailService(config);
        }
        const smtpHost = config.get('SMTP_HOST', { infer: true });
        if (smtpHost.length > 0) {
          return new NodemailerMailService(config);
        }
        return new ConsoleMailService();
      },
      inject: [ConfigService],
    },
  ],
  exports: [MailService],
})
export class MailModule {}
