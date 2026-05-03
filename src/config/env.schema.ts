import { z } from 'zod';

/** Default when `CORS_ORIGIN` is unset or empty (local `burrow-web`). Production must set `CORS_ORIGIN` explicitly. */
export const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

/** Required to boot: DB and cache. */
const required = (name: string) =>
  z
    .string()
    .min(1, `${name} is required`)
    .transform((v) => v.trim());

/**
 * Optional at boot — empty if unset. Auth, mail, R2, maps, etc. validate these
 * when those features run (later modules), not at process startup.
 */
const optionalAtBoot = z
  .union([z.string(), z.undefined()])
  .transform((v) => (typeof v === 'string' ? v.trim() : ''));

export const envSchema = z
  .object({
    DATABASE_URL: required('DATABASE_URL'),
    DIRECT_URL: required('DIRECT_URL'),
    REDIS_URL: required('REDIS_URL'),
    CORS_ORIGIN: optionalAtBoot,
    JWT_SECRET: optionalAtBoot,
    OTP_HMAC_SECRET: optionalAtBoot,
    ADMIN_PASSWORD: optionalAtBoot,
    RESEND_API_KEY: optionalAtBoot,
    EMAIL_FROM: optionalAtBoot,
    /** SMTP fallback when Resend fails (e.g. unverified `EMAIL_FROM` domain). */
    SMTP_HOST: optionalAtBoot,
    SMTP_PORT: optionalAtBoot,
    SMTP_USER: optionalAtBoot,
    SMTP_PASS: optionalAtBoot,
    SMTP_SECURE: optionalAtBoot,
    MSG91_AUTH_KEY: optionalAtBoot,
    MSG91_SENDER_ID: optionalAtBoot,
    MSG91_FLOW_TEMPLATE_ID: optionalAtBoot,
    R2_ACCOUNT_ID: optionalAtBoot,
    R2_ACCESS_KEY_ID: optionalAtBoot,
    R2_SECRET_ACCESS_KEY: optionalAtBoot,
    R2_BUCKET_NAME: optionalAtBoot,
    R2_PUBLIC_URL: optionalAtBoot,
    GOOGLE_MAPS_API_KEY: optionalAtBoot,
    /** Optional cap on Distance Matrix calls per UTC day (default 1000). */
    MAPS_DAILY_BUDGET: optionalAtBoot,
    /** Max signed upload URL generations per user per UTC clock hour (default 30). */
    UPLOAD_URL_GEN_PER_HOUR: optionalAtBoot,
    SENTRY_DSN_API: optionalAtBoot,
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    SEED_USERS: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && data.CORS_ORIGIN.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: `CORS_ORIGIN is required in production (e.g. https://burrow.in). See .env.example.`,
      });
    }
    if (data.NODE_ENV === 'production') {
      const ap = data.ADMIN_PASSWORD;
      if (ap.length < 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_PASSWORD'],
          message: `ADMIN_PASSWORD is required in production and must be at least 16 characters.`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const key = first.path.join('.') || first.message;
    throw new Error(`Missing env var: ${key}. See .env.example.`);
  }
  return parsed.data;
}
