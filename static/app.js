// ============================================================
// Tibo Codex Monitor - Frontend Dashboard (Complete Bilingual)
// ============================================================

const API_BASE = '/api';
const SITE_URL = 'https://tibo.modelyard.dev';

// --- Complete i18n Dictionary ---
const messages = {
  en: {
    // Site
    // Fallbacks mirror the SSR metadata. On the homepage the injected
    // window.__SSR_META__ object is authoritative, so hydration cannot
    // silently replace the server title or description.
    siteTitle: 'Codex Usage Limit Resets & Rate Limit Updates | Tibo Monitor',
    siteDescription: 'Track public Codex usage resets, limit changes, and subscription updates from Tibo (@thsottiaux).',
    monitoring: 'Monitoring',
    toggleLanguage: 'Switch language to Simplified Chinese',

    // Status badges
    live: 'LIVE',
    notConfigured: 'NOT CONFIGURED',
    sourceNotConfigured: 'SOURCE NOT CONFIGURED',
    classifierNotConfigured: 'CLASSIFIER NOT CONFIGURED',
    degraded: 'DEGRADED',
    stale: 'STALE',
    unknown: 'UNKNOWN',
    awaitingFirstRun: 'AWAITING FIRST RUN',

    // Status cards
    lastReset: 'Last Reset',
    currentPolicy: 'Latest Policy Change',
    latestChange: 'Latest Change',
    lastChecked: 'Last Checked',
    sourceStatus: 'Information Source',
    xDirectSource: 'X Direct',
    webIndexedSource: 'Web Indexed',
    lastNewPost: 'last new post',
    lastCheckedUnavailable: 'No successful check yet',
    latestEventTitle: 'Latest event',

    // Search and export
    searchEvents: 'Search events',
    searchPlaceholder: 'Search titles, summaries or source text',
    fromDate: 'From',
    toDate: 'To',
    clearFilters: 'Clear',
    export: 'Export',
    exporting: 'Preparing download...',
    exportReady: 'Download ready',
    exportFailed: 'Export failed',
    // System-monitored reset report
    manualResetReportedTitle: 'Server reset report',
    manualResetReported: 'Server reported a usage reset.',
    manualResetSource: 'Server monitoring',
    manualResetDisclaimer: 'Automated report.',
    manualResetConfirmed: 'RESET REPORTED',
    manualResetTimeLabel: 'Report time',

    // Reset history reference
    daysSinceLastReset: 'Days since last public reset: {days}',
    averageResetInterval: 'Average completed-reset interval: about {days} days ({count} records)',
    noHistoricalReset: 'No historical reset records yet.',
    historyReferenceDisclaimer: 'Historical reference',

    // Countdown
    resetCountdown: 'Reset Countdown',
    noResetScheduled: 'No reset currently scheduled.',
    expectedReset: 'Expected reset',
    yourLocalTime: 'New York time',
    announcedBy: 'Announced by',
    viewSource: 'View source',
    resetTimeReached: 'Expected reset time reached.',
    waitingForConfirmation: 'Waiting for confirmation...',
    lastConfirmationCheck: 'Last confirmation check',
    minutesAgo: 'minutes ago',
    resetConfirmed: 'RESET CONFIRMED',
    confirmedBy: 'Confirmed by',
    resetLikelyCompleted: 'RESET LIKELY COMPLETED',
    multipleReports: 'Multiple public reports indicate a reset.',
    noOfficialConfirmation: 'Official confirmation pending.',
    indexedSource: 'Web Search Index',
    directSource: 'Direct X API',
    officialSource: 'Official source',
    directlyVerified: 'Directly verified',
    officiallyVerified: 'Officially verified',
    indexedOnly: 'Indexed only',
    discoveredViaSearch: 'Discovered via web search',
    awaitingDirectVerification: 'Awaiting direct source verification',
    pendingVerification: 'Pending verification',
    unknownSourceType: 'Unknown source type',
    indexedResetSchedule: 'Reset schedule found · direct source pending',
    directResetSchedule: 'Reset schedule verified',
    resetTimeChanged: 'Reset time changed',
    previously: 'Previously',
    now: 'Now',
    exactTimeNotAnnounced: 'time not announced',

    // Timeline
    timeline: 'Timeline',
    all: 'All',
    resetPlanned: 'Reset Planned',
    resetCompleted: 'Reset Completed',
    resetTimeChanged: 'Time Changed',
    policyChange: 'Policy',

    // Latest decision
    latestDecision: 'Latest Decision',
    noEvents: 'No events to display.',
    noEventsDetail: 'No events recorded yet. Monitoring will begin once configured.',
    loading: 'Loading events...',
    failedToLoad: 'Unable to load monitoring data.',

    // Modal
    type: 'Type',
    title: 'Title',
    summary: 'Summary',
    chineseTitle: 'Chinese Title',
    englishSummary: 'English Summary',
    chineseSummary: 'Chinese Summary',
    aiSummary: 'AI summary',
    originalSource: 'Original Source',
    source: 'Source',
    published: 'Published',
    beijingTime: 'New York time',
    resetTime: 'Reset Time',
    effectiveTime: 'Effective Time',
    confidence: 'Confidence',
    publishedTimeUnavailable: 'Published time unavailable',
    viewOriginal: 'View original post',

    // Empty state
    sourceNotConfiguredTitle: 'No public source is connected yet.',
    aiClassifierReady: 'AI classifier ready:',
    monitoringWillBegin: 'Monitoring starts when a public source is connected.',

    // Footer
    footer: 'Independent monitor · Not affiliated with OpenAI.',

    // Category labels
    categoryPlanned: 'Reset Planned',
    categoryCompleted: 'Reset Completed',
    categoryTimeChanged: 'Time Changed',
    categoryPolicy: 'Policy Change',

    // Confirmation
    resetExpected: 'Reset expected',
    notAnnounced: 'not announced',
    resetDue: 'Reset due',
    checking: 'Checking',
    ago: 'ago',
    secondsAgo: 's ago',
    minutesAgoShort: 'min ago',
    hoursAgoShort: 'h ago',
    daysAgoShort: 'd ago',
  },
  'zh-CN': {
    // Site
    siteTitle: 'Codex 使用额度重置与限额更新｜Tibo 监控',
    siteDescription: '追踪 Tibo（@thsottiaux）公开发布的 Codex 额度重置、限额变化和订阅更新。',
    monitoring: '正在监控',
    toggleLanguage: '切换为英文',

    // Status badges
    live: '正常监控',
    notConfigured: '尚未配置',
    sourceNotConfigured: '数据源未配置',
    classifierNotConfigured: '分类器未配置',
    degraded: '服务降级',
    stale: '数据过期',
    unknown: '未知',
    awaitingFirstRun: '等待首次运行',

    // Status cards
    lastReset: '最近重置',
    currentPolicy: '最新政策变更',
    latestChange: '最新动态',
    lastChecked: '最近检查',
    sourceStatus: '信息源',
    xDirectSource: 'X 直接源',
    webIndexedSource: '网页索引',
    lastNewPost: '最近新帖',
    lastCheckedUnavailable: '尚无成功检查',
    latestEventTitle: '最新事件',

    // Search and export
    searchEvents: '搜索事件',
    searchPlaceholder: '搜索标题、摘要或来源文本',
    fromDate: '从',
    toDate: '至',
    clearFilters: '清除',
    export: '导出',
    exporting: '正在准备下载……',
    exportReady: '下载已准备好',
    exportFailed: '导出失败',
    // 系统重置报告
    manualResetReportedTitle: '服务器重置报告',
    manualResetReported: '服务器报告额度已重置。',
    manualResetSource: '服务器监控',
    manualResetDisclaimer: '系统自动报告。',
    manualResetConfirmed: '服务器报告重置',
    manualResetTimeLabel: '报告时间',

    // Reset history reference
    daysSinceLastReset: '距最近一次公开重置已过 {days} 天',
    averageResetInterval: '历史已完成重置平均间隔约 {days} 天（基于 {count} 次记录）',
    noHistoricalReset: '暂无历史重置记录。',
    historyReferenceDisclaimer: '历史参考',

    // Countdown
    resetCountdown: '重置倒计时',
    noResetScheduled: '目前没有已知的重置计划。',
    expectedReset: '预计重置',
    yourLocalTime: '北京时间',
    announcedBy: '发布者',
    viewSource: '查看原帖',
    resetTimeReached: '预计重置时间已到',
    waitingForConfirmation: '正在等待确认……',
    lastConfirmationCheck: '最近一次确认检查',
    minutesAgo: '分钟前',
    resetConfirmed: '重置已确认',
    confirmedBy: '确认来源',
    resetLikelyCompleted: '重置很可能已完成',
    multipleReports: '多条公开报告显示额度已重置。',
    noOfficialConfirmation: '官方确认待定。',
    indexedSource: '网页搜索索引',
    directSource: 'X API 直接来源',
    officialSource: '官方来源',
    directlyVerified: '已直接验证',
    officiallyVerified: '已官方验证',
    indexedOnly: '仅索引证据',
    discoveredViaSearch: '通过网页搜索发现',
    awaitingDirectVerification: '等待直接来源验证',
    pendingVerification: '待验证',
    unknownSourceType: '来源类型未知',
    indexedResetSchedule: '已发现重置计划 · 等待直接来源',
    directResetSchedule: '重置计划已验证',
    resetTimeChanged: '重置时间已变更',
    previously: '原计划',
    now: '现计划',
    exactTimeNotAnnounced: '具体时间未公布',

    // Timeline
    timeline: '时间线',
    all: '全部',
    resetPlanned: '计划重置',
    resetCompleted: '重置完成',
    resetTimeChanged: '时间变更',
    policyChange: '政策',

    // Latest decision
    latestDecision: '最新动态',
    noEvents: '暂无可显示事件。',
    noEventsDetail: '暂无监控事件。',
    loading: '正在加载事件...',
    failedToLoad: '无法加载监控数据。',

    // Modal
    type: '类型',
    title: '标题',
    summary: '摘要',
    chineseTitle: '中文标题',
    englishSummary: '英文摘要',
    chineseSummary: '中文摘要',
    aiSummary: 'AI 摘要',
    originalSource: '原始来源',
    source: '来源',
    published: '发布时间',
    beijingTime: '北京时间',
    resetTime: '重置时间',
    effectiveTime: '生效时间',
    confidence: '置信度',
    publishedTimeUnavailable: '发布时间未知',
    viewOriginal: '查看原帖',

    // Empty state
    sourceNotConfiguredTitle: '尚未接入公开数据源。',
    aiClassifierReady: 'AI 分类器已就绪：',
    monitoringWillBegin: '接入公开数据源后开始监控。',

    // Footer
    footer: '非官方监控站 · 与 OpenAI 无隶属关系。',

    // Category labels
    categoryPlanned: '计划重置',
    categoryCompleted: '重置完成',
    categoryTimeChanged: '时间变更',
    categoryPolicy: '政策变更',

    // Confirmation
    resetExpected: '预计重置',
    notAnnounced: '未公布具体时间',
    resetDue: '重置到期',
    checking: '检查中',
    ago: '前',
    secondsAgo: '秒前',
    minutesAgoShort: '分钟前',
    hoursAgoShort: '小时前',
    daysAgoShort: '天前',
  }
};

