/**
 * Personal / consumer domains rejected at signup (BURROW_MASTER_SPEC).
 * Also unioned with `disposable-email-domains` package at runtime.
 */
export const STATIC_EMAIL_BLOCKLIST: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'tutanota.com',
  'tuta.io',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
] as const;
