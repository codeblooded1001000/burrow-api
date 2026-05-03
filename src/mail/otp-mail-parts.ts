import type { MailSendOtpParams, MailSendParams } from './mail.service';

/** Shared OTP email content for Resend and SMTP transports. */
export function buildOtpMailSendParams(params: MailSendOtpParams): MailSendParams {
  const subject = 'Your Burrow verification code';
  const html = `
<p style="font-family:system-ui,sans-serif;font-size:16px;color:#1A1A1A;line-height:1.5">
Your Burrow code is <strong>${params.otp}</strong>. Valid for 10 minutes.
</p>
<p style="font-family:system-ui,sans-serif;font-size:14px;color:#6B6B6B">
If you did not request this, you can ignore this message.
</p>
`.trim();
  return {
    to: params.to,
    subject,
    html,
    text: `Your Burrow code is ${params.otp}. Valid for 10 minutes.`,
  };
}