// --- Category Config ---
const CATEGORY_ICONS = {
  RESET_PLANNED: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  RESET_COMPLETED: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  RESET_TIME_CHANGED: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
  POLICY_CHANGE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
};

const VALID_EVENT_FILTERS = ['ALL', 'RESET_PLANNED', 'RESET_COMPLETED', 'RESET_TIME_CHANGED', 'POLICY_CHANGE'];
// --- State ---
let currentFilter = 'ALL';
let currentQuery = { q: '', startDate: '', endDate: '' };
let events = [];
let eventsState = 'LOADING';
let lang = 'en';
let resetStatus = null;
let countdownTimer = null;
let healthData = null;
let resetHistoryEvents = [];
let resetHistoryState = 'LOADING';
let resetHistoryRequestId = 0;
let searchDebounceTimer = null;
let eventsRequestId = 0;
let ssrHydrated = false;
let initStarted = false;

// --- DOM References (cached) ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- i18n Core ---
function t(key) {
  const dict = messages[lang] || messages.en;
  return dict[key] !== undefined ? dict[key] : (messages.en[key] || key);
}

function formatMessage(key, values) {
  let message = t(key);
  Object.keys(values || {}).forEach(function(name) {
    message = message.replace(new RegExp('\\{' + name + '\\}', 'g'), String(values[name]));
  });
  return message;
}

function getCategoryLabel(category) {
  const labels = {
    en: {
      RESET_PLANNED: 'Reset Planned',
      RESET_COMPLETED: 'Reset Completed',
      RESET_TIME_CHANGED: 'Time Changed',
      POLICY_CHANGE: 'Policy Change',
    },
    'zh-CN': {
      RESET_PLANNED: '计划重置',
      RESET_COMPLETED: '重置完成',
      RESET_TIME_CHANGED: '时间变更',
      POLICY_CHANGE: '政策变更',
    }
  };
  const dict = labels[lang] || labels.en;
  return dict[category] || category;
}

// --- Language Management ---
function getInitialLanguage() {
  const path = window.location.pathname;
  return path === '/zh' || path.startsWith('/zh/') ? 'zh-CN' : 'en';
}

function stripChinesePrefix(pathname) {
  if (pathname === '/zh' || pathname === '/zh/') return '/';
  if (pathname.startsWith('/zh/')) return pathname.slice(3) || '/';
  return pathname || '/';
}

function localizedPath(targetLanguage) {
  const basePath = stripChinesePrefix(window.location.pathname);
  if (targetLanguage === 'zh-CN') {
    return basePath === '/' ? '/zh/' : '/zh' + basePath;
  }
  return basePath;
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0]
    && date.getUTCMonth() === parts[1] - 1
    && date.getUTCDate() === parts[2];
}

function readUrlFilters() {
  const params = new URLSearchParams(window.location.search);
  const category = VALID_EVENT_FILTERS.indexOf(params.get('category')) >= 0
    ? params.get('category')
    : 'ALL';
  const rawStartDate = (params.get('startDate') || '').trim();
  const rawEndDate = (params.get('endDate') || '').trim();
  return {
    category: category || 'ALL',
    q: (params.get('q') || '').trim().slice(0, 120),
    startDate: isValidDateOnly(rawStartDate) ? rawStartDate : '',
    endDate: isValidDateOnly(rawEndDate) ? rawEndDate : '',
  };
}

function syncFiltersFromUrl() {
  const filters = readUrlFilters();
  currentFilter = filters.category;
  currentQuery = {
    q: filters.q,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };
  syncFilterControls();
}

function syncFilterControls() {
  const filterButtons = document.querySelectorAll('.filter-btn');
  for (let i = 0; i < filterButtons.length; i++) {
    filterButtons[i].classList.toggle('active', filterButtons[i].dataset.filter === currentFilter);
  }
  const searchInput = document.getElementById('eventSearchInput');
  if (searchInput && searchInput.value !== currentQuery.q) searchInput.value = currentQuery.q;
  const startDateInput = document.getElementById('startDateInput');
  if (startDateInput && startDateInput.value !== currentQuery.startDate) startDateInput.value = currentQuery.startDate;
  const endDateInput = document.getElementById('endDateInput');
  if (endDateInput && endDateInput.value !== currentQuery.endDate) endDateInput.value = currentQuery.endDate;
}

