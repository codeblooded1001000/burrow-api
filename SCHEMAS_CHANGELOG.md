# Schemas Changelog

> Track breaking changes to API contracts so the frontend can sync. Append a new entry every time you make a backwards-incompatible change to an endpoint, request shape, response shape, or error code.

## Format

Each entry: date, endpoint, change description, frontend impact.

## Entries

### 2026-05-03 — Messaging request gate

- Added `Conversation.status` (`PENDING` / `ACTIVE` / `REJECTED` / `ARCHIVED`), `initiatedByUserId`, `acceptedAt`, `rejectedAt`, `rejectedByUserId`, `archivedAt`, `rejectReason` (see migration `20260506120000_messaging_request_gate`).
- New endpoints: `POST /conversations/:id/accept`, `POST /conversations/:id/reject`, `GET /conversations/sent-requests`.
- New SSE events: `request_received`, `request_accepted`, `request_rejected`.
- **BREAKING (frontend):** `GET /conversations` takes `?tab=` (`active` \| `requests` \| `all`; default `active`). Pagination cursor for `tab=requests` uses **v2** payload `{ v: 2, createdAt, id }`; `active` / `all` keep **v1** `{ v: 1, lastMessageAt, id }`.
- **BREAKING (frontend):** `POST /conversations` creates **`PENDING`**; initiator cannot send a second message until the thread is **`ACTIVE`** (`403` `REQUEST_PENDING_ACCEPTANCE`). Intro does not emit `message_new` to the receiver (`request_received` instead).
- **Policy:** If the pair was **`REJECTED`** with the same initiator, a new request returns **`404`** `CANNOT_SEND_REQUEST`. Opposite-direction re-request after reject, and re-open after **`ARCHIVED`**, reuse the same row.
- `GET /messages/unread-count` counts unread only in **`ACTIVE`** threads.
- **Safety:** Blocking or reporting auto-rejects **`PENDING`** conversations where the blocked/reported user had sent the request to the blocker/reporter.
- Frontend impact: inbox **Messages \| Requests** tabs; **Sent** list (`/conversations/sent-requests`); accept / reject / reply flows; SSE handlers; compose copy (“Send request”); after send, route to sent list; badge = unread + incoming request count.

### 2026-05-02 — Initial setup

- Added GET /health
- Frontend impact: none (new endpoint)

### 2026-05-02 — Auth system

- Added all `/auth/*` endpoints (signup OTP + PIN, login, logout, email/phone recovery, manual review, session `GET /auth/me`).
- Introduced `Role.ONBOARDING` in API responses as `user.role: null` until onboarding picks LISTER/SEEKER/BOTH.
- Frontend impact: implement signup, login, recovery, and session bootstrap using cookie `burrow_session`; read `UserDto` from `GET /auth/me`; handle `423 ACCOUNT_LOCKED` and `429 RATE_LIMIT` with `Retry-After` where applicable.

### 2026-05-02 — Users, profiles, listings, constants

- Added `PATCH /users/me/role`, `PATCH /users/me/phone`, `POST /users/me/phone/verify`, `DELETE /users/me`, `GET /users/me/export`.
- Added `GET|PUT|PATCH /profiles/me`, `GET /profiles/:userId` with `ProfilePublicDto` / `ProfileOwnDto`.
- Added listing CRUD under `/listings/me`, public `GET /listings/:listingId`, and stub `POST /listings/me/photos/upload-url` (R2 in prompt 08).
- Added public `GET /constants` (localities, vibes, schedule, interests, personality, professions, amenities).
- Prisma: nullable profile fields (`profession`, `workSchedule`, budgets, `moveInDate`, prefs) and nullable `Listing.foodPref` / `workSchedulePref` for partial onboarding.
- `UserDto.hasProfile` / `hasListing` ignore soft-deleted profile and inactive listings; profile completion rules match master spec weights.
- Frontend impact: wire onboarding → role → profile → listing; use constants endpoint instead of duplicating arrays; listing photos must use HTTPS URLs under `R2_PUBLIC_URL` (or default `https://cdn.burrow.in/`); upload stub returns placeholder URLs until R2.

### 2026-05-02 — Browse

