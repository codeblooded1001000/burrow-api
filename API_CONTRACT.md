# Burrow API Contract

> Single source of truth for the Burrow API. The frontend (`burrow-web`) reads this file to integrate.

## Discipline rule

Endpoints are documented here AFTER they are implemented and tested in the backend. Do not write speculative entries for endpoints that don't exist yet. When updating an endpoint:

1. Implement and test the change
2. Update this file to match reality
3. Commit code + contract update together
4. Note the change in `SCHEMAS_CHANGELOG.md` if it's a breaking change

## Conventions

**Base URL:** `http://localhost:4000/api/v1` (dev) | `https://api.burrow.in/api/v1` (prod)

**Auth:** Cookie-based JWT (`burrow_session`, httpOnly, SameSite=Lax). Endpoints marked "Auth: required" need this cookie.

**Standard error response:**

```typescript
{
  error: {
    code: string       // machine-readable, SCREAMING_SNAKE_CASE
    message: string    // human-readable, suitable for end-user display
    details?: object   // optional field-level error details
  }
}
```

**Standard error codes used across endpoints:**

- 400 INVALID_INPUT — request body failed validation (details has field errors)
- 401 UNAUTHENTICATED — no/expired session
- 403 FORBIDDEN — authenticated but not allowed
- 404 NOT_FOUND — resource doesn't exist
- 409 CONFLICT — resource state conflict (e.g., already exists)
- 429 RATE_LIMIT — too many requests (Retry-After header included)
- 500 INTERNAL — server error (shouldn't reach client in non-error-handler form)

**Date format:** ISO 8601 strings (`2026-05-01T14:30:00.000Z`)
**Money format:** integer rupees (no paise, no decimal)

---

## Endpoints

### System

#### GET /health

**Auth:** None
**Purpose:** Health check for monitoring + frontend connection test.

**Success response (200):**

```typescript
{
  status: "ok"
  uptime: number     // seconds
  db: "ok" | "down"
  redis: "ok" | "down"
  version: string    // package.json version
  timestamp: string  // ISO 8601
}
```

**Errors:**

- 503 SERVICE_DEGRADED — db or redis is down (returns 503 with the same response fields as above, but `status` is `"degraded"`)

---

### Auth

Session cookie name: `burrow_session` (httpOnly, SameSite=Lax, `Secure` in production, 30-day TTL).

**UserDto** (used in several responses):

```typescript
{
  id: string
  email: string
  role: "LISTER" | "SEEKER" | "BOTH" | null  // null while role onboarding not completed (ONBOARDING)
  companyName: string
  companyVerified: boolean
  hasProfile: boolean
  hasListing: boolean
  profileCompletion: number  // 0–100
  createdAt: string           // ISO 8601
  fullName: string | null     // profile display name when profile exists; else null
  photoUrl: string | null     // profile photo URL when set; else null
}
```

#### POST /auth/signup/request-otp

**Auth:** None  
**Rate limit:** 5 OTP requests per hour per email (Redis sliding window); 60 requests/min per IP on `/auth/*`; OTP resend rules enforced on repeat calls (60s cooldown, max 3 resends per cycle).

**Request body:**

```typescript
{ email: string }  // lowercased server-side
```

**Success (200):**

```typescript
{ ok: true, expiresAt: string, resendAvailableAt: string }  // ISO 8601
```

**Errors:**  
- 400 `BLOCKED_DOMAIN` — consumer/disposable domain  
- 400 `DOMAIN_NOT_RECOGNIZED` — not allowlisted; `details.manualReviewAvailable: true`  
- 409 `CONFLICT` — user already exists  
- 429 `RATE_LIMIT` — OTP hourly or resend cooldown; `Retry-After` header (seconds)

---

#### POST /auth/signup/verify-otp

**Auth:** None  

**Request body:** `{ email: string, otp: string }` (6-digit OTP)

**Success (200):** `{ ok: true, signupToken: string, expiresAt: string }` — short-lived JWT (~5 min), purpose `signup`.

**Errors:** 400 `INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`; 429 `RATE_LIMIT`

---

#### POST /auth/signup/set-pin

**Auth:** None  

**Request body:** `{ signupToken: string, pin: string, confirmPin: string }` — PIN must be 6 digits, not weak-pattern, `pin === confirmPin`.

**Success (200):** `{ ok: true, user: UserDto }` and sets `burrow_session`.

**Errors:** 400 `PIN_MISMATCH`, `WEAK_PIN`, `INVALID_TOKEN`, `DOMAIN_NOT_RECOGNIZED`; 409 `CONFLICT`

---

#### POST /auth/signup/manual-review

**Auth:** None  

**Request body:** `{ email: string, companyClaim: string }`

**Success (200):** `{ ok: true, message: string }`

**Errors:** 400 `BLOCKED_DOMAIN`

---

#### POST /auth/login

**Auth:** None  

**Request body:** `{ email: string, pin: string }`

**Success (200):** `{ ok: true, user: UserDto }` + session cookie.

**Errors:**  
- 401 `INVALID_CREDENTIALS` — wrong email/PIN (same message)  
- 423 `ACCOUNT_LOCKED` — too many failures or recovery required; `details.retryAfter` (seconds), `details.lockedUntil` (ISO), optional `details.requireRecovery`

---

#### POST /auth/logout

**Auth:** None (clears cookie even if absent)

**Success (200):** `{ ok: true }`

---

#### POST /auth/recover/request-otp

**Auth:** None — PIN reset via email.

**Request body:** `{ email: string }`

**Success (200):** `{ ok: true, expiresAt: string, resendAvailableAt: string }`

**Errors:** 404 `NOT_FOUND` — no user for email; 429 `RATE_LIMIT`

---

#### POST /auth/recover/verify-and-reset

**Auth:** None  

**Request body:** `{ email: string, otp: string, newPin: string, confirmNewPin: string }`

**Success (200):** `{ ok: true, user: UserDto }` + new session cookie.

**Errors:** 400 `INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`, `WEAK_PIN`, validation mismatch on PINs; 404 `NOT_FOUND`

---

#### POST /auth/recover/phone-request-otp

**Auth:** None  

**Request body:** `{ phoneNumber: string }` — E.164 `+91` and 10 Indian digits.

**Success (200):** `{ ok: true, expiresAt: string, resendAvailableAt: string }`

**Errors:** 400 `INVALID_INPUT` — malformed phone (Zod); 404 `PHONE_NOT_FOUND`; 500 `INTERNAL` if SMS transport fails; 429 `RATE_LIMIT`

---

#### POST /auth/recover/phone-verify

**Auth:** None  

**Request body:** `{ phoneNumber: string, otp: string }`

**Success (200):** `{ ok: true, recoveryToken: string, expiresAt: string }` — JWT purpose `phone-recovery`, ~10 min.

**Errors:** 400 as OTP errors; 404 `PHONE_NOT_FOUND`

---

#### POST /auth/recover/phone-update-email

**Auth:** None — after `phone-verify`; sends OTP to new corporate email.

**Request body:** `{ recoveryToken: string, newEmail: string }`

**Success (200):** `{ ok: true, expiresAt: string, resendAvailableAt: string }`

**Errors:** 400 `INVALID_TOKEN`, `BLOCKED_DOMAIN`, `DOMAIN_NOT_RECOGNIZED`; 409 `CONFLICT` if email taken; 429 `RATE_LIMIT`

---

#### POST /auth/recover/confirm-new-email

**Auth:** None — completes phone-recovery email change after OTP to new address.

**Request body:** `{ recoveryToken: string, newEmail: string, otp: string }`

**Success (200):** `{ ok: true, message: string }`

**Errors:** 400 `INVALID_OTP`, `OTP_EXPIRED`, `INVALID_TOKEN`

---

#### GET /auth/me

**Auth:** Required (`burrow_session`)

**Success (200):** `{ user: UserDto }`

**Errors:** 401 `UNAUTHENTICATED`

---

### Users

#### PATCH /users/me/role

**Auth:** Required  

**Request body:**

```typescript
{ role: 'LISTER' | 'SEEKER' | 'BOTH' }
```

**Success (200):** `{ ok: true, user: UserDto }` — `UserDto` matches `GET /auth/me`.

**Errors:** 401 `UNAUTHENTICATED`; 400 `INVALID_INPUT`

---

#### PATCH /users/me/phone

**Auth:** Required  
**Rate limit:** Same OTP rules as auth SMS flows (5/hour per phone in Redis).

**Request body:** `{ phoneNumber: string }` — E.164 `+91` + 10 digits.

**Success (200):** `{ ok: true, expiresAt: string }` — OTP sent via MSG91; user row updated with `phoneVerified: false` until verify.

**Errors:** 401; 409 `PHONE_IN_USE`; 429 `RATE_LIMIT`; 500 `INTERNAL` if SMS fails

---

#### POST /users/me/phone/verify

**Auth:** Required  

**Request body:** `{ otp: string }` — 6-digit code for the phone currently on the user record.

**Success (200):** `{ ok: true }` — sets `phoneVerified: true` and refreshes `profileCompletion` when a profile exists.

**Errors:** 401; 400 `INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`, `INVALID_INPUT`

---

#### DELETE /users/me

**Auth:** Required — DPDP soft delete (30-day grace before hard delete in ops).

**Request body:**

```typescript
{ pin: string } // exactly 6 digits; must match account PIN
```

**Success (200):** `{ ok: true }` — sets `User.deletedAt`, soft-deletes profile, deactivates listing, clears Redis OTP + PIN state for identifiers, clears `burrow_session`, sends scheduling email.

**Errors:** 401; 404 `NOT_FOUND`; 400 `INVALID_PIN` — PIN does not match (failed attempts follow same lockout rules as login).

---

#### GET /users/me/export

**Auth:** Required  

**Success (200):** JSON attachment `burrow-data-{userId}.json` — includes user (no `pinHash`), profile, listing, conversations + messages, reports filed/received.

**Errors:** 401; 404 `NOT_FOUND`

---

### Profiles

#### GET /profiles/me

**Auth:** Required  

**Success (200):** `ProfileOwnDto` — same as public profile plus `officeLat`, `officeLng`.

**Errors:** 401; 404 `NOT_FOUND` if no profile row

---

#### POST /profiles/me/photo/upload-url

**Auth:** Required.

**Request body:** `{ contentType: 'image/jpeg' | 'image/png' | 'image/webp', sizeBytes: number }` — `sizeBytes` from **1** to **5_242_880** (5 MiB).

**Success (200):** `{ uploadUrl: string; key: string; expiresAt: string }` — `uploadUrl` is a time-limited **PUT** target (R2). Client **PUT**s the raw bytes to `uploadUrl`, then calls **`POST /uploads/confirm`**. Persist **`key`** (object path) as `photoUrl`; **GET** responses expose a full HTTPS URL built from `R2_PUBLIC_URL` + key (legacy rows may still store a full URL).

**Errors:** **401**; **400** `INVALID_CONTENT_TYPE` | `FILE_TOO_LARGE` | `INVALID_INPUT` (Zod); **429** `RATE_LIMIT` (too many URL requests per user per UTC hour; `Retry-After` header); **503** `SERVICE_UNAVAILABLE` when R2 env is not configured.

---

#### PUT /profiles/me

**Auth:** Required — create or replace profile (`deletedAt` cleared on upsert).

**Request body:** Full profile object (see types below): `fullName`, `age`, `gender`, optional `photoUrl` (R2 object key `profiles/{yourUserId}/…` from upload flow, or legacy HTTPS under `R2_PUBLIC_URL` / default `https://cdn.burrow.in/`), `bio` (max 500), optional `profession`, `workSchedule`, `budgetMin`/`budgetMax`, optional `moveInDate` (ISO), `preferredLocalities` (Gurgaon list), `lifestyleTags` (max 3, from vibes/schedule/interests/personality constants), optional `smokingPref`, `foodPref`, optional paired `officeLat`/`officeLng`.

**Success (200):** `ProfileOwnDto`

**Errors:** 401; 400 `INVALID_INPUT` (Zod / photo domain / office pair / budget range)

---

#### PATCH /profiles/me

**Auth:** Required — partial update; same validation rules as PUT on provided fields.

**Success (200):** `ProfileOwnDto`

**Errors:** 401; 404 `NOT_FOUND`; 400 `INVALID_INPUT`

---

#### GET /profiles/:userId

**Auth:** Required (verified users browse only).  

**Success (200):** `ProfilePublicDto` — no office coordinates.

**Errors:** 401; 404 `NOT_FOUND` — generic when user/profile hidden, company unverified, soft-deleted, or viewer is blocked by target (`Block` where `blockerUserId` = target, `blockedUserId` = viewer).

**`ProfilePublicDto`:**

```typescript
{
  id: string
  userId: string
  fullName: string
  age: number
  gender: 'WOMAN' | 'MAN' | 'PREFER_NOT'
  photoUrl: string | null // browser URL; server joins R2_PUBLIC_URL + stored key for GET
  bio: string
  profession: string | null
  workSchedule: 'HOME' | 'OFFICE' | 'FLEXIBLE' | null
  budgetMin: number | null
  budgetMax: number | null
  moveInDate: string | null
  preferredLocalities: string[]
  lifestyleTags: string[]
  smokingPref: 'NON_SMOKER' | 'SMOKER' | 'FLEXIBLE' | null
  foodPref: 'PURE_VEG' | 'EGGETARIAN' | 'NON_VEG_OK' | null
  user: { id: string; companyName: string; companyVerified: boolean }
}
```

---

### Listings

#### GET /listings/me

**Auth:** Required  

**Success (200):** `ListingDto`

**Errors:** 401; 404 `NOT_FOUND` if no listing row

---

#### POST /listings/me

**Auth:** Required — role must be `LISTER` or `BOTH`; profile must exist first.

**Request body:** `localityName` (Gurgaon list), `lat`, `lng`, `bhk` 1–5, `totalRent` / `yourShare` (MIN_RENT–MAX_RENT), `availableFrom` (ISO, today UTC or future), `photos` (R2 object keys `listings/{yourUserId}/…` from upload flow, or legacy HTTPS under `R2_PUBLIC_URL` / default `https://cdn.burrow.in/`, max **6**), `description` (max 1000), `amenities` (known list), `preferredGender` `WOMAN` | `MAN` | `ANYONE`, `preferredProfessions` (curated list), `smokingAllowed`, optional `foodPref`, optional `workSchedulePref`.

**Success (201):** `ListingDto`

**Errors:** 401; 403 `FORBIDDEN` (Seeker); 400 `INVALID_INPUT`; 409 `CONFLICT` if an active listing already exists

---

#### PUT /listings/me

**Auth:** Required — same role and body rules as POST; creates listing if none exists, otherwise full replace.

**Success (200):** `ListingDto`

**Errors:** 401; 403; 400 `INVALID_INPUT` — if no row exists yet, behaves like create (same as POST body rules).

---

#### PATCH /listings/me

**Auth:** Required — partial update.

**Success (200):** `ListingDto`

**Errors:** 401; 403; 404 `NOT_FOUND`

---

#### DELETE /listings/me

**Auth:** Required — sets `isActive: false` (history kept).

**Success (200):** `{ ok: true }`

**Errors:** 401; 403

---

#### POST /listings/me/photos/upload-url

**Auth:** Required — role **`LISTER`** or **`BOTH`**.

**Request body:** `{ contentType: 'image/jpeg' | 'image/png' | 'image/webp', sizeBytes: number }` — `sizeBytes` from **1** to **5_242_880** (5 MiB).

**Success (200):** `{ uploadUrl: string; key: string; expiresAt: string }` — `uploadUrl` is a presigned **PUT** to Cloudflare R2 (expires **10 minutes**). After a successful PUT, call **`POST /uploads/confirm`** with `{ key, type: 'listing-photo' }`, then store **`key`** in `photos[]`; **GET** listing returns full HTTPS URLs derived from `R2_PUBLIC_URL`.

**Errors:** **401**; **403** `FORBIDDEN` if role is not lister-capable; **400** `INVALID_CONTENT_TYPE` | `FILE_TOO_LARGE` | `INVALID_INPUT` (Zod); **429** `RATE_LIMIT` (per-user hourly cap on URL generation; `Retry-After`); **503** `SERVICE_UNAVAILABLE` when R2 is not configured.

---

#### GET /listings/:listingId

**Auth:** Required  

**Success (200):** `ListingDto`

**Errors:** 401; 404 `NOT_FOUND` — same privacy semantics as public profile (inactive, unverified company, deleted owner/profile, block).

**`ListingDto`:**

```typescript
{
  id: string
  userId: string
  localityName: string
  lat: number
  lng: number
  bhk: number
  totalRent: number
  yourShare: number
  availableFrom: string
  photos: string[] // HTTPS URLs for GET (joined from stored keys + R2_PUBLIC_URL)
  description: string
  amenities: string[]
  preferredGender: 'WOMAN' | 'MAN' | 'ANYONE'
  preferredProfessions: string[]
  smokingAllowed: boolean
  foodPref: 'PURE_VEG' | 'EGGETARIAN' | 'NON_VEG_OK' | null
  workSchedulePref: 'HOME' | 'OFFICE' | 'FLEXIBLE' | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  lister: {
    id: string
    fullName: string
    age: number
    gender: 'WOMAN' | 'MAN' | 'PREFER_NOT'
    photoUrl: string | null // resolved like profile photos
    profession: string | null
    companyName: string
    companyVerified: boolean
  }
}
```

---

### Constants

#### GET /constants

**Auth:** None (`@Public`) — cacheable taxonomy for web + API.

**Caching:** Response includes `Cache-Control: public, max-age=3600` (1 hour). Do not rely on server caching for personalized browse responses.

**Success (200):**

```typescript
{
  localities: string[]
  vibes: string[]
  schedule: string[]
  interests: string[]
  personality: string[]
  professions: string[]
  amenities: string[]
}
```

Matches `src/common/constants.ts` (Gurgaon localities, lifestyle tags, curated professions, listing amenities).

---

### Browse

Cursor-based pagination (opaque `cursor`), default `limit=20`, max `50`. Results exclude soft-deleted users, `companyVerified=false` users, anyone in a block relationship with the viewer (either direction), and the viewer’s own listing or profile. Each item includes **`matchScore`** (0–100): MVP stub from soft preferences (`workSchedule`, `lifestyleTags` overlap); **`sort=best_match`** uses the same ordering as **`newest`** until ranking ships in v1.1.

**Daily cap:** Combined count of `GET /browse/flats` and `GET /browse/flatmates` per user per UTC calendar day (Redis). Default **1000**; override for tests/ops with env `BROWSE_DAILY_MAX`. **`429 RATE_LIMIT`** with message *"You've browsed a lot today. Take a break and come back tomorrow."* and **`Retry-After`** header (seconds until next UTC midnight).

**Shared query params** (all optional; Zod-validated; multi-value as repeated keys or comma-separated strings):

| Param | Notes |
| --- | --- |
| `cursor` | Opaque; do not parse client-side |
| `limit` | 1–50, default 20 |
| `localities` | Multi; listing `localityName` or profile `preferredLocalities` overlap |
| `budgetMin`, `budgetMax` | ₹ integers; listings filter `yourShare`; profiles require budget range overlap |
| `gender` | `WOMAN` \| `MAN` \| `ANYONE` — flats: listing must accept that seeker gender (`preferredGender` or `ANYONE`); flatmates: profile `gender` must match when not `ANYONE` |
| `moveInFrom`, `moveInTo` | ISO datetimes — listings: `availableFrom`; profiles: `moveInDate` |
| `bhk` | Multi integers 1–5 — **flats only** (ignored for flatmates) |
| `smokingPref`, `foodPref` | Hard filters (`NON_SMOKER` / `SMOKER` / `FLEXIBLE`; food `PURE_VEG` / `EGGETARIAN` / `NON_VEG_OK`) |
| `workSchedule`, `lifestyleTags` | Accepted; **soft** — affect `matchScore` only, not SQL `WHERE` |
| `professions` | Curated list — **flatmates only** |
| `sort` | `newest` (default), `soonest_move_in` (**flats only** — `availableFrom` asc), `best_match` (stub = newest) |

**`sort=soonest_move_in` on `GET /browse/flatmates`:** Silently treated as **`newest`** (profiles have no listing `availableFrom`).

---

#### GET /browse/flats

**Auth:** Required — role **`SEEKER`** or **`BOTH`** only.

**Success (200):**

```typescript
{
  items: Array<ListingDto & { matchScore: number }>
  nextCursor: string | null
  hasMore: boolean
}
```

`ListingDto` matches **GET /listings/:listingId** (includes `lister` snippet).

**Errors:** `401`; `403 FORBIDDEN` (Lister-only / onboarding); `400 INVALID_INPUT` (bad cursor or query); `429 RATE_LIMIT` (daily browse cap).

---

#### GET /browse/flatmates

**Auth:** Required — role **`LISTER`** or **`BOTH`** only.

Returns profiles for users eligible as flatmates (master spec: listers without an active listing, seekers, both), with `profileCompletion ≥ 70`, non-deleted profile.

**Success (200):**

```typescript
{
  items: Array<ProfilePublicDto & { matchScore: number }>
  nextCursor: string | null
  hasMore: boolean
}
```

**Errors:** Same as flats, with flatmates-specific `403` message when the user is seeker-only.

### Messaging

Text-only chat between two users who share a **Conversation** (one row per user pair; server stores participants with `participantAUserId < participantBUserId` lexicographically). New threads start in **`PENDING`** status: the **initiator** sends an intro; the **receiver** can **accept**, **reject**, or **reply** (replying implicitly accepts — see `POST .../messages`). **`ACTIVE`** is normal chat. **`REJECTED`** and **`ARCHIVED`** rows are never returned in list/detail APIs (404). **Phone numbers** appear only after **number share** is accepted (`numbersShared` on the conversation). Real-time updates use **SSE** at `GET /messages/stream` (cookie session; no WebSockets).

**Common errors:** `401`; `403 FORBIDDEN` with `BLOCKED_BY_USER` (“Cannot message this user”) or `YOU_BLOCKED_USER` (viewer blocked the other); `404 NOT_FOUND` for non-participant, hidden, closed, or invalid conversation; `404` with `CANNOT_SEND_REQUEST` when a prior reject blocks the initiator from re-requesting the same user; `429 RATE_LIMIT` with `Retry-After` (new conversations per day, messages per minute).

---

#### GET /conversations

**Auth:** Required.

**Query:** `tab?` — `active` (default) \| `requests` \| `all`. **`active`:** `status === ACTIVE` only, sorted `lastMessageAt` desc then `id` desc. **`requests`:** `PENDING` where the viewer is **not** the initiator (incoming requests only; initiators do not see their own outbound pending here), sorted `createdAt` desc (cursor v2: `{ v: 2, createdAt, id }` base64url). **`all`:** backwards-compatible union of active + incoming pending, sorted like **`active`**. `REJECTED` / `ARCHIVED` never listed. `cursor?` (opaque; v1 `{ v: 1, lastMessageAt, id }` for `active` / `all`), `limit?` (default **30**, max **50**).

**Headers:** `Cache-Control: no-store`.

Omits rows where the other user soft-deleted their account/profile, or where **any** block exists between the two users (invisible thread). Also omits **outbound** `PENDING` from the default **`active`** tab (use `GET /conversations/sent-requests` for those).

**Success (200):**

```typescript
{
  items: Array<{
    id: string
    createdAt: string // ISO
    lastMessageAt: string | null
    numbersShared: boolean
    status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'ARCHIVED'
    initiatedByUserId: string
    acceptedAt: string | null // ISO when accepted; null until then
    otherParticipant: {
      id: string
      fullName: string
      photoUrl: string | null
      companyName: string
      companyVerified: boolean
    }
    lastMessage: {
      id: string
      conversationId: string
      senderId: string
      body: string
      createdAt: string
      readAt: string | null
    } | null
    unreadCount: number
    pendingNumberShareRequest?: {
      id: string
      conversationId: string
      requestedByUserId: string
      status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
      createdAt: string
      respondedAt: string | null
    }
    myPhoneNumber?: string | null      // only if numbersShared
    otherPhoneNumber?: string | null   // only if numbersShared
  }>
  nextCursor: string | null
  hasMore: boolean
}
```

---

#### GET /conversations/sent-requests

**Auth:** Required.

**Headers:** `Cache-Control: no-store`.

Returns up to **50** **`PENDING`** conversations where the viewer is the **initiator** (outbound “awaiting reply”), newest `createdAt` first. Same visibility rules as `GET /conversations` (hidden if viewer blocked the recipient while pending, etc.).

**Success (200):** `{ items: ConversationSummary[] }` (same element shape as `GET /conversations` items).

---

#### POST /conversations

**Auth:** Required.

**Body:**

```typescript
{ recipientUserId: string; initialMessage: string } // initialMessage 1–2000 chars
```

Creates a **`PENDING`** conversation with `initiatedByUserId` = caller when no row exists; inserts the intro message. If an **`ACTIVE`** row exists, returns it idempotently with the **latest** message (no insert). If **`PENDING`** exists for the pair, returns that row idempotently (no second intro). If the pair was **`ARCHIVED`** (ignored >30 days) or **`REJECTED`** where the caller was the **original receiver** (they may start a fresh request the other way), the same row is **reopened** to **`PENDING`** with a new message (does **not** consume the new-conversation rate slot). If **`REJECTED`** where the caller was the **original initiator**, returns **`404`** with `CANNOT_SEND_REQUEST` (generic message — do not reveal “rejected”). Recipient must exist, not deleted, `companyVerified`, have a non-deleted **Profile**, and pass block checks. Counts toward the per-day **new conversation** cap only when a **new DB row** is created.

**SSE:** Publishes **`request_received`** to the recipient (not `message_new` for the intro). **`conversation_updated`** to both participants.

**Success (201):** `{ conversation: <ConversationSummary as above>; message: MessageDto }` — `conversation.status` is **`PENDING`** for a new request.

**Errors:** `400`; `403` block codes; `404` recipient not messagable; `404` `CANNOT_SEND_REQUEST`; `429` new-conversation cap.

---

#### GET /conversations/lookup

**Auth:** Required.

**Query:** `otherUserId` (string) — the other user’s id.

**Headers:** `Cache-Control: no-store`.

Returns whether the viewer already has a **visible** thread with that user (same rules as `GET /conversations`: hidden or blocked pairs yield `null`). **`REJECTED`** / **`ARCHIVED`** pairs yield **`null`**.

**Success (200):** `{ conversationId: string | null }` — `conversationId` is set when an existing conversation should be opened; otherwise start a new one with `POST /conversations`.

---

#### GET /conversations/:conversationId

**Auth:** Required. Participant only.

**Headers:** `Cache-Control: no-store`.

**Success (200):** Same shape as one element of `GET /conversations` items (includes `status`, `initiatedByUserId`, `acceptedAt`).

**Errors:** `404` if not a participant, conversation hidden, or status is **`REJECTED`** / **`ARCHIVED`**.

---

#### POST /conversations/:conversationId/accept

**Auth:** Required. Must be the **receiver** (not `initiatedByUserId`).

Sets `status` to **`ACTIVE`** and `acceptedAt` to now. Atomic DB update.

**Success (201):** `{ conversation: ConversationSummary }`

**SSE:** **`request_accepted`** to the initiator with `{ conversationId, byUserId }`.

**Errors:** `400` if status is not **`PENDING`**; `403` if caller is the initiator; `404` / blocks as usual.

---

#### POST /conversations/:conversationId/reject

**Auth:** Required. Must be the **receiver**.

**Body:** `{ reason?: string }` — optional, max **200** chars, stored for admin context only (`rejectReason`).

Sets `status` to **`REJECTED`**, `rejectedAt`, `rejectedByUserId`. Does **not** auto-block.

**Success (201):** `{ ok: true }`

**SSE:** **`request_rejected`** to the initiator with `{ conversationId, byUserId }`.

**Errors:** `400` if not **`PENDING`**; `403` if caller is the initiator; `404` / blocks as usual.

---

#### GET /conversations/:conversationId/messages

**Auth:** Required. Participant only.

**Query:** `cursor?` (opaque; v1 payload `{ v: 1, beforeMessageId: string }` after base64url decode), `limit?` (default **50**, max **100**).

**Headers:** `Cache-Control: no-store`.

Returns messages in **reverse chronological** order (newest first). Fetched page **auto-marks read** for inbound messages (sender ≠ viewer, `readAt` null); emits `message_read` SSE to the sender where applicable.

**Success (200):**

```typescript
{
  items: MessageDto[]
  nextCursor: string | null
  hasMore: boolean
}

type MessageDto = {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: string
  readAt: string | null
}
```

---

#### POST /conversations/:conversationId/messages

**Auth:** Required. Participant only.

**Body:** `{ body: string }` — 1–2000 chars.

**Status rules:**

- **`ACTIVE`:** Normal send. Updates `lastMessageAt`; publishes **`message_new`** and **`conversation_updated`** to the other user.
- **`PENDING`:** If the sender is the **initiator**, **`403`** with `REQUEST_PENDING_ACCEPTANCE` (cannot send a second message until accepted). If the sender is the **receiver**, the server **atomically** sets `status` to **`ACTIVE`**, sets `acceptedAt`, creates the message, then publishes **`request_accepted`** to the initiator and **`message_new`** / **`conversation_updated`** as in the active case (implicit accept-on-reply).
- **`REJECTED`** / **`ARCHIVED`:** **`403`** `CONVERSATION_CLOSED`.

**Success (201):** `{ message: MessageDto }`.

**Errors:** `403` blocks, `REQUEST_PENDING_ACCEPTANCE`, `CONVERSATION_CLOSED`; `429` messages-per-minute cap.

---

#### PATCH /conversations/:conversationId/messages/read

**Auth:** Required. Participant only.

**Body:** `{ upToMessageId?: string }` — omit to mark **all** unread inbound messages; if set, marks inbound messages with `createdAt` ≤ anchor message’s `createdAt` (and still only messages from the other user with `readAt` null).

**Success (200):** `{ markedRead: number }`. Publishes `message_read` to the other participant.

---

#### POST /conversations/:conversationId/number-share/request

**Auth:** Required. Participant only.

Conversation must be **`ACTIVE`**. Creates a `PENDING` **NumberShareRequest** if none pending and numbers not already shared. SSE: `number_share_requested` to the other user.

**Success (201):** `{ request: NumberShareRequestDto }`

**Errors:** `403` blocks, `CONVERSATION_CLOSED` if not **`ACTIVE`**; `409 CONFLICT` if already shared or pending request exists.

---

#### POST /conversations/:conversationId/number-share/respond

**Auth:** Required. Must be the **other** participant (not the requester). Conversation must be **`ACTIVE`**.

**Body:** `{ requestId: string; accept: boolean }`

**Success (201):** On accept, sets `numbersShared` on the conversation. Response includes both phone numbers for the handshake result, e.g.:

```typescript
{
  request: NumberShareRequestDto
  phoneNumbers: { requesterPhone: string | null; responderPhone: string | null }
}
```

**Errors:** `403` if caller is the requester, blocked, or conversation not **`ACTIVE`** (`CONVERSATION_CLOSED`); `404` invalid request; `409` if not `PENDING`.

---

#### GET /messages/unread-count

**Auth:** Required.

Total unread inbound messages across **`ACTIVE`** conversations only (excludes pending request threads). Cached in Redis **5 seconds**. For inbox badges that include incoming requests, also load `GET /conversations?tab=requests` (or a dedicated count) on the client.

**Success (200):** `{ count: number }`

---

#### GET /messages/stream (SSE)

**Auth:** Required (session cookie; same as REST — use `EventSource` with credentials on the client).

**Accept:** `text/event-stream`

Nest encodes each event as SSE `data:` JSON. Payload discriminant is `type`:

| `type` | Meaning | `data` |
|--------|---------|--------|
| `message_new` | New message in an **`ACTIVE`** conversation | `MessageDto` (same fields as REST); `conversationId` is also on the outer payload in the implementation. Not used for the initial intro while **`PENDING`** — use `request_received` instead. |
| `message_read` | Recipient read receipts | `{ conversationId, readerId, upToMessageId? }` |
| `number_share_requested` | Someone requested number share | `NumberShareRequestDto` |
| `number_share_responded` | Other party responded | `{ requestId, status }` |
| `conversation_updated` | `lastMessageAt` changed | `{ conversationId, lastMessageAt }` |
| `request_received` | Someone sent you a conversation request | `{ conversationId, fromUserId, intro }` |
| `request_accepted` | Your outbound request was accepted (explicit or first reply) | `{ conversationId, byUserId }` |
| `request_rejected` | Your outbound request was rejected | `{ conversationId, byUserId }` |
| `keepalive` | Every **25s** — keep proxies from closing the connection | `{}` |

**Example flow:** User **A** starts a chat (`POST /conversations`). **B** receives **`request_received`**. After the thread is **`ACTIVE`**, when **A** sends `POST .../messages`, **B** receives **`message_new`** and **`conversation_updated`**.

**Limitation:** Events are fan-out **in-process** only. Multiple API instances would need Redis pub/sub (noted in server TODO).

**Errors:** `401` if session invalid.

### Safety

Block and report endpoints require a normal session cookie. Filing a **new** report **auto-blocks** the reported user in the same DB transaction.

**Browse / listings / profiles:** Users you blocked are excluded from `GET /browse/*`. If the **owner** has blocked **you**, `GET /listings/:id` and `GET /profiles/:userId` return **404** for that viewer. Messaging already enforces mutual block rules (see Messaging).

#### POST /blocks

**Auth:** Required.

**Body:** `{ userId: string }` — user to block (must exist, not soft-deleted, not self).

**Success:** `{ block: { id, blockedUserId, createdAt } }` — **201** if created, **200** if a block already existed (idempotent). **Side effect:** any **`PENDING`** conversation between the pair where the **blocked user** had initiated the request is set to **`REJECTED`** (receiver blocked the sender).

**Errors:** `400` self-block; `404` target missing.

---

#### DELETE /blocks/:userId

**Auth:** Required.

**Success (200):** `{ ok: true, wasBlocking: boolean }` — idempotent if no row existed.

---

#### GET /blocks

**Auth:** Required.

**Success (200):**

```typescript
{
  items: {
    id: string
    blockedUser: { id: string; fullName: string; photoUrl: string | null; companyName: string }
  }[]
}
```

Soft-deleted profiles are omitted from `items`. No pagination (MVP).

---

#### POST /reports

**Auth:** Required.

**Body:**

```typescript
{
  reportedUserId: string
  conversationId?: string   // optional; if set, must be a conversation both users participate in
  category: 'HARASSMENT' | 'FAKE_PROFILE' | 'SCAM_BROKER' | 'INAPPROPRIATE' | 'OTHER'
  detail?: string           // max 1000 chars
}
```

**Success:** `{ report: ReportDto; autoBlocked: boolean }` — **201** for a new report (auto-block applied when `autoBlocked` is `true`), **200** if a **PENDING** report already exists for the same `(reporter, reported, conversationId)` triplet (returns existing `report`, `autoBlocked: false`).

**ReportDto (user-facing):**

```typescript
{
  id: string
  reportedUser: { id: string; fullName: string; companyName: string }
  category: /* same enum as body */
  status: 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'
  createdAt: string
  resolvedAt: string | null
}
```

`resolverNotes` are never returned to end users.

**Errors:** `400` self-report or invalid conversation linkage; `404` reported user / conversation.

Admin notification email to `admin@burrow.in` is **rate-limited** (at most one email per ~5 minutes; batched count in subject when multiple reports arrive in the window).

---

#### GET /reports/mine

**Auth:** Required.

**Success (200):** `{ items: ReportDto[] }` — newest first, no `resolverNotes`.

### Maps

Server-side **Places Details** validation (Gurgaon / Gurugram bounds) and **Distance Matrix** commute estimates (driving, traffic). Frontend continues to use Google Maps JS for autocomplete and map tiles; these routes reduce abuse and cache matrix results in Redis.

**Env:** `GOOGLE_MAPS_API_KEY` (optional at boot; empty → graceful `API_ERROR` / null commute). Optional `MAPS_DAILY_BUDGET` — max Distance Matrix calls per UTC day (default **1000**); over cap → **200** body with `commute: null`, `reason: BUDGET_EXCEEDED` (no **500**). E2E sets a non-billing placeholder when the key is unset so `POST /maps/validate-place` can be tested with a mocked `fetch`; live Distance Matrix coverage is opt-in via `RUN_EXTERNAL_API_TESTS=true` with a **real** key (see `.env.example`).

#### GET /maps/commute

**Auth:** Required (cookie session).

**Query:** `listingId` (string, required).

**Success (200):**

```typescript
{
  commute: {
    distanceMeters: number
    durationSeconds: number           // base duration (off-peak)
    durationInTrafficSeconds: number  // with traffic (display)
    mode: 'driving' | 'straight_line'
  } | null
  reason: 'OK' | 'ESTIMATE' | 'NO_OFFICE_SET' | 'NO_LISTING_LOCATION' | 'BUDGET_EXCEEDED' | 'API_ERROR'
  cached: boolean
}
```

**Behaviour:** Loads the listing via the same visibility rules as `GET /listings/:id` (**404** if not visible). Commute is **listing → viewer’s office** (listing `lat`/`lng` as origin, profile `officeLat`/`officeLng` as destination). If the viewer has no office coordinates → `commute: null`, `reason: NO_OFFICE_SET`. If the listing has invalid coordinates → `NO_LISTING_LOCATION`. Redis cache key rounds coordinates to **4** decimal places; TTL **7 days**. Distance Matrix is called **with** traffic (`traffic_model=best_guess`, `departure_time` ≈ **now + 1h**); if that fails, the service **retries once without** traffic parameters. If both fail (e.g. `REQUEST_DENIED`, billing, or key restrictions), the response is **200** with `reason: ESTIMATE`, `cached: false`, and `commute` filled from a **local geometry-based approximation** (`mode: 'straight_line'` — not written to Redis). Missing API key still returns `commute: null`, `reason: API_ERROR` before any outbound Matrix call.

**Errors:** **404** if the listing is not found / not visible to the viewer; **400** on invalid query.

#### POST /maps/validate-place

**Auth:** Required.

**Body:** `{ placeId: string }` — `place_id` from browser Places Autocomplete.

**Success (200):** Either

```typescript
{
  valid: true
  lat: number
  lng: number
  formattedAddress: string
  placeId: string
  locality?: string
}
```

or

```typescript
{ valid: false; reason: 'OUT_OF_BOUNDS' | 'API_ERROR' }
```

**Behaviour:** Calls Places Details (`geometry`, `address_components`, `formatted_address`). Valid only if coordinates fall inside the Gurgaon bounding box **and** address components suggest **Gurgaon**, **Gurugram**, or **Haryana**. Otherwise `valid: false`, `reason: OUT_OF_BOUNDS`. Missing key or Google errors → `valid: false`, `reason: API_ERROR`.

**Errors:** **400** on invalid body.

### Uploads

Direct-to-R2 uploads use the AWS SigV4-compatible S3 API (`@aws-sdk/client-s3` + presigned **PUT**). Secrets never leave the server.

**Env (optional at boot until first upload):** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` (public origin for browser-loaded objects, no trailing slash). Optional **`UPLOAD_URL_GEN_PER_HOUR`** (default **30**) caps presigned URL generation per user per UTC clock hour. Test-only: **`UPLOAD_RATE_LIMIT_OFF=true`** skips that cap.

#### POST /uploads/confirm

**Auth:** Required.

**Request body:** `{ key: string, type: 'listing-photo' | 'profile-photo' }` — `key` must match the value returned from an upload-url call for the **same** signed-in user (`listings/{userId}/…` or `profiles/{userId}/…`).

**Success (200):** `{ ok: true, key: string }` — same `key` you sent, after the object is verified in R2 (**HEAD**). Pending upload metadata (declared size) must still exist (issued with upload-url, short TTL). Clients persist `key`; public URLs are produced only in read APIs.

**Behaviour:** Rejects cross-user keys (**403** `FORBIDDEN`). Verifies object exists and **Content-Length** is within **±5%** of the declared `sizeBytes` from upload-url. On mismatch or missing object: **400** `UPLOAD_NOT_FOUND`.

**Errors:** **400** `UPLOAD_NOT_FOUND` | `INVALID_INPUT`; **403** `FORBIDDEN`; **503** `SERVICE_UNAVAILABLE` if R2 is not configured.

### Admin

**Admin-only — every route below except `POST /admin/login` requires header `X-Admin-Token: Bearer <token>`** where `<token>` is the JWT returned by login (24h TTL, HS256 with `JWT_SECRET`, payload includes `purpose: 'admin'`).

`POST /admin/login` accepts `{ password: string }` (must match `ADMIN_PASSWORD`, constant-time compare). **401** on wrong password. **429** after **5 failed attempts per IP per 15 minutes** (`Retry-After: 900`). In **production**, the app refuses to boot if `ADMIN_PASSWORD` is missing or shorter than 16 characters.

#### POST /admin/login

**Auth:** None.

**Body:** `{ password: string }`

**Success (200):** `{ token: string; expiresIn: number }` — `expiresIn` is seconds (86400).

**Errors:** `401` invalid password; `403` admin password not configured; `429` login rate limit.

---

#### GET /admin/reports

**Auth:** Admin header.

**Query:** `status?` (`PENDING` \| `REVIEWING` \| `RESOLVED` \| `DISMISSED`), `cursor?`, `limit?` (default **30**, max **100**).

**Success (200):** `{ items: AdminReportDto[]; nextCursor: string | null; hasMore: boolean }` — reports ordered by `createdAt` ascending (oldest first) within the filtered set.

**AdminReportDto** extends user-facing report info with reporter/reported emails and names, `detail`, `resolverNotes`, counts `filedByReporterCount` / `receivedByReportedCount`, and `conversationMessages` (last **5** messages in chronological order when `conversationId` is set).

---

#### PATCH /admin/reports/:id

**Auth:** Admin header.

**Body:** `{ status: 'REVIEWING' | 'RESOLVED' | 'DISMISSED'; resolverNotes?: string }`

**Success (200):** Updated `AdminReportDto`. Setting a terminal status sets `resolvedAt`.

---

#### GET /admin/manual-reviews

**Auth:** Admin header.

**Query:** `status?` (defaults to **PENDING**), `cursor?`, `limit?` (default **30**, max **50**).

**Success (200):** `{ items: { id, email, companyClaim, status, createdAt }[]; nextCursor: string | null; hasMore: boolean }`

---

#### POST /admin/manual-reviews/:id/approve

**Auth:** Admin header.

**Success (200):** `{ ok: true, approvedDomain: string, affectedUsers: number }` — marks request approved, upserts **CompanyAllowlist** for the email’s domain, sets matching user(s) with that email to `companyVerified: true` where applicable, sends welcome email.

**Errors:** `404` if not pending.

---

#### POST /admin/manual-reviews/:id/reject

**Auth:** Admin header.

**Body:** `{ reason?: string }`

**Success (200):** `{ ok: true }` — marks rejected, optional `rejectReason`, sends polite rejection email.

---

#### GET /admin/users/:userId

**Auth:** Admin header.

**Success (200):** Aggregated view: `user` (core fields), `profile`, `listing`, `conversationsCount`, `reportsFiled`, `reportsReceived`, `blocksInitiated`, `blocksReceived` (bounded lists).

---

#### POST /admin/users/:userId/ban

**Auth:** Admin header.

**Body:** `{ reason: string; internalNotes?: string }` — `internalNotes` accepted for forward compatibility; ban email uses `reason`.

**Success (200):** `{ ok: true, bannedAt: string }` — soft-deletes user (`deletedAt`), deactivates listing, soft-deletes profile, resolves **PENDING** reports against that user with resolver note `User banned: {reason}`, sends suspension email with appeal address.

**Errors:** `404` if user already gone.