function updateFilterUrl(patch) {
  const current = readUrlFilters();
  const next = Object.assign({}, current, patch || {});
  next.category = VALID_EVENT_FILTERS.indexOf(next.category) >= 0 ? next.category : 'ALL';
  next.q = String(next.q || '').trim().slice(0, 120);
  next.startDate = isValidDateOnly(next.startDate) ? next.startDate : '';
  next.endDate = isValidDateOnly(next.endDate) ? next.endDate : '';

  const url = new URL(window.location.href);
  const setOrDelete = function(key, value) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  };
  setOrDelete('category', next.category === 'ALL' ? '' : next.category);
  setOrDelete('q', next.q);
  setOrDelete('startDate', next.startDate);
  setOrDelete('endDate', next.endDate);
  const nextUrl = url.pathname + (url.search ? url.search : '') + (url.hash || '');
  const currentUrl = window.location.pathname + window.location.search + window.location.hash;
  if (nextUrl !== currentUrl) window.history.pushState({}, '', nextUrl);

  currentFilter = next.category;
  currentQuery = { q: next.q, startDate: next.startDate, endDate: next.endDate };
  syncFilterControls();
}

function eventFilterQueryString() {
  const params = new URLSearchParams();
  if (currentFilter !== 'ALL') params.set('category', currentFilter);
  if (currentQuery.q) params.set('q', currentQuery.q);
  if (currentQuery.startDate) params.set('startDate', currentQuery.startDate);
  if (currentQuery.endDate) params.set('endDate', currentQuery.endDate);
  return params.toString();
}

function eventQueryString(limit) {
  const params = new URLSearchParams(eventFilterQueryString());
  if (limit !== undefined && limit !== null) params.set('limit', String(limit));
  if (currentQuery.startDate || currentQuery.endDate) {
    params.set('timeZone', getDisplayTimezone());
  }
  return params.toString();
}

function setLanguage(targetLanguage) {
  const targetPath = localizedPath(targetLanguage);
  const targetUrl = targetPath + window.location.search + window.location.hash;
  if (targetUrl !== window.location.pathname + window.location.search + window.location.hash) {
    window.location.assign(targetUrl);
    return;
  }
  lang = targetLanguage;
  applyLanguage();
}

function getEventPath(id) {
  return (lang === 'zh-CN' ? '/zh/events/' : '/events/') + id;
}

function applyLanguage() {
  updateHtmlLang();
  translateAllUI();
  updateLanguageSwitcher();
  syncFilterControls();
  renderEventState();
  renderStatusCards(statusData);
  renderResetCountdown();
}

function updateHtmlLang() {
  document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en';
  const serverMeta = window.__SSR_META__ && window.__SSR_META__.lang === lang
    ? window.__SSR_META__
    : null;
  const pageTitle = serverMeta && serverMeta.title ? serverMeta.title : t('siteTitle');
  const pageDescription = serverMeta && serverMeta.description ? serverMeta.description : t('siteDescription');
  document.title = pageTitle;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = pageDescription;
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.content = pageTitle;
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.content = pageDescription;
  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) twitterTitle.content = pageTitle;
  const twitterDescription = document.querySelector('meta[name="twitter:description"]');
  if (twitterDescription) twitterDescription.content = pageDescription;
}

function updateLanguageSwitcher() {
  const btn = document.getElementById('langSwitch');
  if (btn) {
    btn.textContent = lang === 'zh-CN' ? 'English' : '中文';
    btn.setAttribute('aria-label', t('toggleLanguage'));
  }
}

// --- Translate All Static UI ---
function translateAllUI() {
  // Use ID-based translation for all static elements
  const idMap = {
    monitoringLabel: 'monitoring',
    cardLabelLastReset: 'lastReset',
    cardLabelCurrentPolicy: 'currentPolicy',
    cardLabelLatestChange: 'latestChange',
    cardLabelLastChecked: 'lastChecked',
    cardLabelSourceStatus: 'sourceStatus',
    timelineTitle: 'timeline',
    filterAll: 'all',
    filterResetPlanned: 'resetPlanned',
    filterResetCompleted: 'resetCompleted',
    filterTimeChanged: 'resetTimeChanged',
    filterPolicyChange: 'policyChange',
    timelineEmptyText: 'noEvents',
    emptyStateText: 'noEventsDetail',
    loadingText: 'loading',
    footerText: 'footer',
    countdownTitle: 'resetCountdown',
    countdownEmptyText: 'noResetScheduled',
    latestEventTitle: 'latestEventTitle',
    eventSearchLabel: 'searchEvents',
    startDateLabel: 'fromDate',
    endDateLabel: 'toDate',
    clearFilters: 'clearFilters',
    exportLabel: 'export',
  };

  for (const [elId, msgKey] of Object.entries(idMap)) {
    const el = document.getElementById(elId);
    if (el) el.textContent = t(msgKey);
  }

  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) {
    const serverMeta = window.__SSR_META__ && window.__SSR_META__.lang === lang ? window.__SSR_META__ : null;
    pageTitle.textContent = serverMeta && serverMeta.title ? serverMeta.title : t('siteTitle');
  }

  const searchInput = document.getElementById('eventSearchInput');
  if (searchInput) {
    searchInput.placeholder = t('searchPlaceholder');
    searchInput.setAttribute('aria-label', t('searchEvents'));
  }
  const startDateInput = document.getElementById('startDateInput');
  if (startDateInput) startDateInput.setAttribute('aria-label', t('fromDate'));
  const endDateInput = document.getElementById('endDateInput');
  if (endDateInput) endDateInput.setAttribute('aria-label', t('toDate'));
}

// --- API Calls ---
let statusData = null;

async function fetchAPI(path) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

// --- Render Functions ---
function renderAll() {
  renderTimeline();
  renderEventHighlight(getVisibleEvents()[0] || null);
}

// The homepage ItemList is rendered from the same SSR event array as the
// initial timeline. If a later API refresh changes that array, update the
// JSON-LD too so the hydrated DOM cannot describe a stale list.
function syncItemListStructuredData() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const visibleEvents = getVisibleEvents();
  for (let i = 0; i < scripts.length; i++) {
    try {
      const parsed = JSON.parse(scripts[i].textContent || '');
      if (parsed && parsed['@type'] === 'ItemList') {
        parsed.itemListElement = visibleEvents.map(function(event, index) {
          return {
            '@type': 'ListItem',
            position: index + 1,
            url: SITE_URL + getEventPath(event.id),
            name: getTitle(event),
          };
        });
        scripts[i].textContent = JSON.stringify(parsed);
      }
    } catch (_err) {
      // A malformed unrelated JSON-LD block must not stop the dashboard.
    }
  }
}

