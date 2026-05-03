# Runbook

## Deploy (Railway)

1. Create a Railway project with a **Node** service pointing at this repo (`burrow-api` root).
2. Provision **PostgreSQL** (or connect Neon) and **Redis** (managed Redis URL).
3. Set every variable from `.env.example` in Railway project settings. Use production values: strong `JWT_SECRET` / `OTP_HMAC_SECRET`, real `RESEND_API_KEY`, `CORS_ORIGIN=https://burrow.in` (or your web origin), `NODE_ENV=production`, `PORT` as provided by Railway.
4. Build command: `npm ci && npx prisma migrate deploy && npm run build`.
5. Start command: `npm run start`.
6. After first deploy, run allowlist seed if needed: `npm run seed` from a one-off job or local machine pointed at prod `DATABASE_URL` (use caution).

## Local seed data

`prisma/seed.ts` always upserts **`CompanyAllowlist`** from `src/auth/data/company-allowlist.json`.

**Optional dev users** (profiles, listings, one block row, one onboarding-only user) run only when:

- `SEED_USERS=true`, and
- `NODE_ENV=development`, **or** `SEED_ALLOW_NON_DEV=true` (for a non-prod DB you connect manually).

```bash
cd burrow-api
NODE_ENV=development SEED_USERS=true npm run seed
```

- **PIN for all seed logins:** `847291` (six digits; matches app Argon2id params).
- **Emails:** `alice.seed@infosys.com` … `grace.seed@deloitte.com` (see `SEED_USERS_CONFIG` in `prisma/seed.ts`), plus `onboarding.seed@accenture.com` (ONBOARDING, no profile).
- **Block demo:** Bob (TCS) has blocked Alice (Infosys); when Alice is authenticated, `GET /api/v1/profiles/{bobUserId}` returns `404`.

## Environment checklist

- `DATABASE_URL` / `DIRECT_URL` — Postgres (with `?connection_limit=` tuned for serverless if applicable).
- `REDIS_URL` — TLS URL in prod if your provider requires it.
- `JWT_SECRET`, `OTP_HMAC_SECRET` — rotate on incident.
- `RESEND_API_KEY`, `EMAIL_FROM` — verified sender domain in Resend. If Resend rejects the send (common in dev: `EMAIL_FROM` uses `gmail.com` but only your own domain is verified), configure **`SMTP_*`** so the API retries the same message via Nodemailer. With `RESEND_API_KEY` set, SMTP is **fallback only**; without Resend key but with `SMTP_HOST`, mail goes **SMTP only**.
- `MSG91_*` — only needed when phone recovery ships.
- `R2_*`, `GOOGLE_MAPS_API_KEY` — when uploads/maps prompts land.
- `SENTRY_DSN_API` — optional until observability prompt; leave blank if unused.
- `ADMIN_PASSWORD` — protect admin routes when implemented.

## Manual review queue (domain verification)

1. User submits non-allowlisted corporate domain → `ManualReviewRequest` row (prompt 03+).
2. Ops opens admin queue (prompt 06), validates employment signal out-of-band.
3. On approval: mark request approved, insert `CompanyAllowlist` domain, mark user `companyVerified`, send welcome email via `MailService`.

## Incident response (basics)

1. **API unhealthy** — check `/api/v1/health` for `db` / `redis`; verify Railway/Neon/Redis status pages.
2. **Auth spike / abuse** — tighten rate limits in Redis (prompt 02), consider temporary IP throttling at edge.
3. **Data incident** — rotate secrets, invalidate sessions (future: token version or global logout), preserve audit logs.
