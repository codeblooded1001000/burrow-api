import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const emailField = z
  .string()
  .email()
  .transform((e) => e.trim().toLowerCase());

const pinSix = z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits');

const otpSix = z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits');

export const SignupRequestOtpSchema = z.object({
  email: emailField,
});
export class SignupRequestOtpBodyDto extends createZodDto(SignupRequestOtpSchema) {}

export const SignupVerifyOtpSchema = z.object({
  email: emailField,
  otp: otpSix,
});
export class SignupVerifyOtpBodyDto extends createZodDto(SignupVerifyOtpSchema) {}

export const SignupSetPinSchema = z.object({
  signupToken: z.string().min(1),
  pin: pinSix,
  confirmPin: pinSix,
});
export class SignupSetPinBodyDto extends createZodDto(SignupSetPinSchema) {}

export const LoginSchema = z.object({
  email: emailField,
  pin: pinSix,
});
export class LoginBodyDto extends createZodDto(LoginSchema) {}

export const RecoverRequestOtpSchema = z.object({
  email: emailField,
});
export class RecoverRequestOtpBodyDto extends createZodDto(RecoverRequestOtpSchema) {}

export const RecoverVerifyAndResetSchema = z
  .object({
    email: emailField,
    otp: otpSix,
    newPin: pinSix,
    confirmNewPin: pinSix,
  })
  .refine((d) => d.newPin === d.confirmNewPin, {
    message: 'PINs do not match',
    path: ['confirmNewPin'],
  });
export class RecoverVerifyAndResetBodyDto extends createZodDto(RecoverVerifyAndResetSchema) {}

export const PhoneRequestOtpSchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+91[6-9]\d{9}$/, 'Phone must be E.164 +91 followed by 10 digits'),
});
export class PhoneRequestOtpBodyDto extends createZodDto(PhoneRequestOtpSchema) {}

export const PhoneVerifySchema = z.object({
  phoneNumber: z.string().regex(/^\+91[6-9]\d{9}$/),
  otp: otpSix,
});
export class PhoneVerifyBodyDto extends createZodDto(PhoneVerifySchema) {}

export const PhoneUpdateEmailSchema = z.object({
  recoveryToken: z.string().min(1),
  newEmail: emailField,
});
export class PhoneUpdateEmailBodyDto extends createZodDto(PhoneUpdateEmailSchema) {}

/** Completes phone recovery email change after OTP is sent to the new address. */
export const ConfirmNewEmailSchema = z.object({
  recoveryToken: z.string().min(1),
  newEmail: emailField,
  otp: otpSix,
});
export class ConfirmNewEmailBodyDto extends createZodDto(ConfirmNewEmailSchema) {}

export const ManualReviewSchema = z.object({
  email: emailField,
  companyClaim: z.string().min(1).max(500),
});
export class ManualReviewBodyDto extends createZodDto(ManualReviewSchema) {}

export const UserRoleDtoSchema = z.enum(['LISTER', 'SEEKER', 'BOTH']).nullable();

export const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: UserRoleDtoSchema,
  companyName: z.string(),
  companyVerified: z.boolean(),
  hasProfile: z.boolean(),
  hasListing: z.boolean(),
  profileCompletion: z.number().int().min(0).max(100),
  createdAt: z.string(),
  /** From profile when present; for client display (initials, header avatar). */
  fullName: z.string().nullable(),
  photoUrl: z.string().nullable(),
});

export type UserDto = z.infer<typeof UserDtoSchema>;