function displayDateOnly(iso) {
  if (!iso) return '';
  const date = parseStoredUtc(iso);
  if (isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: getDisplayTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = function(type) {
    return (parts.find(function(part) { return part.type === type; }) || {}).value || '';
  };
  return value('year') + '-' + value('month') + '-' + value('day');
}

function eventMatchesCurrentQuery(event) {
  if (currentQuery.q) {
    const haystack = [event.title_en, event.title_zh, event.summary_en, event.summary_zh, event.source_text]
      .map(function(value) { return String(value || '').toLowerCase(); })
      .join(' ');
    if (haystack.indexOf(currentQuery.q.toLowerCase()) < 0) return false;
  }

  if (currentQuery.startDate || currentQuery.endDate) {
    const eventDate = displayDateOnly(event.published_at || event.created_at);
    if (!eventDate) return false;
    if (currentQuery.startDate && eventDate < currentQuery.startDate) return false;
    if (currentQuery.endDate && eventDate > currentQuery.endDate) return false;
  }
  return true;
}

function getVisibleEvents() {
  return events.filter(function(event) {
    return (currentFilter === 'ALL' || event.category === currentFilter) && eventMatchesCurrentQuery(event);
  });
}

function renderEventHighlight(event) {
  const container = document.getElementById('eventHighlight');
  if (!container) return;
  if (!event) {
    const message = eventsState === 'ERROR'
      ? t('failedToLoad')
      : eventsState === 'LOADED_EMPTY'
        ? t('noEventsDetail')
        : t('loading');
    container.innerHTML = '<div class="highlight-empty"><p>' + message + '</p></div>';
    return;
  }

  const title = lang === 'zh-CN' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
  const summary = lang === 'zh-CN' ? (event.summary_zh || event.summary_en) : (event.summary_en || event.summary_zh);
  const sourceBadge = renderSourceBadge(event);

  container.innerHTML = [
    '<div class="event-highlight-card" onclick="window.openModal&&openModal(' + event.id + ')">',
    '  <div class="event-highlight-top">',
    '    <div>',
    '      <span class="category-badge category-' + event.category + '">',
    '        ' + (CATEGORY_ICONS[event.category] || ''),
    '        ' + getCategoryLabel(event.category),
    '      </span>',
    '      ' + sourceBadge,
    '    </div>',
    '    <div class="event-highlight-meta">',
    '      <span>' + formatDate(event.published_at, lang) + '</span>',
    event.source_url ? '      <a href="' + escapeHtml(event.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(getAnalyticsEvidenceSource(event)) + '" onclick="event.stopPropagation()">' + t('viewOriginal') + ' →</a>' : '',
    '    </div>',
    '  </div>',
    '  <a href="' + getEventPath(event.id) + '" class="event-highlight-title-link">',
    '    <h3 class="event-highlight-title">' + escapeHtml(title) + '</h3>',
    '  </a>',
    '  <div class="event-highlight-summary">' + escapeHtml(summary) + '</div>',
    '</div>'
  ].join('\n');
}

function renderEventState() {
  const loading = document.getElementById('timelineLoading');
  if (loading) loading.style.display = eventsState === 'LOADING' ? 'flex' : 'none';

  if (eventsState === 'LOADED_DATA' && events.length > 0) {
    renderAll();
    syncItemListStructuredData();
    return;
  }

  renderTimeline();
  renderEventHighlight(null);
  syncItemListStructuredData();
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  if (!container) return;

  if (eventsState === 'LOADING') {
    container.innerHTML = '<li class="timeline-empty"><p>' + t('loading') + '</p></li>';
    return;
  }

  if (eventsState === 'ERROR') {
    container.innerHTML = '<li class="timeline-empty"><p>' + t('failedToLoad') + '</p></li>';
    return;
  }

  const filtered = getVisibleEvents();

  if (filtered.length === 0) {
    container.innerHTML = '<li class="timeline-empty"><p>' + t('noEvents') + '</p></li>';
    return;
  }

  let html = '';
  let lastDate = '';

  for (let i = 0; i < filtered.length; i++) {
    const event = filtered[i];
    const dateStr = formatDateShort(event.published_at, lang);
    const showDate = dateStr !== lastDate;
    lastDate = dateStr;
    const title = lang === 'zh-CN' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
    const summary = lang === 'zh-CN' ? (event.summary_zh || event.summary_en) : (event.summary_en || event.summary_zh);
    const sourceBadge = renderSourceBadge(event);

    html += [
      '<li class="timeline-item ' + event.category + '" onclick="window.openModal&&openModal(' + event.id + ')">',
      '  <div class="timeline-dot">',
      '    <div class="timeline-dot-marker"></div>',
      '  </div>',
      '  <div class="timeline-content">',
      (showDate ? '    <div class="timeline-date">' + dateStr + '</div>' : ''),
      '    <div style="margin-bottom:0.375rem">',
      '      <span class="category-badge category-' + event.category + '">',
      '        ' + (CATEGORY_ICONS[event.category] || ''),
      '        ' + getCategoryLabel(event.category),
      '      </span>',
      '      ' + sourceBadge,
      '    </div>',
      '    <a href="' + getEventPath(event.id) + '" class="timeline-title-link">',
      '      <h3 class="timeline-title">' + escapeHtml(title) + '</h3>',
      '    </a>',
      '    <div class="timeline-summary">' + escapeHtml(summary) + '</div>',
      '  </div>',
      '</li>'
    ].join('\n');
  }

  container.innerHTML = html;
}

function renderStatusCards(data) {
  statusData = data;
  if (!data) return;

  renderManualResetNotice(data);

  const reportedResetAt = data.manualReset && data.manualReset.resetAt
    ? data.manualReset.resetAt
    : (data.lastReset && data.lastReset.published_at);
  document.getElementById('lastResetValue').textContent =
    reportedResetAt
      ? (data.manualReset && data.manualReset.resetAt
        ? formatManualResetTime(reportedResetAt, lang)
        : formatDate(reportedResetAt, lang))
      : '—';

  document.getElementById('currentPolicyValue').textContent =
    data.currentPolicy ? getTitle(data.currentPolicy) : '—';

  document.getElementById('latestChangeValue').textContent =
    data.latestEvent ? getTitle(data.latestEvent) : '—';

  const checkedAt = data.lastCheckedAt || data.lastSuccessfulCron || null;
  document.getElementById('lastCheckedValue').textContent =
    checkedAt ? timeAgo(checkedAt, lang) : t('lastCheckedUnavailable');

  const sourceValue = document.getElementById('sourceStatusValue');
  if (sourceValue) {
    const providers = data.providers || {};
    const xApi = providers.xApi;
    const directPrimary = !!(xApi && xApi.automaticSync) || data.sourceMode === 'x_direct';
    const source = directPrimary ? xApi : (providers.webSearch || providers.source);
    let sourceLabel = directPrimary ? t('xDirectSource') : t('webIndexedSource');
    if (!source && !data.sourceMode) sourceLabel = t('unknown');
    else if (source && source.status === 'stale') sourceLabel += ' · ' + t('stale');
    else if (source && (source.status === 'degraded' || source.status === 'down')) sourceLabel += ' · ' + t('degraded');
    const lastNewPostAt = (xApi && xApi.lastNewPostAt) || data.sourceLastNewPostAt;
    if (directPrimary && lastNewPostAt) {
      sourceLabel += ' · ' + t('lastNewPost') + ': ' + timeAgo(lastNewPostAt, lang);
    }
    sourceValue.textContent = sourceLabel;
  }

  updateLiveBadge(data);
  updateMonitoredAccounts(data);
}

function renderManualResetNotice(data) {
  const notice = document.getElementById('manualResetNotice');
  if (!notice) return;
  const report = data && data.manualReset;
  if (!report || !report.resetAt) {
    notice.style.display = 'none';
    notice.innerHTML = '';
    return;
  }

  const note = report.note
    ? '<div class="manual-reset-notice-note">' + (lang === 'zh-CN' ? '备注：' : 'Note: ') + escapeHtml(report.note) + '</div>'
    : '';
  notice.style.display = 'block';
  notice.innerHTML = [
    '<div class="manual-reset-notice-title">' + t('manualResetReportedTitle') + '</div>',
    '<div class="manual-reset-notice-body">' + t('manualResetReported') + ' <time class="manual-reset-time">' + escapeHtml(formatManualResetTime(report.resetAt, lang)) + '</time></div>',
    note,
    '<div class="manual-reset-notice-meta">' + t('manualResetDisclaimer') + '</div>',
  ].filter(Boolean).join('\n');
}

function getTitle(event) {
  return lang === 'zh-CN' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
}

function renderSourceBadge(event) {
  return '<span class="source-quality-badge ' + sourceQualityClass(event) + '">' + getSourceQualityLabel(event) + '</span>';
}

function isOfficialEvent(event) {
  return event && (event.verification_status === 'OFFICIAL_VERIFIED'
    || event.source_quality === 'OFFICIAL'
    || event.evidence_quality === 'OFFICIAL');
}

function isIndexedEvent(event) {
  return event && (event.verification_status === 'INDEXED_ONLY'
    || event.source_quality === 'INDEXED'
    || event.evidence_quality === 'INDEXED');
}

function sourceQualityClass(event) {
  return isOfficialEvent(event) ? 'official' : isIndexedEvent(event) ? 'indexed' : 'direct';
}

function getSourceQualityLabel(event) {
  if (isOfficialEvent(event)) return t('officialSource');
  if (isIndexedEvent(event)) return t('indexedSource');
  if (event && (event.source_quality === 'DIRECT' || event.evidence_quality === 'DIRECT')) return t('directSource');
  return t('unknownSourceType');
}

function getAnalyticsEvidenceSource(event) {
  if (isOfficialEvent(event)) return 'official';
  if (isIndexedEvent(event)) return 'web_indexed';
  if (event && (event.source_quality === 'DIRECT' || event.evidence_quality === 'DIRECT')) return 'x_direct';
  return 'unknown';
}

function getVerificationLabel(event) {
  if (event && event.verification_status === 'OFFICIAL_VERIFIED') return t('officiallyVerified');
  if (event && event.verification_status === 'INDEXED_ONLY') return t('awaitingDirectVerification');
  if (event && event.verification_status === 'DIRECT_VERIFIED') return t('directlyVerified');
  return t('pendingVerification');
}

function getLastVerifiedLabel(event) {
  if (event && event.last_verified_via === 'x_api') {
    return isOfficialEvent(event) ? t('officialSource') : t('directSource');
  }
  if (event && event.last_verified_via) return event.last_verified_via;
  return event && event.verification_status === 'INDEXED_ONLY'
    ? t('awaitingDirectVerification')
    : t('pendingVerification');
}

function getDiscoveredViaLabel(event) {
  if (!event || !event.first_discovered_via) return t('unknown');
  if (event.first_discovered_via === 'web_search') return t('discoveredViaSearch');
  if (event.first_discovered_via === 'x_api') return t('directSource');
  return event.first_discovered_via;
}

function updateLiveBadge(data) {
  const badge = document.getElementById('liveBadge');
  const dot = badge.querySelector('.live-dot');
  const label = document.getElementById('lastCheckedLabel');

  if (!data) {
    dot.style.background = '#606070';
    label.textContent = t('unknown');
    return;
  }

  var providers = data.providers;
  var lastRun = data.lastRun;

  // SSR provides event/freshness data before the status API resolves. Do not
  // infer configured providers or a LIVE state from that partial payload.
  if (!providers) {
    dot.style.background = '#606070';
    label.textContent = data.lastCheckedAt ? t('monitoring') : t('awaitingFirstRun');
    return;
  }

  var xApi = providers && providers.xApi;
  var directPrimary = !!(xApi && xApi.automaticSync);
  var discovery = directPrimary ? xApi : (providers && (providers.webSearch || providers.source));
  var sourceConfigured = discovery && discovery.configured;
  var classifierConfigured = providers && providers.classifier && providers.classifier.configured;

  if (!sourceConfigured && !classifierConfigured) {
    dot.style.background = '#ef4444';
    label.textContent = t('notConfigured');
    return;
  }

  if (!sourceConfigured) {
    dot.style.background = '#eab308';
    label.textContent = t('sourceNotConfigured');
    return;
  }

  if (!classifierConfigured) {
    dot.style.background = '#eab308';
    label.textContent = t('classifierNotConfigured');
    return;
  }

  if ((lastRun && lastRun.status === 'failed') || data.status === 'degraded'
    || (directPrimary && xApi && ['down', 'degraded', 'stale'].indexOf(xApi.status) !== -1)) {
    dot.style.background = '#ef4444';
    label.textContent = t('degraded');
    return;
  }

  var discoveryLastSuccess = directPrimary
    ? xApi.lastSuccessAt
    : (providers && providers.webSearch && providers.webSearch.lastSuccessAt);
  var monitorLastSuccess = data.lastCheckedAt || data.lastSuccessfulCron;
  if (discoveryLastSuccess || monitorLastSuccess) {
    var freshnessAt = discoveryLastSuccess || monitorLastSuccess;
    var diff = Date.now() - parseStoredUtc(freshnessAt).getTime();
    var hours = diff / 3600000;

    if (hours > 2) {
      dot.style.background = '#eab308';
      label.textContent = t('stale');
      return;
    }

    dot.style.background = '#22c55e';
    label.textContent = t('live');
    return;
  }

  dot.style.background = '#606070';
  label.textContent = t('awaitingFirstRun');
}

function updateMonitoredAccounts(data) {
  if (data.checkedAccounts && data.checkedAccounts.length > 0) {
    document.getElementById('monitoredAccounts').textContent =
      data.checkedAccounts.map(function(a) { return '@' + a; }).join(', ');
  }
}

// --- Reset Countdown ---
const RESET_DAY_MS = 24 * 60 * 60 * 1000;
const SQLITE_UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

function parseStoredUtc(value) {
  if (value === null || value === undefined || value === '') return new Date(NaN);
  const stringValue = String(value);
  const sqliteMatch = stringValue.match(SQLITE_UTC_TIMESTAMP_PATTERN);
  return new Date(sqliteMatch ? sqliteMatch[1] + 'T' + sqliteMatch[2] + 'Z' : stringValue);
}

function resetEventTimestamp(event) {
  if (!event) return null;
  const values = [event.published_at, event.created_at];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value) continue;
    const timestamp = parseStoredUtc(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function calculateAverageResetIntervalDays(resetEvents, limit) {
  const requestedLimit = Number.isInteger(limit) ? Math.max(2, limit) : 5;
  const timestamps = (Array.isArray(resetEvents) ? resetEvents : [])
    .map(resetEventTimestamp)
    .filter(function(timestamp) { return timestamp !== null; })
    .sort(function(left, right) { return left - right; })
    .slice(-requestedLimit);

  if (timestamps.length < 2) {
    return { averageDays: null, count: timestamps.length };
  }

  let totalIntervalMs = 0;
  for (let index = 1; index < timestamps.length; index += 1) {
    totalIntervalMs += timestamps[index] - timestamps[index - 1];
  }
  return {
    averageDays: totalIntervalMs / (timestamps.length - 1) / RESET_DAY_MS,
    count: timestamps.length,
  };
}

function daysSinceResetTimestamp(timestamp) {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / RESET_DAY_MS));
}

function renderResetHistoryReference() {
  const reference = document.getElementById('countdownHistoryReference');
  const daysLine = document.getElementById('countdownDaysSinceLastReset');
  const averageLine = document.getElementById('countdownAverageResetInterval');
  const disclaimer = document.getElementById('countdownHistoryDisclaimer');
  if (!reference || !daysLine || !averageLine || !disclaimer) return;

  reference.style.display = 'none';
  daysLine.textContent = '';
  daysLine.style.display = 'none';
  averageLine.textContent = '';
  averageLine.style.display = 'none';
  disclaimer.textContent = t('historyReferenceDisclaimer');
  disclaimer.style.display = 'none';

  if (resetHistoryState === 'LOADING') return;

  const statusLastReset = statusData && statusData.lastReset ? statusData.lastReset : null;
  const lastResetEvent = statusLastReset && resetEventTimestamp(statusLastReset) !== null
    ? statusLastReset
    : resetHistoryEvents.find(function(event) { return resetEventTimestamp(event) !== null; }) || null;
  const daysSince = daysSinceResetTimestamp(resetEventTimestamp(lastResetEvent));
  const intervalStats = calculateAverageResetIntervalDays(resetHistoryEvents, 5);
  const hasHistory = daysSince !== null || intervalStats.averageDays !== null;
  const hasValidHistoryEvent = resetHistoryEvents.some(function(event) {
    return resetEventTimestamp(event) !== null;
  });
  const hasNoHistory = resetHistoryState === 'LOADED' && !hasValidHistoryEvent && daysSince === null;

  if (daysSince !== null) {
    daysLine.textContent = formatMessage('daysSinceLastReset', { days: daysSince });
    daysLine.style.display = 'block';
  } else if (resetHistoryState === 'LOADED' && !hasValidHistoryEvent) {
    daysLine.textContent = t('noHistoricalReset');
    daysLine.style.display = 'block';
  } else {
    daysLine.style.display = 'none';
  }

  if (intervalStats.averageDays !== null) {
    averageLine.textContent = formatMessage('averageResetInterval', {
      days: Math.round(intervalStats.averageDays),
      count: intervalStats.count,
    });
    averageLine.style.display = 'block';
  } else {
    averageLine.style.display = 'none';
  }

  if (hasHistory) {
    disclaimer.style.display = 'block';
  }
  if (hasHistory || hasNoHistory) {
    reference.style.display = 'block';
  }
}

function renderResetCountdown() {
  const section = document.getElementById('countdownSection');
  const display = document.getElementById('countdownDisplay');
  const empty = document.getElementById('countdownEmpty');

  if (resetStatus && resetStatus.status === 'ERROR') {
    section.style.display = 'block';
    display.style.display = 'none';
    empty.style.display = 'block';
    document.getElementById('countdownEmptyText').textContent = t('failedToLoad');
    const historyReference = document.getElementById('countdownHistoryReference');
    if (historyReference) historyReference.style.display = 'none';
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    return;
  }

  if (!resetStatus || resetStatus.status === 'NONE') {
    section.style.display = 'block';
    display.style.display = 'none';
    empty.style.display = 'block';
    document.getElementById('countdownEmptyText').textContent = t('noResetScheduled');
    renderResetHistoryReference();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    return;
  }

  section.style.display = 'block';
  display.style.display = 'block';
  empty.style.display = 'none';
  const historyReference = document.getElementById('countdownHistoryReference');
  if (historyReference) historyReference.style.display = 'none';

  // Update status badge
  updateCountdownStatus(resetStatus);

  // Start countdown ticker
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(function() {
    updateCountdownDisplay(resetStatus);
  }, 1000);
  updateCountdownDisplay(resetStatus);
}

function updateCountdownStatus(status) {
  const badge = document.getElementById('countdownStatusBadge');
  if (!badge) return;

  var statusMap = {
    en: {
      NONE: '',
      SCHEDULED: 'SCHEDULED',
      DUE: 'DUE',
      CONFIRMING: 'CONFIRMING',
      CONFIRMED: 'CONFIRMED',
      TIME_CHANGED: 'TIME CHANGED',
      EXPIRED_UNCONFIRMED: 'EXPIRED',
    },
    'zh-CN': {
      NONE: '',
      SCHEDULED: '已计划',
      DUE: '已到期',
      CONFIRMING: '确认中',
      CONFIRMED: '已确认',
      TIME_CHANGED: '时间已变更',
      EXPIRED_UNCONFIRMED: '已过期',
    }
  };

  var dict = statusMap[lang] || statusMap.en;
  var label = dict[status.status] || status.status;
  badge.textContent = label;
  badge.className = 'countdown-status-badge status-' + status.status.toLowerCase();
}

function updateCountdownDisplay(status) {
  const timeEl = document.getElementById('countdownTime');
  const infoEl = document.getElementById('countdownInfo');
  if (!timeEl || !infoEl) return;

  var now = Date.now();
  var targetTime = status.expectedResetAt ? parseStoredUtc(status.expectedResetAt).getTime() : null;

  if (status.status === 'CONFIRMED') {
    // Show confirmed state
    timeEl.innerHTML = '';
    infoEl.innerHTML = buildConfirmedInfo(status);
    return;
  }

  if (status.status === 'DUE' || status.status === 'CONFIRMING') {
    // Show due state
    timeEl.innerHTML = '<span class="countdown-due">' + t('resetTimeReached') + '</span>';
    infoEl.innerHTML = buildDueInfo(status);
    return;
  }

  if (!targetTime) {
    // Show approximate time
    timeEl.innerHTML = '<span class="countdown-approx">' + escapeHtml(getApproximateResetText(status)) + '</span>';
    infoEl.innerHTML = buildCountdownInfo(status);
    return;
  }

  var diff = targetTime - now;
  if (diff <= 0) {
    // Time has passed but status not updated
    timeEl.innerHTML = '<span class="countdown-due">' + t('resetTimeReached') + '</span>';
    infoEl.innerHTML = buildDueInfo(status);
    return;
  }

  // Show countdown
  var seconds = Math.floor(diff / 1000);
  var days = Math.floor(seconds / 86400);
  var hours = Math.floor((seconds % 86400) / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var secs = seconds % 60;

  if (lang === 'zh-CN') {
    if (days > 0) {
      timeEl.textContent = days + '天 ' + String(hours).padStart(2, '0') + '时 ' + String(minutes).padStart(2, '0') + '分 ' + String(secs).padStart(2, '0') + '秒';
    } else {
      timeEl.textContent = String(hours).padStart(2, '0') + '时 ' + String(minutes).padStart(2, '0') + '分 ' + String(secs).padStart(2, '0') + '秒';
    }
  } else {
    if (days > 0) {
      timeEl.textContent = days + 'd ' + String(hours).padStart(2, '0') + 'h ' + String(minutes).padStart(2, '0') + 'm ' + String(secs).padStart(2, '0') + 's';
    } else {
      timeEl.textContent = String(hours).padStart(2, '0') + 'h ' + String(minutes).padStart(2, '0') + 'm ' + String(secs).padStart(2, '0') + 's';
    }
  }

  infoEl.innerHTML = buildCountdownInfo(status);
}

function buildCountdownInfo(status) {
  var parts = [];
  var userTz = getUserTimezone();

  // Expected reset time
  if (status.expectedResetAt) {
    var d = parseStoredUtc(status.expectedResetAt);
    var expectedStr = formatDateTime(d, lang, userTz);
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('expectedReset') + '</span><span class="countdown-info-value">' + expectedStr + '</span></div>');
  } else {
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('expectedReset') + '</span><span class="countdown-info-value">' + escapeHtml(getApproximateResetText(status)) + '</span></div>');
  }

  // Source
  if (status.resetSource) {
    var sourceName = status.resetSource === 'thsottiaux' ? 'Tibo' : status.resetSource;
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('announcedBy') + '</span><span class="countdown-info-value">' + escapeHtml(sourceName));
    if (status.resetSourceUrl) {
      parts.push(' <a href="' + escapeHtml(status.resetSourceUrl) + '" target="_blank" class="countdown-link">' + t('viewSource') + ' →</a>');
    }
    parts.push('</span></div>');
  }

  if (status.verificationStatus === 'INDEXED_ONLY') {
    parts.push('<div class="countdown-provenance">' + t('indexedResetSchedule') + '</div>');
  } else if (status.verificationStatus) {
    parts.push('<div class="countdown-provenance direct">' + t('directResetSchedule') + '</div>');
  }

  return parts.join('\n');
}

