import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const otpSix = z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits');
const pinSix = z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits');

export const DeleteMeSchema = z.object({
  pin: pinSix,
});

export class DeleteMeBodyDto extends createZodDto(DeleteMeSchema) {}

export type DeleteMeBody = z.infer<typeof DeleteMeSchema>;

export const PatchMeRoleSchema = z.object({
  role: z.enum(['LISTER', 'SEEKER', 'BOTH']),
});

export class PatchMeRoleBodyDto extends createZodDto(PatchMeRoleSchema) {}

export const PatchMePhoneSchema = z.object({
  phoneNumber: z.string().regex(/^\+91[6-9]\d{9}$/, 'Phone must be E.164 +91 followed by 10 digits'),
});

export class PatchMePhoneBodyDto extends createZodDto(PatchMePhoneSchema) {}

export const PostMePhoneVerifySchema = z.object({
  otp: otpSix,
});

export class PostMePhoneVerifyBodyDto extends createZodDto(PostMePhoneVerifySchema) {}

export type PatchMeRoleBody = z.infer<typeof PatchMeRoleSchema>;
export type PatchMePhoneBody = z.infer<typeof PatchMePhoneSchema>;
export type PostMePhoneVerifyBody = z.infer<typeof PostMePhoneVerifySchema>;
