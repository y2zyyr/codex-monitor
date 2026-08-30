import type { MonitorEvent } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const SQLITE_UTC_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

type ResetHistoryEvent = Pick<MonitorEvent, 'published_at' | 'created_at'>;

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;

  const sqliteMatch = value.match(SQLITE_UTC_TIMESTAMP);
  const normalized = sqliteMatch ? `${sqliteMatch[1]}T${sqliteMatch[2]}Z` : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Prefer the public publication time, falling back to the local record time
 * when a source did not expose a usable publication timestamp.
 */
export function resetEventTimestamp(event: ResetHistoryEvent): number | null {
  return parseTimestamp(event.published_at) ?? parseTimestamp(event.created_at);
}

export interface ResetIntervalStats {
  averageDays: number | null;
  count: number;
}

/** Calculate the average interval across the newest completed reset records. */
export function calculateAverageResetIntervalDays(
  events: ResetHistoryEvent[],
  limit = 5,
): ResetIntervalStats {
  const effectiveLimit = Number.isInteger(limit) ? Math.max(2, limit) : 5;
  const timestamps = events
    .map(resetEventTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((left, right) => left - right)
    .slice(-effectiveLimit);

  if (timestamps.length < 2) {
    return { averageDays: null, count: timestamps.length };
  }

  let totalIntervalMs = 0;
  for (let index = 1; index < timestamps.length; index += 1) {
    totalIntervalMs += timestamps[index] - timestamps[index - 1];
  }

  return {
    averageDays: totalIntervalMs / (timestamps.length - 1) / DAY_MS,
    count: timestamps.length,
  };
}

/** Return elapsed full days since a timestamp, never below zero. */
export function daysSinceTimestamp(timestamp: number | null, now = Date.now()): number | null {
  if (timestamp === null || !Number.isFinite(timestamp) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - timestamp) / DAY_MS));
}
