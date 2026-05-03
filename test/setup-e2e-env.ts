import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../.env') });
/** Lets `POST /maps/validate-place` e2e use a mocked `fetch` when `.env` has no Maps key. */
if (!process.env.GOOGLE_MAPS_API_KEY?.trim()) {
  process.env.GOOGLE_MAPS_API_KEY = 'e2e-maps-test-placeholder';
}
/** Deterministic admin password for e2e; Nest Config also merges `.env` at boot. */
if (process.env.NODE_ENV === 'test') {
  process.env.ADMIN_PASSWORD = 'e2e-admin-secret-16chars';
}
