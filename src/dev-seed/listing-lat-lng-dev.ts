import {
  GURGAON_LAT_MAX,
  GURGAON_LAT_MIN,
  GURGAON_LNG_MAX,
  GURGAON_LNG_MIN,
} from '../maps/gurgaon-place';

const LAT_PAD = 0.02;
const LNG_PAD = 0.02;

/**
 * Deterministic lat/lng inside the Gurgaon bbox for dev seeds and DB scripts.
 * Lays out `totalCount` points on a grid so each index in `0..totalCount-1` is unique
 * (wrapping index with `% totalCount` if needed).
 */
export function spreadListingLatLng(index: number, totalCount: number): { lat: number; lng: number } {
  const n = Math.max(1, totalCount);
  const i = ((index % n) + n) % n;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const lat0 = GURGAON_LAT_MIN + LAT_PAD;
  const lat1 = GURGAON_LAT_MAX - LAT_PAD;
  const lng0 = GURGAON_LNG_MIN + LNG_PAD;
  const lng1 = GURGAON_LNG_MAX - LNG_PAD;
  const row = Math.floor(i / cols);
  const col = i % cols;
  const denomR = Math.max(rows - 1, 1);
  const denomC = Math.max(cols - 1, 1);
  const lat = lat0 + (row / denomR) * (lat1 - lat0);
  const lng = lng0 + (col / denomC) * (lng1 - lng0);
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}