// Indexed search results can contain an entire rendered social page. Never
// expose that raw evidence as the approximate reset-time label. The backend
// now leaves this field empty; the guard also protects users while old rows
// are being cleaned up and prevents unsafe HTML from reaching innerHTML.
function getApproximateResetText(status) {
  var raw = typeof status.expectedResetTimeText === 'string'
    ? status.expectedResetTimeText.replace(/\s+/g, ' ').trim()
    : '';

  if (!raw || raw.length > 160 || /(?:user avatar|log in|sign up|views|## post|\/ x\b)/i.test(raw)) {
    return t('exactTimeNotAnnounced');
  }

  return raw;
}

function buildDueInfo(status) {
  var parts = [];
  parts.push('<div class="countdown-due-text">' + t('waitingForConfirmation') + '</div>');

  if (status.confirmation && status.confirmation.lastCheckedAt) {
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('lastConfirmationCheck') + '</span><span class="countdown-info-value">' + timeAgo(status.confirmation.lastCheckedAt, lang) + '</span></div>');
  }

  return parts.join('\n');
}

function buildConfirmedInfo(status) {
  var parts = [];
  var confirmation = status.confirmation || {};

  if (confirmation.type === 'DIRECT' || confirmation.type === 'OFFICIAL') {
    parts.push('<div class="countdown-confirmed-badge direct">' + t('resetConfirmed') + '</div>');
    var confirmedBy = status.resetSource || confirmation.sourceAccount || (confirmation.type === 'OFFICIAL' ? 'OpenAI' : t('directSource'));
    if (confirmedBy === 'thsottiaux') confirmedBy = 'Tibo (@thsottiaux)';
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('confirmedBy') + '</span><span class="countdown-info-value">' + escapeHtml(confirmedBy) + '</span></div>');
  } else if (confirmation.type === 'COMMUNITY') {
    parts.push('<div class="countdown-confirmed-badge community">' + t('resetLikelyCompleted') + '</div>');
    parts.push('<div class="countdown-due-text">' + t('multipleReports') + '</div>');
    parts.push('<div class="countdown-due-text dim">' + t('noOfficialConfirmation') + '</div>');
  } else if (confirmation.type === 'MANUAL') {
    parts.push('<div class="countdown-confirmed-badge manual">' + t('manualResetConfirmed') + '</div>');
    parts.push('<div class="countdown-due-text">' + t('manualResetReported') + '</div>');
    parts.push('<div class="countdown-due-text dim">' + t('manualResetDisclaimer') + '</div>');
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('confirmedBy') + '</span><span class="countdown-info-value">' + escapeHtml(t('manualResetSource')) + '</span></div>');
  }

  if (confirmation.confirmedAt) {
    var d = parseStoredUtc(confirmation.confirmedAt);
    var confirmedTime = confirmation.type === 'MANUAL'
      ? formatManualResetTime(confirmation.confirmedAt, lang)
      : formatDateTime(d, lang, getUserTimezone());
    var confirmedTimeLabel = confirmation.type === 'MANUAL' ? t('manualResetTimeLabel') : t('yourLocalTime');
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + confirmedTimeLabel + '</span><span class="countdown-info-value">' + confirmedTime + '</span></div>');
  }

  if (confirmation.sourceUrl) {
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('source') + '</span><span class="countdown-info-value"><a href="' + escapeHtml(confirmation.sourceUrl) + '" target="_blank" class="countdown-link">' + t('viewSource') + ' →</a></span></div>');
  }

  return parts.join('\n');
}

