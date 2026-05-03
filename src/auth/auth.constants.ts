export const SESSION_COOKIE_NAME = 'burrow_session';

/** OTP code lifetime in seconds (Redis key TTL; keep email-rebind sidecar TTL in sync). */
export const OTP_TTL_SEC = 900;
/** Minimum gap between resend requests for the same active OTP. */
export const RESEND_COOLDOWN_MS = 45_000;
/** Resends allowed before user must wait for OTP expiry / a new issue cycle. */
export const MAX_RESENDS = 6;
/** Successful deliveries per identifier per purpose in a rolling hour (abuse backstop). */
export const MAX_OTP_REQUESTS_PER_HOUR = 15;
/** Wrong-code attempts before OTP is invalidated. */
export const MAX_VERIFY_ATTEMPTS = 5;

export const OTP_PURPOSES = [
  'signup',
  'recover-email',
  'recover-phone',
  'email-rebind',
  'verify-phone',
] as const; // email-rebind: new address during phone recovery; verify-phone: add phone on account
export type OtpPurpose = (typeof OTP_PURPOSES)[number];