- Added `GET /browse/flats` and `GET /browse/flatmates` with cursor pagination, filters, `matchScore` on each row, and per-user daily browse cap (Redis; optional `BROWSE_DAILY_MAX`).
- Prisma: browse-support indexes on `Listing` / `Profile` (see migration `20260503120000_browse_indexes`).
- Frontend impact: seekers use `/browse/flats` with `cursor` + `hasMore`; listers use `/browse/flatmates`; send `sort=soonest_move_in` only for flats; handle `429` browse cap with `Retry-After`; `GET /constants` is cacheable for 1h (`Cache-Control`).

### 2026-05-02 — Messaging

- Added `GET|POST /conversations`, `GET /conversations/:id`, message history and send/read under `/conversations/:id/messages`, number-share `POST .../number-share/request|respond`, `GET /messages/unread-count`, and **SSE** `GET /messages/stream` with in-memory fan-out (see `API_CONTRACT.md` for event shapes).
- Prisma indexes for conversation list performance (`messaging_indexes` migration).
- Frontend impact: implement inbox from `GET /conversations` (`Cache-Control: no-store`); open SSE with cookies for live updates, or poll conversations every ~5s as fallback; phone numbers only after successful number share; handle `BLOCKED_BY_USER` / `YOU_BLOCKED_USER` and messaging `429` + `Retry-After`.

### 2026-05-02 — Safety and admin moderation

- Added blocks, reports, admin moderation: `POST|GET|DELETE /blocks`, `POST /reports`, `GET /reports/mine`; admin JWT via `POST /admin/login` and `X-Admin-Token: Bearer …` for `/admin/reports`, `/admin/manual-reviews`, `/admin/users/:userId`, ban.
- Reporting auto-blocks the reported user; duplicate PENDING reports on the same `(reporter, reported, conversation)` return the existing row.
- `GET /listings/:id` and `GET /profiles/:userId` return **404** when the resource owner has blocked the viewer.
- Prisma: optional `ManualReviewRequest.rejectReason` (see migration `20260505120000_manual_review_reject_reason`).
- Frontend impact: safety settings UI (block list, report flow); admin panel uses login + `X-Admin-Token` only (never put the token in URLs); handle `429` on admin login with `Retry-After`.

### 2026-05-02 — Maps

- Added `GET /maps/commute` and `POST /maps/validate-place`.
- Frontend impact: listing detail calls commute with `listingId` query; listing creation debounces `validate-place` with `placeId` from Autocomplete; handle `commute: null` with `reason` (no office, budget, API); optional `MAPS_DAILY_BUDGET` for Distance Matrix daily cap. Commute may return `reason: ESTIMATE` and `mode: straight_line` when Matrix fails (retry without traffic, then local fallback).

### 2026-05-02 — R2 uploads

- Replaced stub `POST /listings/me/photos/upload-url` with real Cloudflare R2 presigned **PUT** URLs; added `POST /profiles/me/photo/upload-url` and `POST /uploads/confirm`.
- Listing `photos[]` / profile `photoUrl` accept R2 object keys or legacy HTTPS under `R2_PUBLIC_URL` (default `https://cdn.burrow.in/`); external image hosts are not accepted for new writes.
- Frontend impact: after `upload-url`, **PUT** the file to `uploadUrl`, then **confirm** with `{ key, type }`, then save **`key`** on listing/profile; handle **429** on URL generation with `Retry-After`; optional `UPLOAD_URL_GEN_PER_HOUR`.

### 2026-05-02 — Media: store R2 keys, URLs on GET only

- **`POST /profiles/me/photo/upload-url`** and **`POST /listings/me/photos/upload-url`** responses no longer include `publicUrl`; responses are `{ uploadUrl, key, expiresAt }`.
- **`POST /uploads/confirm`** returns `{ ok: true, key }` instead of `{ ok: true, publicUrl }`.
- Persist **`key`** as profile `photoUrl` / listing `photos[]`; read APIs (`GET` profile, listing, browse, auth user, messaging participant, block list) return full HTTPS URLs by joining `R2_PUBLIC_URL` with the stored key (legacy full HTTPS URLs in DB still work).
- Frontend impact: stop reading `publicUrl` from upload-url/confirm; save `key` from confirm (or upload-url) into profile/listing payloads; `<img src>` continues to use URLs from GET responses only.
