# Architecture

## Overview

Burrow API is a NestJS 10 service on Node.js 20. It exposes HTTP JSON under the global prefix `/api/v1`. PostgreSQL (Prisma) holds durable state; Redis holds ephemeral data (OTP hashes, rate limits, commute cache in later prompts). Email goes through a pluggable `MailService` (console stub today; Resend in prompt 02).

## Auth (prompt 02)

1. Client calls public auth endpoints with corporate email.
2. Server validates domain rules, stores hashed OTP in Redis, sends mail via Resend.
3. After OTP + PIN signup or PIN login, server issues an HS256 JWT and sets the `burrow_session` httpOnly cookie.
4. Protected routes run a guard that verifies JWT and loads `sub` / `role` onto the request for `@CurrentUser()`.

## Messaging (later prompts)

- Conversations are deduplicated in Postgres with a composite unique key on ordered participant IDs (`participantAUserId` &lt; `participantBUserId` lexicographically).
- New message rows are written to Postgres; Redis backs rate limits and optional realtime fan-out (SSE in a later prompt).

## Scaling notes

- Stateless API instances behind a load balancer; all session state lives in the JWT cookie + Redis.
- Prisma connection pool per instance; tune `DATABASE_URL` pool params for Neon/Railway.
- Redis is the primary coordination point for OTP, PIN lockouts, and rate limits — keep latency low and enable persistence in production if needed for recovery.
