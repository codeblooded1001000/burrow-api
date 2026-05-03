export const SESSION_COOKIE_NAME = 'burrow_session';

export const OTP_PURPOSES = [
  'signup',
  'recover-email',
  'recover-phone',
  'email-rebind',
  'verify-phone',
] as const; // email-rebind: new address during phone recovery; verify-phone: add phone on account
export type OtpPurpose = (typeof OTP_PURPOSES)[number];
