# Burrow — Master Specification

> **This is the single source of truth.** Both backend and frontend Cursor sessions read this. Update this file before changing anything in code.

## Product

Burrow is a flatmate-finder web app for verified corporate professionals in Gurgaon, NCR, India. Every user signs up with a working corporate email; every profile is tied to a real company. Trust is the entire product wedge.

**Tagline:** Find your flatmate, verified.

**Launch city:** Gurgaon only. Localities served: Cyber City, Golf Course Road, Sohna Road, DLF Phase 1–5, Sushant Lok 1–3, Sectors 14, 23, 28, 29, 31, 38, 39, 42, 43, 44, 45, 46, 47, 48, 49, 50, 54, 56, 57, 65, 66, 67, 70, 82, 83, MG Road, Udyog Vihar, Galleria. (Curated list — single dropdown, no freeform.)

## Repository structure — TWO SEPARATE REPOS

This project uses two completely separate Git repositories:

```
~/code/
  burrow-api/                    ← BACKEND REPO (separate Git repo)
    src/
    prisma/
    scripts/
    API_CONTRACT.md              ← THE SHARED CONTRACT (lives here)
    SCHEMAS_CHANGELOG.md
    package.json
    .env.example
    Dockerfile
    docker-compose.yml
    README.md
    
  burrow-web/                    ← FRONTEND REPO (separate Git repo, sibling directory)
    src/
    public/
    package.json
    .env.local.example
    next.config.mjs
    tailwind.config.ts
    README.md
```

The two repos are siblings on disk so the frontend can reference the backend's `API_CONTRACT.md` via relative path during development (`../burrow-api/API_CONTRACT.md`).

## API contract pattern — how the two repos stay in sync

The single source of truth for API integration is `burrow-api/API_CONTRACT.md`. This is a markdown document that describes every endpoint: path, method, auth requirements, request body, response shape, errors.

**Discipline rule (non-negotiable):**

The contract is updated AFTER backend implements an endpoint, not before. Workflow:

1. Build the endpoint in NestJS with Zod validation
2. Test it works
3. Update `API_CONTRACT.md` with what was actually built
4. Commit both backend code and contract update together

This prevents drift between intent and reality. Don't write speculative contract entries for endpoints that don't exist yet.

**Contract format (template per endpoint):**

```markdown
### POST /auth/signup/request-otp

**Auth:** None (public)
**Rate limit:** 5 requests / hour / email

**Request body:**
\`\`\`typescript
{
  email: string  // valid email, lowercased server-side, must be corporate domain
}
\`\`\`

**Success response (200):**
\`\`\`typescript
{
  ok: true
  expiresAt: string  // ISO 8601 datetime, OTP valid until this time
  resendAvailableAt: string  // ISO 8601, when user can request resend
}
\`\`\`

**Errors:**
- 400 INVALID_EMAIL — malformed email
- 400 BLOCKED_DOMAIN — email is gmail/yahoo/etc.
- 400 DOMAIN_NOT_RECOGNIZED — domain not in allowlist (frontend should redirect to manual review flow)
- 429 RATE_LIMIT — too many OTP requests for this email

**Notes:**
- OTP itself is sent via email (Resend), not returned in response
- 6-digit numeric code, hashed before storage in Redis with 10-min TTL
```

Every endpoint in the API gets a section like this. The frontend Cursor session reads `API_CONTRACT.md` to know what to build forms and API client hooks against.

**Frontend's responsibility:** treat `API_CONTRACT.md` as gospel. If backend says response is `{ ok, expiresAt, resendAvailableAt }`, frontend types its API client accordingly. If frontend needs a different shape, that's a backend change request, not a frontend workaround.

## Build sequencing — backend first, then parallel

This project builds in two phases:

**Phase 1: Backend foundation (do these in order, fully verified before next):**
- Prompt 01: Backend foundation (NestJS + Prisma + Redis + health)
- Prompt 02: Backend auth (email OTP + PIN + JWT)
- Prompt 03: Backend users + profiles + listings (core CRUD with API_CONTRACT.md entries)

After Phase 1, `API_CONTRACT.md` has roughly 15–20 endpoints documented and frozen enough for frontend to begin.

