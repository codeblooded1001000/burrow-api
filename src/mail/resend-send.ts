import { Resend } from 'resend';
import type { MailSendParams } from './mail.service';

/** Sends via Resend; throws with Resend's message on failure (no secrets in message). */
export async function sendWithResend(resend: InstanceType<typeof Resend>, from: string, params: MailSendParams): Promise<void> {
  const { error } = await resend.emails.send({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
  if (error) {
    throw new Error(error.message);
  }
}
