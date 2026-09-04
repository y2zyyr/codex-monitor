// ============================================================
// Codex Usage Monitor - Timezone Conversion Utilities
// ============================================================
import { DISPLAY_TIME_ZONES, type DisplayTimeZone } from '../types';
import { SITE_HTML_LANG, type SiteLocale } from '../i18n';

export const ENGLISH_DISPLAY_TIME_ZONE: DisplayTimeZone = 'America/New_York';
export const CHINESE_DISPLAY_TIME_ZONE: DisplayTimeZone = 'Asia/Shanghai';
export const DEFAULT_TIMEZONE_BY_LOCALE: Record<SiteLocale, DisplayTimeZone> = {
  en: ENGLISH_DISPLAY_TIME_ZONE,
  zh: CHINESE_DISPLAY_TIME_ZONE,
  ja: 'Asia/Tokyo',
  fr: 'Europe/Paris',
  es: 'Europe/Madrid',
};

export function displayTimeZoneForLanguage(lang: SiteLocale | 'en-US' | 'zh-CN'): DisplayTimeZone {
  const locale = lang === 'en-US' ? 'en' : lang === 'zh-CN' ? 'zh' : lang;
  return DEFAULT_TIMEZONE_BY_LOCALE[locale as SiteLocale] ?? DEFAULT_TIMEZONE_BY_LOCALE.en;
}

export function isDisplayTimeZone(value: string | null | undefined): value is DisplayTimeZone {
  return DISPLAY_TIME_ZONES.includes(value as DisplayTimeZone);
}

const SQLITE_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/** Parse timestamps written by SQLite as UTC, even when they omit the Z. */
export function parseStoredUtc(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a canonical instant for the interface locale's default timezone. */
export function formatDateTimeForLocale(
  value: string | Date | null | undefined,
  lang: SiteLocale,
): string {
  if (!value) return '';
  const date = parseStoredUtc(value);
  if (!date) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(SITE_HTML_LANG[lang], {
    timeZone: displayTimeZoneForLanguage(lang),
    year: 'numeric',
    month: lang === 'zh' ? 'numeric' : 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: lang === 'en',
    timeZoneName: 'short',
  }).format(date);
}

/** Format a calendar date for grouping/list labels in the interface locale. */
export function formatDateShortForLocale(
  value: string | Date | null | undefined,
  lang: SiteLocale,
): string {
  if (!value) return '';
  const date = parseStoredUtc(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(SITE_HTML_LANG[lang], {
    timeZone: displayTimeZoneForLanguage(lang),
    ...(lang === 'zh' ? { year: 'numeric' as const } : {}),
    month: lang === 'zh' ? 'numeric' : 'short',
    day: 'numeric',
  }).format(date);
}

export interface DisplayDateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

/** Return calendar parts in one of the interface's fixed display timezones. */
export function datePartsInTimeZone(
  value: string | Date,
  timeZone: DisplayTimeZone,
): DisplayDateParts | null {
  const date = parseStoredUtc(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const getValue = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return {
    year: getValue('year'),
    month: getValue('month'),
    day: getValue('day'),
    hour: getValue('hour') === '24' ? '00' : getValue('hour'),
    minute: getValue('minute'),
    second: getValue('second'),
  };
}

/** Convert a local midnight in an interface timezone to a UTC Date. */
export function utcForLocalDate(
  dateOnly: string,
  timeZone: DisplayTimeZone,
): Date {
  const targetWallClock = Date.parse(`${dateOnly}T00:00:00.000Z`);
  let guess = new Date(targetWallClock);
  // A local midnight is never more than a day from the same wall-clock time
  // interpreted as UTC. Two iterations also handle DST offset changes.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = datePartsInTimeZone(guess, timeZone);
    if (!parts) break;
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const offsetMs = representedAsUtc - guess.getTime();
    const adjusted = new Date(targetWallClock - offsetMs);
    if (adjusted.getTime() === guess.getTime()) return adjusted;
    guess = adjusted;
  }
  return guess;
}

/**
 * Timezone conversion utilities for Codex Usage Monitor.
 * Handles PT/PST/PDT correctly using IANA timezones.
 */

/**
 * Convert an ISO 8601 UTC string to Asia/Shanghai time.
 * Returns formatted string: "YYYY-MM-DD HH:mm CST"
 */
export function utcToBeijing(utcIso: string): string {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return 'Invalid date';

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const getValue = (type: string) => parts.find(p => p.type === type)?.value ?? '';

  return `${getValue('year')}-${getValue('month')}-${getValue('day')} ${getValue('hour')}:${getValue('minute')} CST`;
}

/**
 * Convert an ISO 8601 UTC string to America/Los_Angeles time.
 * Returns formatted string: "YYYY-MM-DD HH:mm PT" (with PDT/PST offset)
 */
export function utcToPacific(utcIso: string): string {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return 'Invalid date';

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });

  return formatter.format(d);
}

/**
 * Format an ISO 8601 UTC string to a human-readable format.
 * Example: "Aug 24, 2026 · 08:46 UTC"
 */
export function formatUtc(utcIso: string): string {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return 'Invalid date';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const month = months[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');

  return `${month} ${day}, ${year} · ${hours}:${mins} UTC`;
}

/**
 * Format a date for timeline grouping (e.g., "Aug 25")
 */
export function formatDateShort(utcIso: string): string {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return 'Invalid';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Get relative time string (e.g., "14 min ago", "2 hours ago")
 */
export function timeAgo(utcIso: string): string {
  const now = Date.now();
  const then = new Date(utcIso).getTime();
  if (isNaN(then)) return 'Unknown';

  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

/**
 * Parse a time string that may contain PT/PST/PDT reference.
 * Strips the timezone info and attempts to parse the core time.
 * Does NOT convert - only parses what's given.
 * Returns null if the time cannot be reliably parsed.
 */
export function parseTimeFromText(text: string): string | null {
  // Match common time patterns like "2pm PT", "14:00 PT", "2:00 PM PST"
  // This is a basic parser - we don't convert relative times
  const timeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(pt|pst|pdt|pacific)?\b/i;
  const match = text.match(timeRegex);

  if (!match) return null;

  // We found a time reference but without an explicit date, 
  // we cannot reliably convert it. Return null.
  // The caller should not guess.
  return null;
}
