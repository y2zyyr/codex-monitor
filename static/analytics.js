// ============================================================
// Tibo Codex Monitor - GA4 interaction measurement
// ============================================================
// The Google tag records page views. This small, site-wide layer records only
// useful interactions and deliberately avoids raw search terms, source text,
// emails, query strings, IP addresses, and credentials.

(function () {
  'use strict';

  var EVENT_NAMES = {
    view_event_detail: true,
    event_list_click: true,
    click_source_link: true,
    outbound_click: true,
    timeline_filter: true,
    site_search: true,
    export_events: true,
    language_switch: true,
    nav_click: true,
    github_click: true,
    utility_click: true,
  };

  var EVENT_CATEGORIES = {
    RESET_PLANNED: true,
    RESET_COMPLETED: true,
    RESET_TIME_CHANGED: true,
    POLICY_CHANGE: true,
    CODEX_UPDATE: true,
    ROADMAP_HINT: true,
    FEATURE_DISCUSSION: true,
  };

  var EVIDENCE_SOURCES = {
    official: true,
    web_indexed: true,
    x_direct: true,
    unknown: true,
  };

  var PAGE_TYPES = {
    home: true,
    latest: true,
    reset_history: true,
    rate_limit_updates: true,
    faq: true,
    methodology: true,
    community: true,
    event_detail: true,
    not_found: true,
    page: true,
  };

  var VERIFICATION_STATUSES = {
    DIRECT_VERIFIED: true,
    OFFICIAL_VERIFIED: true,
    INDEXED_ONLY: true,
    PENDING: true,
  };

  var MAX_STRING_LENGTH = 80;
  var lastSearchValue = null;
  var searchTimer = null;

  function cleanString(value, maxLength) {
    if (value === null || value === undefined) return '';
    var normalized = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
    return normalized.slice(0, maxLength || MAX_STRING_LENGTH);
  }

  function enumValue(value, allowed) {
    var normalized = cleanString(value);
    return allowed[normalized] ? normalized : '';
  }

  function pageLanguage() {
    var language = document.documentElement.lang || '';
    if (language === 'zh-CN') return 'zh';
    return /^(ja|es|fr)$/.test(language) ? language : 'en';
  }

  function pageType() {
    var annotated = document.querySelector('[data-analytics-page-type]');
    var annotatedType = annotated && annotated.getAttribute('data-analytics-page-type');
    if (annotatedType && PAGE_TYPES[annotatedType]) return annotatedType;

    var path = window.location.pathname || '/';
    if (path === '/' || path === '/zh' || path === '/zh/') return 'home';
    if (/(?:^|\/)events\/\d+\/?$/.test(path)) return 'event_detail';
    if (path.indexOf('/latest/') !== -1) return 'latest';
    if (path.indexOf('/reset-history/') !== -1) return 'reset_history';
    if (path.indexOf('/rate-limit-updates/') !== -1) return 'rate_limit_updates';
    if (path.indexOf('/faq/') !== -1) return 'faq';
    if (path.indexOf('/methodology/') !== -1) return 'methodology';
    if (path.indexOf('/community/') !== -1) return 'community';
    return document.querySelector('meta[name="robots"][content^="noindex"]') ? 'not_found' : 'page';
  }

  function baseParams() {
    return {
      page_language: pageLanguage(),
      page_type: pageType(),
      page_path: cleanString(window.location.pathname || '/', 200),
    };
  }

  function addStringParam(payload, params, key, maxLength, allowed) {
    var value = allowed ? enumValue(params[key], allowed) : cleanString(params[key], maxLength);
    if (value) payload[key] = value;
  }

  function addIntegerParam(payload, params, key, min, max) {
    var value = Number(params[key]);
    if (Number.isFinite(value) && value >= min && value <= max) payload[key] = Math.floor(value);
  }

  function sanitizeParams(params) {
    var payload = baseParams();
    var values = params || {};

    addStringParam(payload, values, 'event_id', 20);
    addStringParam(payload, values, 'event_category', MAX_STRING_LENGTH, EVENT_CATEGORIES);
    addStringParam(payload, values, 'evidence_source', MAX_STRING_LENGTH, EVIDENCE_SOURCES);
    addStringParam(payload, values, 'verification_status', MAX_STRING_LENGTH, VERIFICATION_STATUSES);
    addStringParam(payload, values, 'destination_domain', MAX_STRING_LENGTH);
    addStringParam(payload, values, 'view_method', 20);
    addStringParam(payload, values, 'filter_type', MAX_STRING_LENGTH);
    addStringParam(payload, values, 'export_format', 10);
    addStringParam(payload, values, 'search_location', 30);
    addStringParam(payload, values, 'nav_item', MAX_STRING_LENGTH);
    addStringParam(payload, values, 'placement', 40);
    addStringParam(payload, values, 'link_type', 30);
    addStringParam(payload, values, 'from_language', 10);
    addStringParam(payload, values, 'to_language', 10);
    addIntegerParam(payload, values, 'query_length', 0, 120);
    addIntegerParam(payload, values, 'result_count', 0, 10000);

    if (typeof values.has_date_filter === 'boolean') payload.has_date_filter = values.has_date_filter;
    if (typeof values.has_category_filter === 'boolean') payload.has_category_filter = values.has_category_filter;
    return payload;
  }

  function track(name, params) {
    if (!EVENT_NAMES[name] || typeof window.gtag !== 'function') return;
    window.gtag('event', name, sanitizeParams(params));
  }

  function closest(element, selector) {
    var current = element;
    while (current && current.nodeType === 1) {
      if (current.matches && current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function eventIdFromPath(pathname) {
    var match = String(pathname || '').match(/(?:^|\/)events\/(\d+)\/?$/);
    return match ? match[1] : '';
  }

  function categoryFromElement(element) {
    var direct = element && element.getAttribute('data-analytics-event-category');
    if (direct && EVENT_CATEGORIES[direct]) return direct;

    var item = closest(element, '.timeline-item, .landing-event-item, .event-detail-page');
    if (!item) return '';
    var classes = String(item.className || '').split(/\s+/);
    for (var index = 0; index < classes.length; index += 1) {
      if (EVENT_CATEGORIES[classes[index]]) return classes[index];
    }
    return '';
  }

  function evidenceSourceFromElement(element) {
    var direct = element && element.getAttribute('data-analytics-evidence-source');
    if (direct && EVIDENCE_SOURCES[direct]) return direct;

    var item = closest(element, '.timeline-item, .landing-event-item, .event-detail-page');
    var badge = item && item.querySelector('.source-quality-badge');
    if (!badge) return 'unknown';
    if (badge.classList.contains('official')) return 'official';
    if (badge.classList.contains('indexed')) return 'web_indexed';
    if (badge.classList.contains('direct')) return 'x_direct';
    return 'unknown';
  }

  function eventContextFromElement(element) {
    var id = element && element.getAttribute('data-analytics-event-id');
    if (!id) id = eventIdFromPath(element && element.getAttribute('href'));
    var context = {
      event_id: id || '',
      event_category: categoryFromElement(element),
      evidence_source: evidenceSourceFromElement(element),
    };
    var placement = element && element.getAttribute('data-analytics-placement');
    if (placement) context.placement = placement;
    return context;
  }

  function linkUrl(link) {
    try {
      return new URL(link.getAttribute('href') || '', window.location.href);
    } catch (_error) {
      return null;
    }
  }

  function normalizedDomain(url) {
    return url && url.hostname ? url.hostname.toLowerCase().replace(/^www\./, '') : '';
  }

  function isExternal(url) {
    return Boolean(url && /^https?:$/.test(url.protocol) && url.origin !== window.location.origin);
  }

  function navItem(pathname) {
    var path = String(pathname || '/').replace(/^\/zh(?=\/|$)/, '') || '/';
    if (path === '/') return 'home';
    if (path.indexOf('/latest') === 0) return 'latest';
    if (path.indexOf('/reset-history') === 0) return 'reset_history';
    if (path.indexOf('/rate-limit-updates') === 0) return 'rate_limit_updates';
    if (path.indexOf('/faq') === 0) return 'faq';
    if (path.indexOf('/methodology') === 0) return 'methodology';
    if (path.indexOf('/community') === 0) return 'community';
    if (path.indexOf('/events/') === 0) return 'event_detail';
    if (path.indexOf('/api/') === 0) return 'api';
    if (path === '/feed.xml') return 'rss';
    return 'other';
  }

  function handleLink(link) {
    var url = linkUrl(link);
    if (!url) return;

    var eventId = eventIdFromPath(url.pathname);
    if (!isExternal(url)) {
      if (eventId) {
        track('event_list_click', Object.assign(eventContextFromElement(link), { view_method: 'navigation' }));
      } else if (/^\/(?:zh\/)?(?:api\/|feed\.xml$|sitemap\.xml$|robots\.txt$)/.test(url.pathname)) {
        track('utility_click', { nav_item: navItem(url.pathname), link_type: 'internal' });
      } else if (closest(link, '.header-community-link, .footer-links, .breadcrumb, .event-navigation, .event-topic-link, .status-answer, .status-card')) {
        track('nav_click', { nav_item: navItem(url.pathname), link_type: 'internal' });
      }
      return;
    }

    var domain = normalizedDomain(url);
    var context = eventContextFromElement(link);
    var explicitType = link.getAttribute('data-analytics-link-type');
    if (explicitType === 'source' || domain === 'x.com' || domain === 'twitter.com') {
      context.destination_domain = domain;
      track('click_source_link', context);
    } else if (domain === 'github.com' || domain.slice(-11) === '.github.com') {
      track('github_click', {
        destination_domain: domain,
        placement: closest(link, '.footer-links') ? 'footer' : 'content',
      });
    } else {
      track('outbound_click', {
        destination_domain: domain,
        link_type: 'external',
      });
    }
  }

  function visibleResultCount() {
    return document.querySelectorAll('#timeline .timeline-item').length;
  }

  function trackSearch() {
    var input = document.getElementById('eventSearchInput');
    if (!input) return;
    var value = cleanString(input.value, 120);
    if (!value || value === lastSearchValue) return;
    lastSearchValue = value;
    // Do not send the search text: only its length and the number of matches
    // are needed to understand content demand without collecting free text.
    track('site_search', {
      search_location: 'timeline',
      query_length: value.length,
      result_count: visibleResultCount(),
    });
  }

  function bindSearch() {
    var form = document.getElementById('eventSearchForm');
    var input = document.getElementById('eventSearchInput');
    if (!input) return;

    if (form) form.addEventListener('submit', function () { window.setTimeout(trackSearch, 0); });
    input.addEventListener('input', function () {
      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(trackSearch, 700);
    });
  }

  function bindControls() {
    document.addEventListener('click', function (event) {
      var target = event.target;
      var languageLink = closest(target, '.language-menu-options a');
      if (languageLink) {
        var destination = new URL(languageLink.href, window.location.href);
        var destinationLanguage = destination.pathname.match(/^\/(zh|ja|es|fr)(?:\/|$)/);
        track('language_switch', {
          from_language: pageLanguage(),
          to_language: destinationLanguage ? (destinationLanguage[1] === 'zh' ? 'zh' : destinationLanguage[1]) : 'en',
        });
        return;
      }

      var filterButton = closest(target, '.filter-btn');
      if (filterButton) {
        track('timeline_filter', {
          filter_type: filterButton.getAttribute('data-filter') || 'ALL',
        });
        return;
      }

      if (closest(target, '#clearFilters')) {
        track('timeline_filter', { filter_type: 'ALL' });
        return;
      }

      var exportButton = closest(target, '[data-export-format]');
      if (exportButton) {
        var start = document.getElementById('startDateInput');
        var end = document.getElementById('endDateInput');
        track('export_events', {
          export_format: exportButton.getAttribute('data-export-format') || 'json',
          has_category_filter: Boolean(document.querySelector('.filter-btn.active[data-filter]:not([data-filter="ALL"])')),
          has_date_filter: Boolean((start && start.value) || (end && end.value)),
          result_count: visibleResultCount(),
        });
        return;
      }

      var link = closest(target, 'a[href]');
      if (link) handleLink(link);
    });

    var start = document.getElementById('startDateInput');
    var end = document.getElementById('endDateInput');
    var trackDateFilter = function () {
      track('timeline_filter', {
        filter_type: 'date_range',
        has_date_filter: Boolean((start && start.value) || (end && end.value)),
      });
    };
    if (start) start.addEventListener('change', trackDateFilter);
    if (end) end.addEventListener('change', trackDateFilter);
  }

  function trackEventPageView() {
    var detail = document.querySelector('[data-analytics-page-type="event_detail"]');
    if (!detail) return;
    track('view_event_detail', {
      event_id: detail.getAttribute('data-analytics-event-id') || '',
      event_category: detail.getAttribute('data-analytics-event-category') || '',
      evidence_source: detail.getAttribute('data-analytics-evidence-source') || '',
      verification_status: detail.getAttribute('data-analytics-verification-status') || 'PENDING',
      view_method: 'page',
    });
  }

  window.tiboAnalytics = {
    track: track,
    pageType: pageType,
    pageLanguage: pageLanguage,
  };

  function init() {
    bindControls();
    bindSearch();
    trackEventPageView();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}());