**Phase 2: Frontend foundation begins, backend continues in parallel:**
- Frontend prompt F1: Frontend foundation + design system
- Frontend prompt F2: Onboarding flow (depends on Backend 02)
- Frontend prompt F3: Listing + profile creation flows (depends on Backend 03)
- Backend prompt 04: Browse + filters
- Frontend prompt F4: Browse + maps (depends on Backend 04, 07)
- Backend prompt 05: Messaging
- Frontend prompt F5: Messaging UI (depends on Backend 05)
- Backend prompt 06: Safety + admin
- Backend prompt 07: Maps + commute integration
- Backend prompt 08: Image upload (R2)
- Frontend prompt F6: Safety + settings (depends on Backend 06)
- Backend prompt 09: Production deploy to Railway
- Frontend prompt F7: Pre-launch polish + Vercel deploy + launch

**Important:** when starting a frontend prompt, the corresponding backend module must be complete and verified, with its endpoints in `API_CONTRACT.md`. If you start frontend work against incomplete backend, you'll build against a moving target.

## User roles

Three roles, stored as enum on User:

- `LISTER` — has a flat, looking for flatmate
- `SEEKER` — looking for a flat
- `BOTH` — flexible, open to either

A user has one Profile (always) and may have one Listing (only if LISTER or BOTH).

## Core data model

```
User
  id (cuid), email (unique, lowercased), emailVerified (bool), pinHash (argon2id), 
  phoneNumber (nullable, unique), phoneVerified (bool), 
  role (enum), companyName (string, derived from email domain),
  companyVerified (bool, true if domain in allowlist or manually approved),
  createdAt, updatedAt, deletedAt (soft delete)

Profile (1:1 with User)
  id, userId (fk), fullName, age, gender (enum: WOMAN, MAN, PREFER_NOT),
  photoUrl, bio, profession, workSchedule (enum: HOME, OFFICE, FLEXIBLE),
  budgetMin, budgetMax, moveInDate,
  preferredLocalities (string[]), 
  lifestyleTags (string[], max 3),
  smokingPref (enum: NON_SMOKER, SMOKER, FLEXIBLE),
  foodPref (enum: PURE_VEG, EGGETARIAN, NON_VEG_OK),
  officeLat (nullable), officeLng (nullable),  -- for commute estimates
  profileCompletion (int, computed)
  
Listing (1:1 with User, only for LISTER/BOTH)
  id, userId (fk), localityName, lat, lng, bhk (int), totalRent, yourShare,
  availableFrom, photos (string[]),
  description, amenities (string[]),
  preferredGender (enum), preferredProfessions (string[]),
  smokingAllowed (bool), foodPref (enum), workSchedulePref (enum),
  isActive (bool), createdAt, updatedAt

Conversation
  id, participantAUserId, participantBUserId, lastMessageAt, 
  numbersShared (bool), createdAt
  -- application invariant: A < B (lexicographic) for unique pair
  -- @@unique([participantAUserId, participantBUserId])

Message
  id, conversationId, senderId, body, createdAt, readAt

NumberShareRequest
  id, conversationId, requestedByUserId, status (PENDING, ACCEPTED, DECLINED),
  createdAt, respondedAt

Block
  id, blockerUserId, blockedUserId, createdAt
  @@unique([blockerUserId, blockedUserId])

Report
  id, reporterUserId, reportedUserId, conversationId (nullable),
  category (enum: HARASSMENT, FAKE_PROFILE, SCAM_BROKER, INAPPROPRIATE, OTHER),
  detail (text), status (PENDING, REVIEWING, RESOLVED, DISMISSED),
  createdAt, resolvedAt, resolverNotes

CompanyAllowlist
  id, domain (unique, lowercased), companyName, isActive, addedAt

ManualReviewRequest
  id, email, companyClaim, status, createdAt, reviewedAt

OtpCode
  -- stored in Redis only, never Postgres
  -- key: `otp:{email}` value: `{hash, attempts, expiresAt}`
  -- TTL: 10 min
```

## Authentication — the moat, must be done correctly

**Signup flow:**
1. POST `/auth/signup/request-otp` { email } → validates domain not in blocklist, generates OTP, hashes, stores in Redis, sends via Resend
2. POST `/auth/signup/verify-otp` { email, otp } → verifies, returns short-lived signup token (5 min)
3. POST `/auth/signup/set-pin` { signupToken, pin, confirmPin } → validates PIN strength, hashes (Argon2id), creates User, returns session JWT

