import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';

/** Fixed OTP for allowlisted demo accounts (no email/SMS in bypass mode). */
export const DEMO_STATIC_OTP = '347612';

/** Fixed PIN for seeded demo accounts (argon2-hashed in DB). */
export const DEMO_STATIC_PIN = '347612';

const DEMO_BYPASS_EMAILS = new Set([
  'pushpander@alt-mobility.com',
  'prince@alt-mobility.com',
]);

export function isDemoBypassEmail(email: string): boolean {
  return DEMO_BYPASS_EMAILS.has(email.trim().toLowerCase());
}

/** True when identifier looks like an email on the demo bypass list. */
export function isDemoBypassIdentifier(identifier: string): boolean {
  if (!identifier.includes('@')) return false;
  return isDemoBypassEmail(identifier);
}

/**
 * In non-production, static OTP/PIN bypass is allowed for demo emails.
 * In production, set `DEMO_AUTH_BYPASS=true` explicitly (demo/staging only).
 */
export function demoAuthBypassRuntime(config: ConfigService<Env, true>): boolean {
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  if (nodeEnv !== 'production') return true;
  return config.get('DEMO_AUTH_BYPASS', { infer: true }).toLowerCase() === 'true';
}

export function shouldSkipDemoOutboundMail(config: ConfigService<Env, true>, email: string): boolean {
  return demoAuthBypassRuntime(config) && isDemoBypassEmail(email);
}