function getUserTimezone() {
  return getDisplayTimezone();
}

function getDisplayTimezone() {
  return lang === 'zh-CN' ? 'Asia/Shanghai' : 'America/New_York';
}

function formatDateTime(d, l, tz) {
  if (l === 'zh-CN') {
    var f = new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return f.format(d) + ' ' + tz;
  }
  var f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return f.format(d) + ' ' + tz;
}

// --- Render Modal ---
function renderModal(event) {
  const content = document.getElementById('modalContent');
  if (!content) return;
  const confidencePercent = Math.round(event.confidence * 100);
  let confidenceClass = '';
  if (confidencePercent < 50) confidenceClass = 'low';
  else if (confidencePercent < 80) confidenceClass = 'medium';

  const title = lang === 'zh-CN' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
  const summary = lang === 'zh-CN' ? (event.summary_zh || event.summary_en) : (event.summary_en || event.summary_zh);

  var parts = [
    '<div class="modal-section"><div class="modal-label">' + t('type') + '</div><div>',
    '  <span class="category-badge category-' + event.category + '">',
    '    ' + (CATEGORY_ICONS[event.category] || ''),
    '    ' + getCategoryLabel(event.category),
    '  </span>',
    '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('title') + '</div>',
    '<div class="modal-value">' + escapeHtml(title) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('summary') + ' <span class="modal-tag ai">' + t('aiSummary') + '</span></div>',
    '<div class="modal-value ai-summary">' + escapeHtml(summary) + '</div></div>',
  ];

  if (event.source_text) {
    parts.push(
      '<div class="modal-section"><div class="modal-label">' + t('originalSource') + ' <span class="modal-tag source">' + t('source') + '</span></div>',
      '<div class="modal-value source-text">' + escapeHtml(event.source_text) + '</div></div>'
    );
  }

  var pubTime = '';
  if (event.published_at) {
    pubTime = formatDate(event.published_at, lang);
  } else {
    pubTime = t('publishedTimeUnavailable');
  }

  parts.push(
    '<div class="modal-section"><div class="modal-label">' + t('published') + '</div>',
    '<div class="modal-value">' + pubTime + '</div></div>'
  );

  if (event.reset_at) {
    parts.push(
      '<div class="modal-section"><div class="modal-label">' + t('resetTime') + '</div>',
      '<div class="modal-value">' + formatDate(event.reset_at, lang) + '</div></div>'
    );
  }

  if (event.effective_at) {
    parts.push(
      '<div class="modal-section"><div class="modal-label">' + t('effectiveTime') + '</div>',
      '<div class="modal-value">' + formatDate(event.effective_at, lang) + '</div></div>'
    );
  }

  parts.push(
    '<div class="modal-section"><div class="modal-label">' + t('confidence') + '</div>',
    '  <div class="confidence-bar">',
    '    <span class="modal-value">' + confidencePercent + '%</span>',
    '    <div class="confidence-track">',
    '      <div class="confidence-fill ' + confidenceClass + '" style="width:' + confidencePercent + '%"></div>',
    '    </div>',
    '  </div>',
    '</div>',

    '<div class="modal-section"><div class="modal-label">' + t('source') + '</div>',
    '<div class="modal-value">' + escapeHtml(getSourceQualityLabel(event)) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + (lang === 'zh-CN' ? '验证状态' : 'Verification status') + '</div>',
    '<div class="modal-value">' + escapeHtml(getVerificationLabel(event)) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + (lang === 'zh-CN' ? '首次发现来源' : 'First discovered via') + '</div>',
    '<div class="modal-value">' + escapeHtml(getDiscoveredViaLabel(event)) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + (lang === 'zh-CN' ? '最近验证来源' : 'Last verified via') + '</div>',
    '<div class="modal-value">' + escapeHtml(getLastVerifiedLabel(event)) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('source') + '</div>',
    '<a class="modal-link" href="' + escapeHtml(event.source_url) + '" target="_blank">' + escapeHtml(event.source_url) + ' →</a></div>'
  );

  content.innerHTML = parts.join('\n');
  document.getElementById('eventModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// --- Utility Functions ---
function formatDate(iso, l) {
  if (!iso) return t('publishedTimeUnavailable');
  const d = parseStoredUtc(iso);
  if (isNaN(d.getTime())) return iso;
  return formatDateTime(d, l, getUserTimezone());
}

function manualResetTimezone(l) {
  return l === 'zh-CN' ? 'Asia/Shanghai' : 'America/New_York';
}

function formatManualResetTime(iso, l) {
  if (!iso) return '';
  var d = parseStoredUtc(iso);
  if (isNaN(d.getTime())) return iso;
  var tz = manualResetTimezone(l);
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  var values = {};
  parts.forEach(function (part) { values[part.type] = part.value; });
  var hour = values.hour === '24' ? '00' : values.hour;
  return values.year + '/' + values.month + '/' + values.day + ' ' + hour + ':' + values.minute + ' ' + tz;
}

function formatDateShort(iso, l) {
  if (!iso) return '';
  const d = parseStoredUtc(iso);
  if (isNaN(d.getTime())) return '';
  const formatter = new Intl.DateTimeFormat(l === 'zh-CN' ? 'zh-CN' : 'en-US', {
    timeZone: getUserTimezone(),
    year: 'numeric',
    month: l === 'zh-CN' ? 'numeric' : 'short',
    day: 'numeric',
  });
  return formatter.format(d);
}

function localTime(iso, l) {
  if (!iso) return '';
  const d = parseStoredUtc(iso);
  if (isNaN(d.getTime())) return '';
  return formatDateTime(d, l, getUserTimezone());
}

function timeAgo(iso, l) {
  if (!iso) return '';
  const now = Date.now();
  const then = parseStoredUtc(iso).getTime();
  if (isNaN(then)) return '';
  const diff = Math.floor((now - then) / 1000);
  
  if (l === 'zh-CN') {
    if (diff < 60) return diff + '秒前';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    return Math.floor(diff / 86400) + '天前';
  }
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Modal Controls ---
function openModal(id) {
  const event = events.find(function(e) { return e.id === id; });
  if (event) {
    if (window.tiboAnalytics && typeof window.tiboAnalytics.track === 'function') {
      window.tiboAnalytics.track('view_event_detail', {
        event_id: String(event.id),
        event_category: event.category,
        evidence_source: getAnalyticsEvidenceSource(event),
        verification_status: event.verification_status || 'PENDING',
        view_method: 'modal',
      });
    }
    renderModal(event);
  }
}
function closeModal() {
  const modal = document.getElementById('eventModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function bindStaticEvents() {
  window.openModal = openModal;

  const modal = document.getElementById('eventModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });
  }

  const modalClose = document.getElementById('modalClose');
  if (modalClose) modalClose.addEventListener('click', closeModal);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });

  const filterButtons = document.querySelectorAll('.filter-btn');
  for (let i = 0; i < filterButtons.length; i++) {
    filterButtons[i].addEventListener('click', function() {
      updateFilterUrl({ category: this.dataset.filter || 'ALL' });
      renderEventState();
      void loadEvents();
    });
  }

  const searchForm = document.getElementById('eventSearchForm');
  const searchInput = document.getElementById('eventSearchInput');
  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', function(event) {
      event.preventDefault();
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      updateFilterUrl({ q: searchInput.value });
      renderEventState();
      void loadEvents();
    });
    searchInput.addEventListener('input', function() {
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      const value = searchInput.value;
      searchDebounceTimer = window.setTimeout(function() {
        updateFilterUrl({ q: value });
        renderEventState();
        void loadEvents();
      }, 300);
    });
  }

  const startDateInput = document.getElementById('startDateInput');
  if (startDateInput) {
    startDateInput.addEventListener('change', function() {
      updateFilterUrl({ startDate: startDateInput.value });
      renderEventState();
      void loadEvents();
    });
  }
  const endDateInput = document.getElementById('endDateInput');
  if (endDateInput) {
    endDateInput.addEventListener('change', function() {
      updateFilterUrl({ endDate: endDateInput.value });
      renderEventState();
      void loadEvents();
    });
  }

  const clearFiltersButton = document.getElementById('clearFilters');
  if (clearFiltersButton) {
    clearFiltersButton.addEventListener('click', function() {
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      updateFilterUrl({ category: 'ALL', q: '', startDate: '', endDate: '' });
      renderEventState();
      void loadEvents();
    });
  }

  const exportButtons = document.querySelectorAll('[data-export-format]');
  for (let i = 0; i < exportButtons.length; i++) {
    exportButtons[i].addEventListener('click', function() {
      void exportEvents(this.dataset.exportFormat || 'json');
    });
  }

  window.addEventListener('popstate', function() {
    syncFiltersFromUrl();
    renderEventState();
    void loadEvents();
  });

  const languageButton = document.getElementById('langSwitch');
  if (languageButton) {
    languageButton.addEventListener('click', function() {
      setLanguage(lang === 'zh-CN' ? 'en' : 'zh-CN');
    });
  }
}

