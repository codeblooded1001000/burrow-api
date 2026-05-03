import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { UserDto } from '../auth/schemas/auth.schemas';
import type { Env } from '../config/env.schema';
import { ListingsService } from '../listings/listings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getCachedCommute, setCachedCommute, type CachedCommutePayload } from './cache/commute-cache';
import { addressComponentsSuggestGurgaon, isWithinGurgaonBbox } from './gurgaon-place';

export type CommuteReason =
  | 'OK'
  | 'ESTIMATE'
  | 'NO_OFFICE_SET'
  | 'NO_LISTING_LOCATION'
  | 'BUDGET_EXCEEDED'
  | 'API_ERROR';

export interface CommuteResponse {
  commute: {
    distanceMeters: number;
    durationSeconds: number;
    durationInTrafficSeconds: number;
    mode: 'driving' | 'straight_line';
  } | null;
  reason: CommuteReason;
  cached: boolean;
}

export interface ValidatePlaceSuccess {
  valid: true;
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId: string;
  locality?: string;
}

export interface ValidatePlaceFailure {
  valid: false;
  reason: 'OUT_OF_BOUNDS' | 'API_ERROR';
}

export type ValidatePlaceResponse = ValidatePlaceSuccess | ValidatePlaceFailure;

const FETCH_TIMEOUT_MS = 5000;

@Injectable()
export class MapsService {
  constructor(
    private readonly listings: ListingsService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
    @InjectPinoLogger(MapsService.name) private readonly logger: PinoLogger,
  ) {}

  private dailyBudgetLimit(): number {
    const raw = this.config.get('MAPS_DAILY_BUDGET', { infer: true });
    if (raw.length === 0) return 1000;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1000;
  }

  private dailyCountKey(): string {
    const d = new Date().toISOString().slice(0, 10);
    return `maps:dist-matrix:daily-count:${d}`;
  }

