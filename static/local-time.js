// Format SSR timestamps in the site's fixed interface timezone.
// English uses New York time; Chinese uses Beijing time. This keeps the same
// page consistent across devices instead of changing with browser location.
(function () {
  var SQLITE_UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

  function parseStoredUtc(value) {
    var stringValue = String(value);
    var sqliteMatch = stringValue.match(SQLITE_UTC_TIMESTAMP_PATTERN);
    return new Date(sqliteMatch ? sqliteMatch[1] + 'T' + sqliteMatch[2] + 'Z' : stringValue);
  }

  function timezone() {
    return document.documentElement.lang === 'zh-CN'
      ? 'Asia/Shanghai'
      : 'America/New_York';
  }

  function render(element) {
    var iso = element.getAttribute('data-local-time');
    if (!iso) return;
    var date = parseStoredUtc(iso);
    if (Number.isNaN(date.getTime())) return;

    var lang = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en-US';
    var format = element.getAttribute('data-local-format') === 'date' ? 'date' : 'datetime';
    var options = format === 'date'
      ? { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: timezone() }
      : {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: timezone(),
        };
    var value = new Intl.DateTimeFormat(lang, options).format(date);
    element.textContent = format === 'date' ? value : value + ' ' + timezone();
    element.title = timezone();
  }

  function renderAll() {
    document.querySelectorAll('[data-local-time]').forEach(render);
  }

  renderAll();
  document.addEventListener('DOMContentLoaded', renderAll);
})();
