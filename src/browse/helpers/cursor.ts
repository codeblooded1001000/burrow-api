import { HttpException, HttpStatus } from '@nestjs/common';

export type BrowseSortMode = 'newest' | 'soonest_move_in' | 'best_match';

const CURSOR_VERSION = 1 as const;

export interface NewestCursorPayload {
  v: typeof CURSOR_VERSION;
  sort: 'newest';
  createdAt: string;
  id: string;
}

export interface SoonestCursorPayload {
  v: typeof CURSOR_VERSION;
  sort: 'soonest_move_in';
  availableFrom: string;
  id: string;
}

export type BrowseCursorPayload = NewestCursorPayload | SoonestCursorPayload;

export function encodeBrowseCursor(payload: BrowseCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeBrowseCursor(raw: string | undefined, sort: BrowseSortMode): BrowseCursorPayload | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new HttpException(
      { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
      HttpStatus.BAD_REQUEST,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new HttpException(
      { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
      HttpStatus.BAD_REQUEST,
    );
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== CURSOR_VERSION) {
    throw new HttpException(
      { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
      HttpStatus.BAD_REQUEST,
    );
  }
  if (o.sort === 'newest' && typeof o.createdAt === 'string' && typeof o.id === 'string') {
    const payload: NewestCursorPayload = { v: CURSOR_VERSION, sort: 'newest', createdAt: o.createdAt, id: o.id };
    if (sort !== 'newest' && sort !== 'best_match') {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Cursor does not match sort mode.' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return payload;
  }
  if (o.sort === 'soonest_move_in' && typeof o.availableFrom === 'string' && typeof o.id === 'string') {
    const payload: SoonestCursorPayload = {
      v: CURSOR_VERSION,
      sort: 'soonest_move_in',
      availableFrom: o.availableFrom,
      id: o.id,
    };
    if (sort !== 'soonest_move_in') {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Cursor does not match sort mode.' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return payload;
  }
  throw new HttpException(
    { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
    HttpStatus.BAD_REQUEST,
  );
}
