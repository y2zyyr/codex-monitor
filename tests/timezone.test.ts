import { describe, it, expect } from 'vitest';
import {
  CHINESE_DISPLAY_TIME_ZONE,
  ENGLISH_DISPLAY_TIME_ZONE,
  datePartsInTimeZone,
  displayTimeZoneForLanguage,
  formatDateShort,
  parseStoredUtc,
  parseTimeFromText,
  timeAgo,
  utcForLocalDate,
  utcToBeijing,
  utcToPacific,
  formatUtc,
} from '../src/utils/timezone';

describe('Timezone Conversion', () => {
  describe('language display timezones', () => {
    it('maps English to New York and Chinese to Beijing', () => {
      expect(displayTimeZoneForLanguage('en')).toBe(ENGLISH_DISPLAY_TIME_ZONE);
      expect(displayTimeZoneForLanguage('en-US')).toBe(ENGLISH_DISPLAY_TIME_ZONE);
      expect(displayTimeZoneForLanguage('zh')).toBe(CHINESE_DISPLAY_TIME_ZONE);
      expect(displayTimeZoneForLanguage('zh-CN')).toBe(CHINESE_DISPLAY_TIME_ZONE);
    });

    it('uses the selected timezone for calendar parts and local-midnight bounds', () => {
      const instant = '2026-08-27T03:59:59.000Z';
      expect(datePartsInTimeZone(instant, ENGLISH_DISPLAY_TIME_ZONE)).toMatchObject({
        year: '2026', month: '08', day: '26', hour: '23', minute: '59', second: '59',
      });
      expect(datePartsInTimeZone(instant, CHINESE_DISPLAY_TIME_ZONE)).toMatchObject({
        year: '2026', month: '08', day: '27', hour: '11', minute: '59', second: '59',
      });
      expect(utcForLocalDate('2026-08-27', ENGLISH_DISPLAY_TIME_ZONE).toISOString()).toBe('2026-08-27T04:00:00.000Z');
      expect(utcForLocalDate('2026-08-27', CHINESE_DISPLAY_TIME_ZONE).toISOString()).toBe('2026-08-26T16:00:00.000Z');
    });

    it('parses SQLite UTC timestamps without relying on the host timezone', () => {
      expect(parseStoredUtc('2026-08-27 03:59:59').toISOString()).toBe('2026-08-27T03:59:59.000Z');
    });
  });

  describe('utcToBeijing', () => {
    it('converts UTC to Beijing time correctly', () => {
      const result = utcToBeijing('2026-08-25T00:00:00.000Z');
      // Beijing is UTC+8, so 00:00 UTC = 08:00 Beijing
      expect(result).toContain('08:00');
      expect(result).toContain('CST');
      expect(result).toContain('2026-08-25');
    });

    it('handles date boundary crossing', () => {
      const result = utcToBeijing('2026-08-25T16:00:00.000Z');
      // 16:00 UTC = 00:00 next day Beijing
      expect(result).toContain('2026-08-26');
      expect(result).toContain('00:00');
    });

    it('returns "Invalid date" for invalid input', () => {
      expect(utcToBeijing('not-a-date')).toBe('Invalid date');
      expect(utcToBeijing('')).toBe('Invalid date');
    });
  });

  describe('utcToPacific', () => {
    it('converts UTC to Pacific time (PDT in summer)', () => {
      // August is PDT (UTC-7)
      const result = utcToPacific('2026-08-25T00:00:00.000Z');
      expect(result).toContain('PDT');
    });

    it('converts UTC to Pacific time (PST in winter)', () => {
      // January is PST (UTC-8)
      const result = utcToPacific('2026-01-15T00:00:00.000Z');
      expect(result).toContain('PST');
    });
  });

  describe('formatUtc', () => {
    it('formats date correctly', () => {
      const result = formatUtc('2026-08-25T00:46:00.000Z');
      expect(result).toContain('Aug');
      expect(result).toContain('25');
      expect(result).toContain('2026');
      expect(result).toContain('UTC');
    });
  });

  describe('formatDateShort', () => {
    it('returns short date format', () => {
      expect(formatDateShort('2026-08-25T00:00:00.000Z')).toBe('Aug 25');
      expect(formatDateShort('2026-01-01T00:00:00.000Z')).toBe('Jan 1');
    });
  });

  describe('timeAgo', () => {
    it('returns relative time', () => {
      const now = new Date().toISOString();
      expect(timeAgo(now)).toMatch(/^(\d+)s ago$/);

      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      expect(timeAgo(oneHourAgo)).toMatch(/^1h ago$/);
    });
  });

  describe('parseTimeFromText', () => {
    it('returns null for relative time references', () => {
      // Must NOT convert relative times
      expect(parseTimeFromText('Reset tomorrow')).toBeNull();
      expect(parseTimeFromText('Reset next week')).toBeNull();
      expect(parseTimeFromText('Coming soon')).toBeNull();
    });

    it('returns null for ambiguous times', () => {
      // Without a specific date, we should not convert
      expect(parseTimeFromText('Reset at 2pm PT')).toBeNull();
      expect(parseTimeFromText('Around 14:00 UTC')).toBeNull();
    });
  });
});
