// Format SSR timestamps in the site's fixed interface timezone.
(function () {
  'use strict';

  var timeApi = window.TiboLocaleTime;
  var SQLITE_UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

  function parseStoredUtc(value) {
    if (timeApi && typeof timeApi.parseStoredUtc === 'function') return timeApi.parseStoredUtc(value);
    var stringValue = String(value);
    var sqliteMatch = stringValue.match(SQLITE_UTC_TIMESTAMP_PATTERN);
    return new Date(sqliteMatch ? sqliteMatch[1] + 'T' + sqliteMatch[2] + 'Z' : stringValue);
  }

  function localeKey() {
    return timeApi ? timeApi.localeKey(document.documentElement.lang) : 'en';
  }

  function timezone() {
    return timeApi ? timeApi.timeZone(document.documentElement.lang) : '';
  }

  function render(element) {
    if (!timeApi) return;
    var iso = element.getAttribute('data-local-time');
    if (!iso) return;
    var date = parseStoredUtc(iso);
    if (Number.isNaN(date.getTime())) return;

    var key = localeKey();
    var lang = timeApi.intlLocale(document.documentElement.lang);
    var format = element.getAttribute('data-local-format') === 'date' ? 'date' : 'datetime';
    var options = format === 'date'
      ? { month: key === 'zh' ? 'numeric' : 'short', day: 'numeric', timeZone: timezone() }
      : {
          year: 'numeric',
          month: key === 'zh' ? 'numeric' : 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: key === 'en',
          timeZone: timezone(),
          timeZoneName: 'short',
        };
    if (format === 'date' && key === 'zh') options.year = 'numeric';
    var value = new Intl.DateTimeFormat(lang, options).format(date);
    element.textContent = value;
    element.title = value;
  }

  function renderAll() {
    document.querySelectorAll('[data-local-time]').forEach(render);
  }

  renderAll();
  document.addEventListener('DOMContentLoaded', renderAll);
})();
