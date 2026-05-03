import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

/** Build SMTP transporter when `SMTP_HOST` is set; otherwise `null`. */
export function createSmtpTransporter(config: ConfigService<Env, true>): Transporter | null {
  const host = config.get('SMTP_HOST', { infer: true });
  if (host.length === 0) return null;

  const portRaw = config.get('SMTP_PORT', { infer: true });
  const parsedPort = portRaw.length > 0 ? Number.parseInt(portRaw, 10) : 587;
  const port = Number.isFinite(parsedPort) ? parsedPort : 587;
  const user = config.get('SMTP_USER', { infer: true });
  const pass = config.get('SMTP_PASS', { infer: true });
  const secureRaw = config.get('SMTP_SECURE', { infer: true });
  const secure = secureRaw === 'true' || port === 465;

  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth:
      user.length > 0 && pass.length > 0
        ? {
            user,
            pass,
          }
        : undefined,
  });
}