**Login:**
- POST `/auth/login` { email, pin } → checks lockout, hashes & compares PIN, issues JWT (30-day, httpOnly cookie)

**PIN reset:**
- POST `/auth/recover/request-otp` { email } → same OTP flow
- POST `/auth/recover/verify-and-reset` { email, otp, newPin } → resets PIN

**Phone recovery (lost email access):**
- POST `/auth/recover/phone-request-otp` { phoneNumber } → SMS OTP via MSG91
- POST `/auth/recover/phone-verify` { phoneNumber, otp } → returns recovery token
- POST `/auth/recover/phone-update-email` { recoveryToken, newEmail } → triggers email OTP on new email

**PIN security rules (MUST IMPLEMENT):**
- Argon2id hashing: memory 64MB, iterations 3, parallelism 4, salt per user
- Reject obvious sequences: 123456, 654321, 000000, 111111–999999, birth years 1950–2010, repeating patterns (123123, 121212)
- Rate limit: 5 PIN attempts per email per 15 min, then 15-min lockout
- After 3 lockouts in 24h, force email-OTP recovery
- Never log PINs anywhere, never include in any API response
- Never send PIN in any email
- Track failed attempts in Redis with sliding window

**OTP rules:**
- 6-digit numeric
- 10 min TTL
- Hashed (HMAC-SHA256 with `OTP_HMAC_SECRET`) before storing in Redis
- Max 3 verify attempts before invalidation
- Resend allowed after 60s, max 3 resends per OTP request
- Rate limit OTP requests: 5 per email per hour

**JWT rules:**
- HS256 signed with `JWT_SECRET` env var
- Payload: `{ sub: userId, role, iat, exp }`
- 30-day expiry
- Stored in httpOnly cookie, SameSite=Lax, Secure in production
- Auth middleware validates on every protected route

## Email domain rules

**Blocklist (rejected immediately at signup):**
gmail.com, googlemail.com, yahoo.com, yahoo.co.in, ymail.com, rocketmail.com, outlook.com, hotmail.com, live.com, msn.com, protonmail.com, proton.me, pm.me, tutanota.com, tuta.io, icloud.com, me.com, mac.com, aol.com, gmx.com, mail.com, yandex.com, zoho.com (personal), plus the disposable email list from `disposable-email-domains` npm package.

**Allowlist (auto-approved, instant verification):**
JSON file in repo, ~200 entries to start. Top Indian companies + tech.

Sample (full list in `src/auth/data/company-allowlist.json`):
```
deloitte.com, ey.com, kpmg.com, kpmg.co.in, pwc.com, bain.com, bcg.com, mckinsey.com,
genpact.com, cognizant.com, accenture.com, accenture.in, infosys.com, tcs.com, wipro.com,
blinkit.com, swiggy.in, zomato.com, paytm.com, razorpay.com, cred.club, groww.in, zerodha.com,
flipkart.com, amazon.com, amazon.in, microsoft.com, google.com, meta.com, apple.com,
americanexpress.com, jpmchase.com, goldmansachs.com, morganstanley.com,
zsassociates.com, sprinklr.com, salesforce.com, adobe.com, atlassian.com,
makemytrip.com, oyo.com, ola.com, uber.com, byjus.com, unacademy.com, vedantu.com,
hcl.com, hcltech.com, mindtree.com, ltimindtree.com, persistent.com, mphasis.com,
optum.com, unitedhealthgroup.com
```

**Manual review path** (domain not in allowlist, not in blocklist):
- Insert ManualReviewRequest record
- Show user "We'll verify within 24 hours" screen
- Admin approves/rejects via admin panel
- On approval: domain added to allowlist, user marked verified, sent welcome email

## Lifestyle tag system

**Vibes (pick max 1):** Party-friendly, Chill, Social butterfly, Homebody, Bakchod, Foodie

**Schedule (pick max 1):** Early bird, Night owl, Flexible

**Lifestyle (pick max 2):** Fitness-focused, Gamer, Bookworm, Plant parent, Pet person, Cinephile

