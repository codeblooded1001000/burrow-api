# Burrow API

NestJS 10 backend for **Burrow** — a flatmate-finder web app for verified corporate professionals in Gurgaon. Product rules and the data model live in `BURROW_MASTER_SPEC.md`. **API integration for the frontend is defined in [`API_CONTRACT.md`](./API_CONTRACT.md)** (the frontend repo should treat that file as the contract).

This repository is **standalone** (not a monorepo). The web app lives in a sibling repo (`burrow-web`).

## Prerequisites

- Node.js **20** (see `.nvmrc`)
- **npm** (lockfile: `package-lock.json`)
- **PostgreSQL 15** and **Redis 7** reachable from your machine (Docker is optional — use whatever you already run locally or in the cloud)

## Setup

1. Clone the repo and enter the directory:

   ```bash
   cd burrow-api
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run **PostgreSQL** and **Redis**, then put their URLs in `.env` (see step 4). If you like Docker, you can still use:

   ```bash
   docker compose up -d
   ```

4. Copy environment template and fill values (dummy strings are fine for local dev except URLs):

   ```bash
   cp .env.example .env
   ```

   Use at least:

   - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/burrow`
   - `DIRECT_URL=postgresql://postgres:postgres@localhost:5432/burrow`
   - `REDIS_URL=redis://localhost:6379`
   - `CORS_ORIGIN=http://localhost:3000`
   - Strong random strings for `JWT_SECRET` and `OTP_HMAC_SECRET`
   - Placeholder strings for keys you are not using yet (`RESEND_API_KEY`, `R2_*`, etc.)

5. Create schema and generate Prisma client:

   ```bash
   npm run prisma:migrate
   ```

6. Seed company allowlist (always) and optional dev users:

   ```bash
   NODE_ENV=development SEED_USERS=true npm run seed
   ```

   Allowlist only: `npm run seed` (skips dev users unless `SEED_USERS=true` and env above). Dev logins use PIN **`847291`** (see `prisma/seed.ts`).

7. Run the API (watch mode):

   ```bash
   npm run start:dev
   ```

8. Verify health:

   ```bash
   curl -s http://localhost:4000/api/v1/health | jq
   ```

## Environment variables

Every variable in [`.env.example`](./.env.example) is validated at startup (via Zod). If something is missing, the process exits with: `Missing env var: … See .env.example.`

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection URL |
| `DIRECT_URL` | Direct Postgres URL (e.g. Neon migrations) |
| `REDIS_URL` | Redis connection URL |
| `JWT_SECRET` | HS256 signing secret for session JWT (prompt 02) |
| `OTP_HMAC_SECRET` | HMAC secret for OTP hashing in Redis (prompt 02) |
| `ADMIN_PASSWORD` | Admin route protection (later prompts) |
| `RESEND_API_KEY` | Resend API key (prompt 02) |
| `EMAIL_FROM` | From address for transactional email |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | Optional Nodemailer fallback when Resend errors (e.g. unverified `EMAIL_FROM` domain). With `RESEND_API_KEY`, SMTP runs only after Resend fails. Without Resend key but with `SMTP_HOST`, mail is SMTP-only. For Gmail SMTP, set `EMAIL_FROM` to the same mailbox as `SMTP_USER`. |
| `MSG91_AUTH_KEY` / `MSG91_SENDER_ID` | SMS recovery (later prompts) |
| `R2_*` | Cloudflare R2 (upload prompt) |
| `GOOGLE_MAPS_API_KEY` | Maps / commute (later prompts) |
| `SENTRY_DSN_API` | Optional Sentry DSN for the API |
| `NODE_ENV` | `development` \| `production` \| `test` |
| `PORT` | HTTP port (default **4000**) |
| `CORS_ORIGIN` | Allowed browser origin (credentials). Empty in dev defaults to `http://localhost:3000`; required in production |
| `SEED_USERS` | `true` to upsert sample users when running `npm run seed` (needs `NODE_ENV=development` or `SEED_ALLOW_NON_DEV=true`) |
| `SEED_ALLOW_NON_DEV` | Set `true` only when pointing at a non-prod DB from a machine where `NODE_ENV` is not `development` |
| `UPDATE_LISTING_PHOTOS` | Set `true` to allow `npm run update-listing-photos` when `NODE_ENV` is not `development` |

## Common commands

| Command | Description |
| --- | --- |
| `npm run start:dev` | Nest watch mode (SWC) — main dev entry |
| `npm run dev` | Same as `start:dev` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled app |
| `npm run lint` | ESLint (flat config) |
| `npm run format` | Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest unit tests |
| `npm run test:e2e` | Jest e2e (expects `.env` + Docker DBs) |
| `npm run prisma:generate` | `prisma generate` |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:studio` | Prisma Studio |
| `npm run seed` | Run `prisma/seed.ts` |
| `npm run update-listing-photos` | Set every listing’s `photos` to the curated URLs in `src/dev-seed/seed-listing-photos.ts` (dev by default; set `UPDATE_LISTING_PHOTOS=true` otherwise) |
| `npm run db:reset` | Interactive wrapper around `prisma migrate reset` |

## Documentation

- [`API_CONTRACT.md`](./API_CONTRACT.md) — implemented endpoints and error shapes
- [`SCHEMAS_CHANGELOG.md`](./SCHEMAS_CHANGELOG.md) — breaking API changes
- [`docs/architecture.md`](./docs/architecture.md) — high-level flows
- [`docs/runbook.md`](./docs/runbook.md) — deploy and operations

## License

Proprietary — All rights reserved.
