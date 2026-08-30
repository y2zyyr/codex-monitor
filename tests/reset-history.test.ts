import { describe, expect, it } from 'vitest';
import {
  calculateAverageResetIntervalDays,
  daysSinceTimestamp,
  resetEventTimestamp,
} from '../src/utils/reset-history';

describe('reset history reference calculations', () => {
  it('prefers publication time and falls back to a SQLite UTC timestamp', () => {
    expect(resetEventTimestamp({
      published_at: '2026-08-27T12:00:00.000Z',
      created_at: '2026-08-27 13:00:00',
    })).toBe(Date.parse('2026-08-27T12:00:00.000Z'));

    expect(resetEventTimestamp({
      published_at: null,
      created_at: '2026-08-27 13:00:00',
    })).toBe(Date.parse('2026-08-27T13:00:00.000Z'));
  });

  it('calculates the average interval from the newest five records', () => {
    const events = [
      '2026-08-01T00:00:00.000Z',
      '2026-08-03T00:00:00.000Z',
      '2026-08-07T00:00:00.000Z',
      '2026-08-08T00:00:00.000Z',
      '2026-08-13T00:00:00.000Z',
      '2026-08-20T00:00:00.000Z',
    ].map(published_at => ({ published_at, created_at: undefined }));

    expect(calculateAverageResetIntervalDays(events)).toEqual({
      averageDays: 4.25,
      count: 5,
    });
  });

  it('does not report an average with fewer than two usable records', () => {
    expect(calculateAverageResetIntervalDays([
      { published_at: 'not-a-date', created_at: undefined },
    ])).toEqual({ averageDays: null, count: 0 });

    expect(calculateAverageResetIntervalDays([
      { published_at: '2026-08-20T00:00:00.000Z', created_at: undefined },
    ])).toEqual({ averageDays: null, count: 1 });
  });

  it('returns elapsed full days and clamps future timestamps to zero', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z');
    expect(daysSinceTimestamp(Date.parse('2026-08-24T11:59:59.000Z'), now)).toBe(3);
    expect(daysSinceTimestamp(Date.parse('2026-08-28T00:00:00.000Z'), now)).toBe(0);
    expect(daysSinceTimestamp(null, now)).toBeNull();
  });
});