async function exportEvents(format) {
  const buttons = document.querySelectorAll('[data-export-format]');
  const status = document.getElementById('exportStatus');
  for (let i = 0; i < buttons.length; i++) buttons[i].disabled = true;
  if (status) status.textContent = t('exporting');

  try {
    const params = new URLSearchParams(eventFilterQueryString());
    params.set('format', format === 'csv' ? 'csv' : 'json');
    const response = await fetch(API_BASE + '/export?' + params.toString(), {
      headers: { 'Accept': format === 'csv' ? 'text/csv' : 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'tibo-codex-events.' + (format === 'csv' ? 'csv' : 'json');
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function() { URL.revokeObjectURL(objectUrl); }, 1000);
    if (status) status.textContent = t('exportReady');
  } catch (err) {
    if (status) status.textContent = t('exportFailed');
    reportApiFailure('/export', err);
  } finally {
    for (let i = 0; i < buttons.length; i++) buttons[i].disabled = false;
  }
}

// --- API-backed modules ---
function reportApiFailure(path, error) {
  console.warn('[Tibo Monitor] API request failed: ' + path, error);
}

async function loadHealth() {
  try {
    healthData = await fetchAPI('/health');
    return healthData;
  } catch (err) {
    healthData = null;
    reportApiFailure('/health', err);
    return null;
  }
}

async function loadStatus() {
  try {
    const data = await fetchAPI('/status');
    renderStatusCards(data);
    renderResetCountdown();
    return data;
  } catch (err) {
    reportApiFailure('/status', err);
    return null;
  }
}

async function loadResetHistory() {
  const requestId = ++resetHistoryRequestId;
  try {
    const payload = await fetchAPI('/events?category=RESET_COMPLETED&limit=100');
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error('Invalid reset history response');
    }
    if (requestId !== resetHistoryRequestId) return null;
    resetHistoryEvents = payload.data;
    resetHistoryState = 'LOADED';
    renderResetCountdown();
    return payload;
  } catch (err) {
    if (requestId !== resetHistoryRequestId) return null;
    // Preserve the last successful reset-history snapshot when a refresh fails.
    resetHistoryState = 'ERROR';
    reportApiFailure('/events?category=RESET_COMPLETED&limit=100', err);
    renderResetCountdown();
    return null;
  }
}

async function loadEvents() {
  const requestId = ++eventsRequestId;
  try {
    const payload = await fetchAPI('/events?' + eventQueryString(50));
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error('Invalid events response');
    }
    if (requestId !== eventsRequestId) return null;
    events = payload.data;
    eventsState = events.length > 0 ? 'LOADED_DATA' : 'LOADED_EMPTY';
    return payload;
  } catch (err) {
    if (requestId !== eventsRequestId) return null;
    // Keep already-rendered SSR/API data visible when a refresh fails. Only
    // show the error state when there is no usable event data at all.
    if (events.length === 0) {
      events = [];
      eventsState = 'ERROR';
    } else {
      eventsState = 'LOADED_DATA';
    }
    reportApiFailure('/events', err);
    return null;
  } finally {
    if (requestId === eventsRequestId) renderEventState();
  }
}