**Habits (separate fields, NOT in tags array):**
- smokingPref: NON_SMOKER | SMOKER | FLEXIBLE
- foodPref: PURE_VEG | EGGETARIAN | NON_VEG_OK

**Personality (pick max 1, optional):** Introvert, Ambivert, Extrovert, "I'll let you find out"

**User picks max 3 tags total** across vibes/lifestyle/personality. Schedule, smoking, food are separate hard-filter fields, NOT counted in the 3.

## Browse & matching logic

**Two tabs:**
- "Flats" tab → queries Listings
- "Flatmates" tab → queries Profiles where user has no listing OR is BOTH

**Default sort:** newest verified first.

**Filter set:**
- Locality (multi)
- Budget range (only Listings: filter by `yourShare BETWEEN min AND max`; Profiles: filter by overlap of budget range)
- Gender preference
- Move-in date range
- Lifestyle prefs (soft preferences, used for ranking not filtering)
- Smoking, food (HARD filters)

**No-results UX:** Surface 3 most-restrictive filters, suggest removing each.

**Rate limiting:** Browsing unlimited. Messaging rate-limited (see below).

## Messaging

- One conversation per pair of users (deduplicated)
- Text only at MVP, no images, no voice notes
- Rate limit: max 10 NEW conversations started per user per day
- Send-message rate limit: 60/min per user
- SSE endpoint for real-time delivery: `GET /messages/stream` (authenticated)
- Fallback: 5-second polling on conversation list when SSE not connected
- Number share: explicit two-way request/accept; both numbers visible after both accept

## Safety

**Report flow:**
- Categories: HARASSMENT, FAKE_PROFILE, SCAM_BROKER, INAPPROPRIATE, OTHER
- Free-text detail
- Goes to admin queue
- User who reports auto-blocks the reported user
- Confirmation: "We'll review within 24 hours. You won't see them again."

**Block:**
- Blocker no longer sees blocked in browse, conversations hidden
- Blocked user is NOT notified
- Blocker can technically still message blocked, but UI doesn't allow it

**Admin moderation:**
- Simple password-protected route at `/admin` in the API service
- Pages: report queue, manual-review queue, user lookup, ban user
- Ban: soft delete user, all listings/profile invisible, conversations hidden

## Maps & commute

- Google Places Autocomplete for listing creation
- Store lat/lng on Listing
- Browse map view uses Google Maps JS API with custom muted styles
- Listing pins show ₹ value in teal pill
- Commute estimate on listing detail uses Distance Matrix API
- Cache commute results in Redis: key `commute:{originLat,originLng}:{destLat,destLng}` TTL 7 days
- User must provide office location in profile to see commute
- Hard daily cap: 1000 Distance Matrix calls/day, fail gracefully above cap

## DPDP compliance

- Privacy policy + terms of service must be live before launch
- User can request data deletion via Settings → Delete Account
- Deletion grace period: 30 days (soft-deleted, hard-deleted after 30)
- Data export: JSON download
- Cookie banner: minimal, only "Accept" needed (no third-party trackers at MVP beyond first-party PostHog)

## Tech stack — locked

**Backend (`burrow-api` repo):**
- Runtime: Node.js 20 LTS
- Framework: NestJS 10
- ORM: Prisma 5
- Validation: Zod via `nestjs-zod`
- DB: PostgreSQL 15 (Neon for prod, local Postgres for dev)
- Cache/queue: Upstash Redis (prod), local Redis for dev
- Email: Resend
- SMS (recovery only): MSG91
- Image storage: Cloudflare R2 (S3-compatible)
- Maps: Google Maps Platform (Places, Distance Matrix, Maps JS API)
- Hosting: Railway
- Testing: Jest + Supertest

**Frontend (`burrow-web` repo):**
- Framework: Next.js 14 (App Router)
- Language: TypeScript strict mode
- Styling: Tailwind CSS 3 with custom theme tokens
- Components: shadcn/ui + custom Burrow primitives
- Validation: Zod via `react-hook-form` + `@hookform/resolvers/zod`
- State: Zustand (client) + TanStack Query (server)
- Forms: React Hook Form + Zod
- Maps: @vis.gl/react-google-maps
- Real-time: native EventSource for SSE
- Testing: Vitest + Testing Library + Playwright
- Hosting: Vercel

## Env vars