  private async incrementDailyCount(): Promise<number> {
    const key = this.dailyCountKey();
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 60 * 60 * 25);
    }
    return count;
  }

  private mapsApiKey(): string {
    return this.config.get('GOOGLE_MAPS_API_KEY', { infer: true });
  }

  async getCommute(viewer: UserDto, listingId: string): Promise<CommuteResponse> {
    const listing = await this.listings.getPublic(viewer.id, listingId);

    if (!Number.isFinite(listing.lat) || !Number.isFinite(listing.lng)) {
      return { commute: null, reason: 'NO_LISTING_LOCATION', cached: false };
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId: viewer.id },
      select: { officeLat: true, officeLng: true },
    });
    const officeLat = profile?.officeLat ?? null;
    const officeLng = profile?.officeLng ?? null;
    if (officeLat === null || officeLng === null || !Number.isFinite(officeLat) || !Number.isFinite(officeLng)) {
      return { commute: null, reason: 'NO_OFFICE_SET', cached: false };
    }

    const listingLat = listing.lat;
    const listingLng = listing.lng;

    const cached = await getCachedCommute(this.redis, listingLat, listingLng, officeLat, officeLng);
    if (cached) {
      return { commute: { ...cached }, reason: 'OK', cached: true };
    }

    const budget = this.dailyBudgetLimit();
    const used = await this.incrementDailyCount();
    if (used > budget) {
      await this.redis.decr(this.dailyCountKey());
      return { commute: null, reason: 'BUDGET_EXCEEDED', cached: false };
    }

    const apiKey = this.mapsApiKey();
    if (apiKey.length === 0) {
      this.logger.warn('maps_commute_no_api_key');
      await this.redis.decr(this.dailyCountKey());
      return { commute: null, reason: 'API_ERROR', cached: false };
    }

    try {
      const matrix = await this.callDistanceMatrix(
        { lat: listingLat, lng: listingLng },
        { lat: officeLat, lng: officeLng },
        apiKey,
      );
      const commute: CachedCommutePayload = {
        distanceMeters: matrix.distanceMeters,
        durationSeconds: matrix.durationSeconds,
        durationInTrafficSeconds: matrix.durationInTrafficSeconds,
        mode: 'driving',
      };
      await setCachedCommute(this.redis, listingLat, listingLng, officeLat, officeLng, commute);
      return { commute: { ...commute }, reason: 'OK', cached: false };
    } catch (err: unknown) {
      this.logger.warn({ err }, 'maps_distance_matrix_failed');
      await this.redis.decr(this.dailyCountKey());
      const fallback = straightLineCommuteEstimate(listingLat, listingLng, officeLat, officeLng);
      this.logger.warn(
        { listingId, hint: 'Enable Distance Matrix API and use a server key (not browser referrer–restricted).' },
        'maps_commute_falling_back_to_straight_line_estimate',
      );
      return { commute: fallback, reason: 'ESTIMATE', cached: false };
    }
  }

  async validatePlace(placeId: string): Promise<ValidatePlaceResponse> {
    const key = this.mapsApiKey();
    if (key.length === 0) {
      this.logger.warn('maps_validate_no_api_key');
      return { valid: false, reason: 'API_ERROR' };
    }
    try {
      const details = await this.callPlaceDetails(placeId, key);
      const lat = details.lat;
      const lng = details.lng;
      if (!isWithinGurgaonBbox(lat, lng)) {
        return { valid: false, reason: 'OUT_OF_BOUNDS' };
      }
      if (!addressComponentsSuggestGurgaon(details.addressComponents)) {
        return { valid: false, reason: 'OUT_OF_BOUNDS' };
      }
      return {
        valid: true,
        lat,
        lng,
        formattedAddress: details.formattedAddress,
        placeId: details.placeId,
        ...(details.locality !== undefined ? { locality: details.locality } : {}),
      };
    } catch (err: unknown) {
      this.logger.warn({ err }, 'maps_place_details_failed');
      return { valid: false, reason: 'API_ERROR' };
    }
  }

  private async callDistanceMatrix(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    apiKey: string,
  ): Promise<{ distanceMeters: number; durationSeconds: number; durationInTrafficSeconds: number }> {
    const fetchMatrix = async (withTraffic: boolean): Promise<DistanceMatrixJson> => {
      const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
      url.searchParams.set('origins', `${String(origin.lat)},${String(origin.lng)}`);
      url.searchParams.set('destinations', `${String(destination.lat)},${String(destination.lng)}`);
      url.searchParams.set('mode', 'driving');
      if (withTraffic) {
        url.searchParams.set('traffic_model', 'best_guess');
        url.searchParams.set('departure_time', String(Math.floor(Date.now() / 1000) + 3600));
      }
      url.searchParams.set('key', apiKey);
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        throw new Error(`http_${String(res.status)}`);
      }
      return (await res.json()) as DistanceMatrixJson;
    };

    const parseOk = (data: DistanceMatrixJson): { distanceMeters: number; durationSeconds: number; durationInTrafficSeconds: number } => {
      if (data.status !== 'OK') {
        const hint = data.error_message ? ` ${sanitizeGoogleDistanceMatrixError(data.error_message)}` : '';
        throw new Error(`matrix_status_${data.status}${hint}`);
      }
      const row = data.rows?.[0];
      const el = row?.elements?.[0];
      if (el?.status !== 'OK') {
        throw new Error(`element_status_${el?.status ?? 'missing'}`);
      }
      const distanceMeters = el.distance?.value;
      const durationSeconds = el.duration?.value;
      const inTraffic = el.duration_in_traffic?.value ?? durationSeconds;
      if (
        typeof distanceMeters !== 'number' ||
        typeof durationSeconds !== 'number' ||
        typeof inTraffic !== 'number'
      ) {
        throw new Error('matrix_bad_values');
      }
      return {
        distanceMeters,
        durationSeconds,
        durationInTrafficSeconds: inTraffic,
      };
    };

    let data = await fetchMatrix(true);
    try {
      return parseOk(data);
    } catch (err: unknown) {
      this.logger.warn(
        { err, googleStatus: data.status, googleError: data.error_message },
        'maps_distance_matrix_with_traffic_failed_retrying_without_traffic',
      );
    }

    data = await fetchMatrix(false);
    return parseOk(data);
  }

  private async callPlaceDetails(
    placeId: string,
    apiKey: string,
  ): Promise<{
    lat: number;
    lng: number;
    formattedAddress: string;
    placeId: string;
    addressComponents: { long_name?: string; short_name?: string }[];
    locality?: string;
  }> {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'geometry,address_components,formatted_address');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`http_${String(res.status)}`);
    }
    const data = (await res.json()) as PlaceDetailsJson;
    if (data.status !== 'OK' || !data.result) {
      throw new Error(`place_status_${data.status}`);
    }
    const loc = data.result.geometry?.location;
    if (loc === undefined || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      throw new Error('place_no_geometry');
    }
    const components = data.result.address_components ?? [];
    const locality = components.find(
      (c) => c.types.includes('sublocality_level_1') || c.types.includes('locality'),
    )?.long_name;

    return {
      lat: loc.lat,
      lng: loc.lng,
      formattedAddress: data.result.formatted_address ?? '',
      placeId: data.result.place_id ?? placeId,
      addressComponents: components.map((c) => ({
        long_name: c.long_name,
        short_name: c.short_name,
      })),
      ...(typeof locality === 'string' && locality.length > 0 ? { locality } : {}),
    };
  }
}

interface DistanceMatrixElementJson {
  status: string;
  distance?: { value: number };
  duration?: { value: number };
  duration_in_traffic?: { value: number };
}

interface DistanceMatrixRowJson {
  elements?: DistanceMatrixElementJson[];
}

interface DistanceMatrixJson {
  status: string;
  error_message?: string;
  rows?: DistanceMatrixRowJson[];
}

/** Redacts key material from Google error strings before logging. */
function sanitizeGoogleDistanceMatrixError(message: string): string {
  return message.replace(/\bAIza[0-9A-Za-z\-_]{20,}\b/g, 'AIza…').slice(0, 400);
}

/** Haversine distance in meters between two WGS84 points. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * When Distance Matrix is unavailable (e.g. REQUEST_DENIED, billing, wrong key restrictions),
 * return an approximate drive distance/time from straight-line geometry (not cached).
 */
function straightLineCommuteEstimate(
  listingLat: number,
  listingLng: number,
  officeLat: number,
  officeLng: number,
): NonNullable<CommuteResponse['commute']> {
  const crow = haversineMeters(listingLat, listingLng, officeLat, officeLng);
  const roadStretch = 1.32;
  const distanceMeters = Math.max(1, Math.round(crow * roadStretch));
  const avgMps = 5.2;
  const durationSeconds = Math.max(90, Math.round(distanceMeters / avgMps));
  const durationInTrafficSeconds = Math.round(durationSeconds * 1.12);
  return {
    distanceMeters,
    durationSeconds,
    durationInTrafficSeconds,
    mode: 'straight_line',
  };
}

interface PlaceDetailsAddressComponentJson {
  long_name: string;
  short_name: string;
  types: string[];
}

interface PlaceDetailsJson {
  status: string;
  result?: {
    place_id?: string;
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
    address_components?: PlaceDetailsAddressComponentJson[];
  };
}
