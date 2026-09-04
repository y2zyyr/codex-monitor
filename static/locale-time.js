/* Shared locale/timezone helpers for SSR timestamp hydration and client UI. */
(function (global) {
  'use strict';

  var timezoneByLocale = global.__TIBO_LOCALE_TIMEZONES__ || {};
  var sqliteUtcTimestampPattern = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

  function localeKey(value) {
    var normalized = String(value || '').toLowerCase();
    if (normalized.indexOf('zh') === 0) return 'zh';
    if (normalized.indexOf('ja') === 0) return 'ja';
    if (normalized.indexOf('es') === 0) return 'es';
    if (normalized.indexOf('fr') === 0) return 'fr';
    return 'en';
  }

  function intlLocale(value) {
    var key = localeKey(value);
    if (key === 'zh') return 'zh-CN';
    if (key === 'ja') return 'ja-JP';
    if (key === 'es') return 'es-ES';
    if (key === 'fr') return 'fr-FR';
    return 'en-US';
  }

  function timeZone(value) {
    var configured = timezoneByLocale[localeKey(value)];
    if (typeof configured === 'string' && configured) return configured;
    return timezoneByLocale.en || 'UTC';
  }

  function parseStoredUtc(value) {
    if (value === null || value === undefined || value === '') return new Date(NaN);
    var stringValue = String(value);
    var sqliteMatch = stringValue.match(sqliteUtcTimestampPattern);
    return new Date(sqliteMatch ? sqliteMatch[1] + 'T' + sqliteMatch[2] + 'Z' : stringValue);
  }

  global.TiboLocaleTime = {
    intlLocale: intlLocale,
    localeKey: localeKey,
    parseStoredUtc: parseStoredUtc,
    timeZone: timeZone,
  };
})(window);