async function loadResetState() {
  try {
    resetStatus = await fetchAPI('/reset/current');
    return resetStatus;
  } catch (err) {
    // A failed refresh is not evidence that no reset exists. Keep an explicit
    // error state so the UI cannot turn a transient API failure into a false
    // "no reset scheduled" message.
    resetStatus = { status: 'ERROR' };
    reportApiFailure('/reset/current', err);
    return null;
  } finally {
    renderResetCountdown();
  }
}

async function loadData() {
  // Use SSR data if available to avoid replacing SSR content with loading state
  if (!ssrHydrated) {
    if (window.__SSR_EVENTS__ && Array.isArray(window.__SSR_EVENTS__) && window.__SSR_EVENTS__.length > 0) {
      events = window.__SSR_EVENTS__;
      eventsState = 'LOADED_DATA';
      renderAll();
      syncItemListStructuredData();

      // Update status cards from SSR data
      if (window.__SSR_LAST_RESET__ || window.__SSR_MANUAL_RESET__ || window.__SSR_LAST_POLICY__ || window.__SSR_LATEST_EVENT__) {
        var ssrStatus = {
          lastReset: window.__SSR_LAST_RESET__ || null,
          manualReset: window.__SSR_MANUAL_RESET__ || null,
          currentPolicy: window.__SSR_LAST_POLICY__ || null,
          latestEvent: window.__SSR_LATEST_EVENT__ || null,
          lastCheckedAt: window.__SSR_LAST_CHECKED__ || null,
          sourceLastNewPostAt: window.__SSR_SOURCE_LAST_NEW_POST__ || null,
          sourceMode: window.__SSR_SOURCE_MODE__ || null,
          checkedAccounts: Array.isArray(window.__SSR_ACCOUNTS__) && window.__SSR_ACCOUNTS__.length > 0
            ? window.__SSR_ACCOUNTS__
            : ['thsottiaux'],
        };
        renderStatusCards(ssrStatus);
      }
    } else {
      eventsState = 'LOADING';
      renderEventState();
    }
    ssrHydrated = true;
  }

  await Promise.allSettled([
    loadHealth(),
    loadStatus(),
    loadEvents(),
    loadResetHistory(),
    loadResetState(),
  ]);
}

// --- Initialize ---
async function init() {
  if (initStarted) return;
  initStarted = true;

  try {
    lang = getInitialLanguage();
    syncFiltersFromUrl();
    bindStaticEvents();
    applyLanguage();
    await loadData();
    window.setInterval(function() { void loadData(); }, 60000);
  } catch (err) {
    console.error('[Tibo Monitor] Frontend initialization failed', err);
    eventsState = 'ERROR';
    renderEventState();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { void init(); }, { once: true });
} else {
  void init();
}