**`burrow-api/.env.example`:**
```
DATABASE_URL=
DIRECT_URL=
REDIS_URL=
JWT_SECRET=
OTP_HMAC_SECRET=
ADMIN_PASSWORD=
RESEND_API_KEY=
EMAIL_FROM=
MSG91_AUTH_KEY=
MSG91_SENDER_ID=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=
GOOGLE_MAPS_API_KEY=
SENTRY_DSN_API=
NODE_ENV=
PORT=
CORS_ORIGIN=                  # https://burrow.in in prod, http://localhost:3000 in dev
```

**`burrow-web/.env.local.example`:**
```
NEXT_PUBLIC_API_URL=          # http://localhost:4000/api/v1 in dev
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
NEXT_PUBLIC_SENTRY_DSN_WEB=
```

## Constants — define in BOTH repos

These constants need to be identical in both repos. **Define in backend first**, then copy to frontend whenever they change. Track in `SCHEMAS_CHANGELOG.md`.

```typescript
export const GURGAON_LOCALITIES = [/* full list above */];
export const LIFESTYLE_VIBES = ["Party-friendly", "Chill", "Social butterfly", "Homebody", "Bakchod", "Foodie"];
export const LIFESTYLE_SCHEDULE = ["Early bird", "Night owl", "Flexible"];
export const LIFESTYLE_INTERESTS = ["Fitness-focused", "Gamer", "Bookworm", "Plant parent", "Pet person", "Cinephile"];
export const LIFESTYLE_PERSONALITY = ["Introvert", "Ambivert", "Extrovert", "I'll let you find out"];
export const MAX_LIFESTYLE_TAGS = 3;
export const MAX_PHOTOS_PER_LISTING = 6;
export const MAX_NEW_CONVERSATIONS_PER_DAY = 10;
export const MIN_AGE = 18;
export const MAX_AGE = 60;
export const MIN_RENT = 5000;
export const MAX_RENT = 100000;
```

Backend file: `burrow-api/src/common/constants.ts`
Frontend file: `burrow-web/src/lib/constants.ts`

## Design tokens — backend doesn't need these, frontend uses verbatim

These are locked in the design HTML files. Frontend `tailwind.config.ts` should use these exact values:

```typescript
colors: {
  cream: '#FAF8F5',
  surface: '#FFFFFF',
  border: '#EDE8E0',
  ink: { primary: '#1A1A1A', secondary: '#6B6B6B', tertiary: '#A8A29A' },
  teal: { DEFAULT: '#1A5F5A', hover: '#134543' },
  forest: '#2D7A4F',
  terracotta: '#C5573D',
  'dark-bg': '#14211F',
  'dark-surface': '#1B2A28',
  'dark-border': '#2A3936',
  'dark-ink': { primary: '#F5F1EA', secondary: '#B5AEA3', tertiary: '#6F6862' },
  'dark-teal': { DEFAULT: '#5BA89E', hover: '#7AC0B6' },
  'dark-forest': '#5BA876',
  'dark-terracotta': '#D87A60',
},
fontFamily: {
  serif: ['Fraunces', 'serif'],
  sans: ['Inter', 'sans-serif'],
},
```

Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 (Tailwind defaults).
Radius: 12 (cards, buttons, inputs), 20 (bottom sheets).

## Reference design files

The following HTML files in `burrow-web/design/` are the visual source of truth (copy from your design exports):

1. `Burrow_Logo.html`
2. `Burrow_Onboarding.html`
3. `Burrow_States___Patterns.html`
4. `Burrow_Listing_Flow.html`
5. `Burrow_Profile___Browse.html`
6. `Burrow_Detail___Messaging.html`
7. `Burrow_Safety___Settings.html`

When implementing a screen, open the corresponding HTML file as visual reference. Replicate layout, spacing, typography, copy. Re-implement using Tailwind, do NOT copy the inline-style React.

## What's explicitly OUT of MVP

- Push notifications
- Image messaging
- Voice/video calls
- Group chats
- Saved searches / favorites
- Profile views ("X people viewed your profile")
- Compatibility scores / AI matching
- Referrals / invites
- Reviews / ratings
- Multiple cities (Gurgaon only)
- Native mobile apps (responsive web only)
- Multi-language support
- Payment / rent collection
- Background checks
- Government ID verification