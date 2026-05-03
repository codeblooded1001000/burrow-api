import { Injectable, Logger } from '@nestjs/common';
import { MailService, type MailSendOtpParams, type MailSendParams } from './mail.service';

@Injectable()
export class ConsoleMailService extends MailService {
  private readonly log = new Logger(ConsoleMailService.name);

  send(params: MailSendParams): Promise<void> {
    this.log.log(`mail_console_send to=${params.to} subject=${params.subject}`);
    return Promise.resolve();
  }

  sendOtp(params: MailSendOtpParams): Promise<void> {
    this.log.log(`mail_console_send_otp to=${params.to} purpose=${params.purpose}`);
    return Promise.resolve();
  }
}
