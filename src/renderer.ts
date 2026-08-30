// ============================================================
// Tibo Codex Monitor - SEO SSR Renderer
// ============================================================
// Generates complete HTML pages with server-rendered content
// for search engines and non-JS clients.

import type { ManualResetReportPublic, MonitorEvent } from './types';
import { isEventIndexEligible } from './utils/index-policy';
import { datePartsInTimeZone, displayTimeZoneForLanguage, parseStoredUtc } from './utils/timezone';

// ── Constants ──

const SITE_URL = 'https://tibo.modelyard.dev';
const SITE_NAME = 'Tibo Codex Monitor';

export type LandingPageKey = 'latest' | 'reset-history' | 'rate-limit-updates' | 'faq' | 'methodology';

const LANDING_PAGE_PATHS: Record<LandingPageKey, string> = {
  latest: '/latest/',
  'reset-history': '/reset-history/',
  'rate-limit-updates': '/rate-limit-updates/',
  faq: '/faq/',
  methodology: '/methodology/',
};

const HOMEPAGE_COPY = {
  en: {
    title: 'Codex Usage Limit Resets & Rate Limit Updates | Tibo Monitor',
    description: 'Track public Codex usage resets, limit changes, and subscription updates from Tibo (@thsottiaux).',
  },
  zh: {
    title: 'Codex 使用额度重置与限额更新｜Tibo 监控',
    description: '追踪 Tibo（@thsottiaux）公开发布的 Codex 额度重置、限额变化和订阅更新。',
  },
} as const;

const LANDING_COPY: Record<LandingPageKey, { en: { title: string; description: string; lede: string }; zh: { title: string; description: string; lede: string } }> = {
  latest: {
    en: {
      title: 'Latest Codex Usage Limit Updates',
      description: 'Latest public Codex reset, usage-limit, and rate-limit events tracked by Tibo Monitor.',
      lede: 'Recent public events with their source and status.',
    },
    zh: {
      title: '最新 Codex 额度与限额动态',
      description: 'Tibo 监控记录的最新 Codex 重置、额度和限额事件。',
      lede: '最近公开事件及其来源和状态。',
    },
  },
  'reset-history': {
    en: {
      title: 'Codex Reset History',
      description: 'A chronological record of public Codex usage-limit reset events.',
      lede: 'A timeline of publicly reported reset events.',
    },
    zh: {
      title: 'Codex 重置历史',
      description: '按时间整理公开发布的 Codex 使用额度重置事件。',
      lede: '按时间记录公开发布的重置事件。',
    },
  },
  'rate-limit-updates': {
    en: {
      title: 'Codex Rate Limit Updates',
      description: 'Public Codex rate-limit, reset-time, and subscription policy updates.',
      lede: 'Public updates about limits, reset times, and subscription policy.',
    },
    zh: {
      title: 'Codex 限额更新',
      description: 'Codex 限额、重置时间和订阅政策的公开更新。',
      lede: '公开发布的限额、重置时间和订阅政策更新。',
    },
  },
  faq: {
    en: {
      title: 'Codex Usage Limits & Resets FAQ',
      description: 'Quick answers about Codex usage resets, sources, and verification.',
      lede: 'Quick answers about this monitor and its sources.',
    },
    zh: {
      title: 'Codex 使用额度与重置常见问题',
      description: '快速了解 Codex 额度重置、来源和验证状态。',
      lede: '快速了解本监控和它记录的来源。',
    },
  },
  methodology: {
    en: {
      title: 'Tibo Codex Monitor Methodology',
      description: 'How Tibo Codex Monitor collects, labels, and updates public events.',
      lede: 'How the monitor collects, labels, and updates events.',
    },
    zh: {
      title: 'Tibo Codex 监控方法论',
      description: '说明 Tibo Codex 监控如何收集、标注和更新公开事件。',
      lede: '说明监控如何收集、标注和更新事件。',
    },
  },
};

const CATEGORY_LABELS_EN: Record<string, string> = {
  RESET_PLANNED: 'Reset Planned',
  RESET_COMPLETED: 'Reset Completed',
  RESET_TIME_CHANGED: 'Time Changed',
  POLICY_CHANGE: 'Policy Change',
};

const CATEGORY_LABELS_ZH: Record<string, string> = {
  RESET_PLANNED: '计划重置',
  RESET_COMPLETED: '重置完成',
  RESET_TIME_CHANGED: '时间变更',
  POLICY_CHANGE: '政策变更',
};

export interface SiteIntegrations {
  /** Public GA4 web-stream Measurement ID for this site only. */
  googleAnalyticsId?: string;
  /** Public Search Console HTML-tag verification token for this site only. */
  googleSiteVerification?: string;
}

// ── Helpers ──

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// JSON is embedded in executable <script> blocks below. Escape characters
// that could terminate the block when source content contains </script>.
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function analyticsPageType(meta: SeoMeta): string {
  if (meta.eventId !== null) return 'event_detail';
  if (meta.isHomepage) return 'home';
  if (!meta.canonical) return 'not_found';

  const path = new URL(meta.canonical).pathname;
  if (path.includes('/latest/')) return 'latest';
  if (path.includes('/reset-history/')) return 'reset_history';
  if (path.includes('/rate-limit-updates/')) return 'rate_limit_updates';
  if (path.includes('/faq/')) return 'faq';
  if (path.includes('/methodology/')) return 'methodology';
  return 'page';
}

function renderGoogleAnalytics(
  analyticsId: string | undefined,
  context: { pageLanguage: 'en' | 'zh'; pageType: string },
): string {
  const id = analyticsId?.trim() || '';
  if (!/^G-[A-Z0-9]+$/i.test(id)) return '';
  const escapedId = escapeHtml(id);
  const pageContext = safeJsonForScript({
    page_language: context.pageLanguage,
    page_type: context.pageType,
    content_group: context.pageType,
  });
  return [
    '  <!-- Google tag (gtag.js) — Tibo Codex Monitor property only -->',
    '  <script async src="https://www.googletagmanager.com/gtag/js?id=' + escapedId + '"></script>',
    '  <script>',
    '    window.dataLayer = window.dataLayer || [];',
    '    function gtag(){dataLayer.push(arguments);}',
    "    gtag('js', new Date());",
    "    gtag('config', '" + escapedId + "', " + pageContext + ");",
    '  </script>',
  ].join('\n');
}

function renderGoogleSiteVerification(token: string | undefined): string {
  const value = token?.trim() || '';
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return '';
  return '  <meta name="google-site-verification" content="' + escapeHtml(value) + '">';
}

function formatDateForLanguage(iso: string | null | undefined, lang: 'en' | 'zh'): string {
  if (!iso) return '';
  const date = parseStoredUtc(iso);
  const timeZone = displayTimeZoneForLanguage(lang);
  const parts = datePartsInTimeZone(iso, timeZone);
  if (!date || !parts) return iso;
  if (lang === 'zh') {
    return parts.year + '年' + parts.month + '月' + parts.day + '日 ' + parts.hour + ':' + parts.minute + ' ' + timeZone;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date) + ' ' + timeZone;
}

function formatDateShort(iso: string | null | undefined, lang: 'en' | 'zh' = 'en'): string {
  if (!iso) return '';
  const date = parseStoredUtc(iso);
  const timeZone = displayTimeZoneForLanguage(lang);
  const parts = datePartsInTimeZone(iso, timeZone);
  if (!date || !parts) return '';
  if (lang === 'zh') return parts.year + '年' + Number(parts.month) + '月' + Number(parts.day) + '日';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function truncateMetaDescription(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 160) return normalized;
  return normalized.slice(0, 157).trimEnd() + '...';
}

function isOfficialEvent(event: MonitorEvent): boolean {
  return event.verification_status === 'OFFICIAL_VERIFIED'
    || event.source_quality === 'OFFICIAL'
    || event.evidence_quality === 'OFFICIAL';
}

function isIndexedEvent(event: MonitorEvent): boolean {
  return event.verification_status === 'INDEXED_ONLY'
    || event.source_quality === 'INDEXED'
    || event.evidence_quality === 'INDEXED';
}

function sourceQualityClass(event: MonitorEvent): 'indexed' | 'direct' | 'official' {
  return isOfficialEvent(event) ? 'official' : isIndexedEvent(event) ? 'indexed' : 'direct';
}

function analyticsEvidenceSource(event: MonitorEvent): 'official' | 'web_indexed' | 'x_direct' | 'unknown' {
  if (isOfficialEvent(event)) return 'official';
  if (isIndexedEvent(event)) return 'web_indexed';
  if (event.source_quality === 'DIRECT' || event.evidence_quality === 'DIRECT') return 'x_direct';
  return 'unknown';
}

/** SSR and hydration use the same fixed timezone selected by the page language. */
function localTimeElement(
  iso: string | null | undefined,
  fallback: string,
  className: string,
  format: 'date' | 'datetime' = 'datetime',
): string {
  if (!iso) return escapeHtml(fallback);
  return '<time class="' + escapeHtml(className) + ' local-time" datetime="' + escapeHtml(iso)
    + '" data-local-time="' + escapeHtml(iso) + '" data-local-format="' + format + '">' + escapeHtml(fallback) + '</time>';
}

/**
 * Manual reset reports use a stable editorial timezone rather than the
 * visitor's browser timezone: Shanghai on the Chinese site and New York on
 * the English site. This keeps the same report readable and comparable for
 * everyone viewing a given language version.
 */
function manualResetTimezone(lang: 'en' | 'zh'): 'Asia/Shanghai' | 'America/New_York' {
  return lang === 'zh' ? 'Asia/Shanghai' : 'America/New_York';
}

function formatManualResetTime(iso: string | null | undefined, lang: 'en' | 'zh'): string {
  if (!iso) return '';
  const date = parseStoredUtc(iso);
  if (!date) return iso;
  const timeZone = manualResetTimezone(lang);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) values[part.type] = part.value;
  const hour = values.hour === '24' ? '00' : values.hour;
  return values.year + '/' + values.month + '/' + values.day + ' ' + hour + ':' + values.minute + ' ' + timeZone;
}

function fixedTimezoneTimeElement(
  iso: string | null | undefined,
  lang: 'en' | 'zh',
  className: string,
): string {
  const fallback = formatManualResetTime(iso, lang);
  if (!iso) return escapeHtml(fallback);
  return '<time class="' + escapeHtml(className) + '" datetime="' + escapeHtml(iso)
    + '">' + escapeHtml(fallback) + '</time>';
}

function getCategoryLabel(category: string, lang: 'en' | 'zh'): string {
  const labels = lang === 'zh' ? CATEGORY_LABELS_ZH : CATEGORY_LABELS_EN;
  return labels[category] || category;
}

function getSourceQualityLabel(event: MonitorEvent, lang: 'en' | 'zh'): string {
  if (isOfficialEvent(event)) return lang === 'zh' ? '官方来源' : 'Official source';
  if (isIndexedEvent(event)) return lang === 'zh' ? '网页搜索索引' : 'Web Search Index';
  if (event.source_quality === 'DIRECT' || event.evidence_quality === 'DIRECT') {
    return lang === 'zh' ? 'X API 直接来源' : 'Direct X API';
  }
  return lang === 'zh' ? '来源类型未知' : 'Unknown source type';
}

function getVerificationLabel(event: MonitorEvent, lang: 'en' | 'zh'): string {
  if (event.verification_status === 'OFFICIAL_VERIFIED') return lang === 'zh' ? '已官方验证' : 'Officially verified';
  if (event.verification_status === 'INDEXED_ONLY') return lang === 'zh' ? '等待直接来源验证' : 'Awaiting direct source verification';
  if (event.verification_status === 'DIRECT_VERIFIED') return lang === 'zh' ? '已直接验证' : 'Directly verified';
  return lang === 'zh' ? '待验证' : 'Pending verification';
}

function getVerificationStatusCode(event: MonitorEvent): string {
  return event.verification_status || 'PENDING';
}

function getTopicPath(category: string, lang: 'en' | 'zh'): string {
  return category === 'POLICY_CHANGE' || category === 'RESET_TIME_CHANGED'
    ? getLandingPath('rate-limit-updates', lang)
    : getLandingPath('reset-history', lang);
}

function getEventUrl(id: number, lang: 'en' | 'zh'): string {
  const prefix = lang === 'zh' ? '/zh' : '';
  return prefix + '/events/' + id;
}

function getCanonicalUrl(id: number | null, lang: 'en' | 'zh'): string {
  if (id === null) {
    return lang === 'zh' ? SITE_URL + '/zh/' : SITE_URL + '/';
  }
  return SITE_URL + getEventUrl(id, lang);
}

function getHomePath(lang: 'en' | 'zh'): string {
  return lang === 'zh' ? '/zh/' : '/';
}

function getLandingUrl(page: LandingPageKey, lang: 'en' | 'zh'): string {
  const path = LANDING_PAGE_PATHS[page];
  return SITE_URL + (lang === 'zh' ? '/zh' + path : path);
}

function getLandingPath(page: LandingPageKey, lang: 'en' | 'zh'): string {
  const path = LANDING_PAGE_PATHS[page];
  return lang === 'zh' ? '/zh' + path : path;
}

// ── Hreflang helpers ──

function hreflangTags(enPath?: string, zhPath?: string): string {
  if (!enPath || !zhPath) return '';
  const enUrl = SITE_URL + enPath;
  const zhUrl = SITE_URL + zhPath;
  return [
    '<link rel="alternate" hreflang="en" href="' + enUrl + '" />',
    '<link rel="alternate" hreflang="zh-CN" href="' + zhUrl + '" />',
    '<link rel="alternate" hreflang="x-default" href="' + enUrl + '" />',
  ].join('\n');
}

// ── JSON-LD helpers ──

function websiteSchema(lang: 'en' | 'zh', description?: string): string {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': lang === 'zh' ? 'Tibo Codex 监控' : 'Tibo Codex Monitor',
    'url': getCanonicalUrl(null, lang),
    'inLanguage': lang === 'zh' ? 'zh-CN' : 'en',
  };
  // Only add a description when the caller passes the same text that is
  // visibly rendered on the page. This avoids turning a meta-only sentence
  // into structured-data content that readers cannot see.
  if (description) schema.description = description;
  return safeJsonForScript(schema);
}

function itemListSchema(events: MonitorEvent[], lang: 'en' | 'zh'): string {
  const items = events.map((e, i) => ({
    '@type': 'ListItem',
    'position': i + 1,
    'url': SITE_URL + getEventUrl(e.id!, lang),
    'name': lang === 'zh' ? (e.title_zh || e.title_en) : (e.title_en || e.title_zh),
  }));
  return safeJsonForScript({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    'name': lang === 'zh' ? '最近事件' : 'Recent Events',
    'itemListElement': items,
  });
}

function breadcrumbSchema(items: { name: string; url: string }[]): string {
  const list = items.map((item, i) => ({
    '@type': 'ListItem',
    'position': i + 1,
    'name': item.name,
    'item': item.url.startsWith('http') ? item.url : SITE_URL + item.url,
  }));
  return safeJsonForScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': list,
  });
}

function articleSchema(event: MonitorEvent, lang: 'en' | 'zh', canonical: string): string {
  const headline = lang === 'zh' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
  const description = lang === 'zh' ? (event.summary_zh || event.summary_en) : (event.summary_en || event.summary_zh);
  const article: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': canonical + '#article',
    'headline': headline,
    'description': description,
    'mainEntityOfPage': { '@type': 'WebPage', '@id': canonical },
    'url': canonical,
    'articleSection': getCategoryLabel(event.category, lang),
    'inLanguage': lang === 'zh' ? 'zh-CN' : 'en',
  };
  if (event.published_at) article.datePublished = event.published_at;
  if (event.updated_at) article.dateModified = event.updated_at;
  // The source URL is a real, visible evidence link. Author and publisher are
  // intentionally omitted because this monitor does not store an independent
  // editorial author or publisher identity for each event.
  if (event.source_url) article.isBasedOn = event.source_url;
  return safeJsonForScript(article);
}

// ── HTML Template ──

interface SeoMeta {
  lang: 'en' | 'zh';
  title: string;
  description: string;
  canonical?: string | null;
  isHomepage: boolean;
  eventId: number | null;
  enPath?: string;
  zhPath?: string;
  ogImage?: string;
  robots?: string;
  structuredData?: string[];
  ogType?: 'website' | 'article';
  publishedAt?: string | null;
  modifiedAt?: string | null;
}

interface HomepageData {
  events: MonitorEvent[];
  latestEvent: MonitorEvent | null;
  lastReset: MonitorEvent | null;
  manualReset?: ManualResetReportPublic | null;
  lastPolicy: MonitorEvent | null;
  lastCheckedAt: string | null;
  sourceLastFetchedAt?: string | null;
  sourceLastNewPostAt?: string | null;
  sourceMode?: 'x_direct' | 'web_indexed' | null;
  totalEvents: number;
  accounts?: string[];
}

interface EventPageData {
  event: MonitorEvent;
  prevEvent: MonitorEvent | null;
  nextEvent: MonitorEvent | null;
  relatedEvents: MonitorEvent[];
}

function renderHead(meta: SeoMeta, integrations?: SiteIntegrations): string {
  const isZh = meta.lang === 'zh';
  const ogImage = meta.ogImage || SITE_URL + '/og-default.png';
  const langAttr = isZh ? 'zh-CN' : 'en';
  const canonical = meta.canonical || null;
  const jsonLd = meta.structuredData || (canonical ? [websiteSchema(meta.lang)] : []);

  return [
    '<!DOCTYPE html>',
    '<html lang="' + langAttr + '">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>' + escapeHtml(meta.title) + '</title>',
    '  <meta name="description" content="' + escapeHtml(meta.description) + '">',
    renderGoogleSiteVerification(integrations?.googleSiteVerification),
    renderGoogleAnalytics(integrations?.googleAnalyticsId, {
      pageLanguage: meta.lang,
      pageType: analyticsPageType(meta),
    }),
    canonical ? '  <link rel="canonical" href="' + escapeHtml(canonical) + '">' : '',
    '  <meta name="robots" content="' + escapeHtml(meta.robots || 'index, follow') + '">',
    '',
    '  <!-- Open Graph -->',
    '  <meta property="og:type" content="' + (meta.ogType || (meta.isHomepage ? 'website' : 'article')) + '">',
    '  <meta property="og:title" content="' + escapeHtml(meta.title) + '">',
    '  <meta property="og:description" content="' + escapeHtml(meta.description) + '">',
    canonical ? '  <meta property="og:url" content="' + escapeHtml(canonical) + '">' : '',
    '  <meta property="og:image" content="' + escapeHtml(ogImage) + '">',
    '  <meta property="og:image:width" content="1200">',
    '  <meta property="og:image:height" content="630">',
    '  <meta property="og:site_name" content="' + (isZh ? 'Tibo Codex 监控' : 'Tibo Codex Monitor') + '">',
    '  <meta property="og:locale" content="' + (isZh ? 'zh_CN' : 'en_US') + '">',
    '',
    '  <!-- Twitter Card -->',
    '  <meta name="twitter:card" content="summary_large_image">',
    '  <meta name="twitter:title" content="' + escapeHtml(meta.title) + '">',
    '  <meta name="twitter:description" content="' + escapeHtml(meta.description) + '">',
    '  <meta name="twitter:image" content="' + escapeHtml(ogImage) + '">',
    '  <meta name="twitter:image:alt" content="' + escapeHtml(isZh ? 'Tibo Codex 监控' : 'Tibo Codex Monitor') + '">',
    meta.publishedAt ? '  <meta property="article:published_time" content="' + escapeHtml(meta.publishedAt) + '">' : '',
    meta.modifiedAt ? '  <meta property="article:modified_time" content="' + escapeHtml(meta.modifiedAt) + '">' : '',
    '',
    '  <!-- Hreflang -->',
    hreflangTags(meta.enPath, meta.zhPath),
    '',
    '  <!-- Structured Data -->',
    jsonLd.map(schema => '  <script type="application/ld+json">\n' + schema + '\n  </script>').join('\n'),
    '',
    '  <link rel="stylesheet" href="/style.css">',
    '  <link rel="preconnect" href="https://fonts.googleapis.com">',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">',
    '  <link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '  <link rel="alternate icon" href="/favicon.ico">',
    '  <link rel="alternate" type="application/rss+xml" title="' + escapeHtml(isZh ? 'Tibo 监控 RSS' : 'Tibo Monitor RSS') + '" href="' + SITE_URL + '/feed.xml">',
    '  <script src="/local-time.js" defer></script>',
    '  <script src="/analytics.js" defer></script>',
    '</head>',
  ].join('\n');
}

const PRIMARY_NAV_LABELS = {
  en: {
    latest: 'Latest',
    'reset-history': 'Reset History',
    'rate-limit-updates': 'Rate Limit Updates',
    faq: 'FAQ',
    methodology: 'Methodology',
  },
  zh: {
    latest: '最新动态',
    'reset-history': '重置历史',
    'rate-limit-updates': '限额更新',
    faq: '常见问题',
    methodology: '方法论',
  },
} as const;

function renderSiteNav(lang: 'en' | 'zh'): string {
  const labels = PRIMARY_NAV_LABELS[lang];
  return [
    '        <nav class="site-nav" aria-label="' + (lang === 'zh' ? '主要导航' : 'Primary navigation') + '">',
    '          <a href="' + getLandingPath('latest', lang) + '">' + labels.latest + '</a>',
    '          <a href="' + getLandingPath('reset-history', lang) + '">' + labels['reset-history'] + '</a>',
    '          <a href="' + getLandingPath('rate-limit-updates', lang) + '">' + labels['rate-limit-updates'] + '</a>',
    '          <a href="' + getLandingPath('faq', lang) + '">' + labels.faq + '</a>',
    '          <a href="' + getLandingPath('methodology', lang) + '">' + labels.methodology + '</a>',
    '        </nav>',
  ].join('\n');
}

function renderSiteHeader(
  lang: 'en' | 'zh',
  options: { accounts?: string[]; interactive?: boolean; alternatePath?: string | null } = {},
): string {
  const isZh = lang === 'zh';
  const accounts = options.accounts && options.accounts.length > 0
    ? options.accounts.map(account => '@' + account).join(', ')
    : '';
  const alternatePath = options.alternatePath === undefined
    ? (isZh ? '/' : '/zh/')
    : options.alternatePath;
  const languageControl = options.interactive
    ? '<button class="lang-switch" id="langSwitch" aria-label="' + (isZh ? 'Switch language to English' : 'Switch language to Simplified Chinese') + '">' + (isZh ? 'English' : '中文') + '</button>'
    : alternatePath
      ? '<a class="lang-switch" href="' + alternatePath + '" hreflang="' + (isZh ? 'en' : 'zh-CN') + '" aria-label="' + (isZh ? 'Switch language to English' : '切换为中文') + '">' + (isZh ? 'English' : '中文') + '</a>'
      : '';
  return [
    '    <header class="header">',
    '      <div class="header-left">',
    '        <div class="logo">',
    '          <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">',
    '            <path d="M12 2L2 7l10 5 10-5-10-5z"/>',
    '            <path d="M2 17l10 5 10-5"/>',
    '            <path d="M2 12l10 5 10-5"/>',
    '          </svg>',
    '          <div>',
    '            <div class="logo-title"' + (options.interactive ? ' id="siteTitle"' : '') + '>' + (isZh ? 'Tibo Codex 监控' : 'Tibo Codex Monitor') + '</div>',
    accounts ? '            <p class="logo-subtitle"><span id="monitoringLabel">' + (isZh ? '正在监控' : 'Monitoring') + '</span> <span id="monitoredAccounts">' + escapeHtml(accounts) + '</span></p>' : '',
    '          </div>',
    '        </div>',
    '      </div>',
    renderSiteNav(lang),
    '      <div class="header-right">',
    options.interactive ? '        <span class="live-badge" id="liveBadge"><span class="live-dot" style="background:#606070;animation:none"></span><span id="lastCheckedLabel">' + (isZh ? '等待首次运行' : 'Awaiting first run') + '</span></span>' : '',
    '        ' + languageControl,
    '      </div>',
    '    </header>',
  ].filter(line => line !== '').join('\n');
}

function renderSiteFooter(lang: 'en' | 'zh'): string {
  const labels = PRIMARY_NAV_LABELS[lang];
  return [
    '    <footer class="footer">',
    '      <div class="footer-content">',
    '        <p id="footerText">' + (lang === 'zh' ? '非官方监控站 · 与 OpenAI 无隶属关系。' : 'Independent monitor · Not affiliated with OpenAI.') + '</p>',
    '        <nav class="footer-links" aria-label="' + (lang === 'zh' ? '页脚导航' : 'Footer navigation') + '">',
    '          <a href="' + getHomePath(lang) + '">' + (lang === 'zh' ? '首页' : 'Home') + '</a>',
    '          <a href="' + getLandingPath('latest', lang) + '">' + labels.latest + '</a>',
    '          <a href="' + getLandingPath('reset-history', lang) + '">' + labels['reset-history'] + '</a>',
    '          <a href="' + getLandingPath('rate-limit-updates', lang) + '">' + labels['rate-limit-updates'] + '</a>',
    '          <a href="' + getLandingPath('faq', lang) + '">' + labels.faq + '</a>',
    '          <a href="' + getLandingPath('methodology', lang) + '">' + labels.methodology + '</a>',
    '          <a href="https://modelyard.dev" target="_blank" rel="noopener noreferrer">Model Yard</a>',
    '          <a href="/api/events" target="_blank" rel="noopener noreferrer">API</a>',
    '          <a href="/api/health" target="_blank" rel="noopener noreferrer">Health</a>',
    '          <a href="/api/status" target="_blank" rel="noopener noreferrer">Status</a>',
    '          <a href="/robots.txt">robots.txt</a>',
    '          <a href="/sitemap.xml">sitemap.xml</a>',
    '          <a href="/feed.xml">RSS</a>',
    '        </nav>',
    '      </div>',
    '    </footer>',
  ].join('\n');
}

interface LandingPageData {
  page: LandingPageKey;
  events: MonitorEvent[];
  latestEvent?: MonitorEvent | null;
  lastCheckedAt?: string | null;
  sourceLastFetchedAt?: string | null;
}

function eventTitle(event: MonitorEvent, lang: 'en' | 'zh'): string {
  return lang === 'zh' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
}

function eventSummary(event: MonitorEvent, lang: 'en' | 'zh'): string {
  return lang === 'zh' ? (event.summary_zh || event.summary_en) : (event.summary_en || event.summary_zh);
}

function eventDateMarkup(iso: string | null | undefined, lang: 'en' | 'zh', className = 'event-date'): string {
  const fallback = iso ? formatDateForLanguage(iso, lang) : (lang === 'zh' ? '未知' : 'Unknown');
  return localTimeElement(iso, fallback, className);
}

function renderEventTrustFacts(event: MonitorEvent, lang: 'en' | 'zh'): string {
  const isZh = lang === 'zh';
  const unknown = isZh ? '未知' : 'Unknown';
  const pending = isZh ? '待验证' : 'Pending verification';
  const verified = event.verified_at
    ? eventDateMarkup(event.verified_at, lang, 'trust-time')
    : escapeHtml(pending);
  return [
    '<dl class="trust-facts">',
    '  <div><dt>' + (isZh ? '验证状态' : 'Verification status') + '</dt><dd><code>' + escapeHtml(getVerificationStatusCode(event)) + '</code> · ' + escapeHtml(getVerificationLabel(event, lang)) + '</dd></div>',
    '  <div><dt>' + (isZh ? '来源类型' : 'Source type') + '</dt><dd><span class="source-quality-badge ' + sourceQualityClass(event) + '">' + escapeHtml(getSourceQualityLabel(event, lang)) + '</span></dd></div>',
    '  <div><dt>' + (isZh ? '发布时间' : 'Published') + '</dt><dd>' + eventDateMarkup(event.published_at, lang, 'trust-time') + '</dd></div>',
    '  <div><dt>' + (isZh ? '观察时间' : 'Observed') + '</dt><dd>' + eventDateMarkup(event.observed_at, lang, 'trust-time') + '</dd></div>',
    '  <div><dt>' + (isZh ? '最近验证' : 'Last verified') + '</dt><dd>' + verified + '</dd></div>',
    '  <div><dt>' + (isZh ? '置信度' : 'Confidence') + '</dt><dd>' + Math.round(event.confidence * 100) + '%</dd></div>',
    '  <div><dt>' + (isZh ? '发现方式' : 'Discovered via') + '</dt><dd>' + escapeHtml(event.first_discovered_via || unknown) + '</dd></div>',
    '</dl>',
  ].join('\n');
}

function renderLandingEventItem(event: MonitorEvent, lang: 'en' | 'zh', headingLevel: 3 | 4 = 3): string {
  const title = eventTitle(event, lang);
  const summary = eventSummary(event, lang);
  const heading = 'h' + headingLevel;
  const source = event.source_url
    ? '<a href="' + escapeHtml(event.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(event)) + '">' + (lang === 'zh' ? '查看来源' : 'View source') + '</a>'
    : '<span>' + (lang === 'zh' ? '来源未知' : 'Source unknown') + '</span>';
  return [
    '<li class="landing-event-item">',
    '  <div class="landing-event-meta"><span class="category-badge category-' + event.category + '">' + escapeHtml(getCategoryLabel(event.category, lang)) + '</span><span class="source-quality-badge ' + sourceQualityClass(event) + '">' + escapeHtml(getSourceQualityLabel(event, lang)) + '</span><span>' + eventDateMarkup(event.published_at, lang) + '</span></div>',
    '  <' + heading + '><a href="' + getEventUrl(event.id!, lang) + '">' + escapeHtml(title) + '</a></' + heading + '>',
    '  <p>' + escapeHtml(summary) + '</p>',
    '  <p class="landing-event-source"><span>' + escapeHtml((lang === 'zh' ? '验证：' : 'Verification: ') + getVerificationLabel(event, lang)) + '</span> · ' + source + '</p>',
    '</li>',
  ].join('\n');
}

function renderLandingEventList(events: MonitorEvent[], lang: 'en' | 'zh', headingLevel: 3 | 4 = 3): string {
  if (events.length === 0) {
    return '<p class="empty-state">' + (lang === 'zh' ? '暂无符合条件的事件。' : 'No matching events are recorded.') + '</p>';
  }
  return '<ol class="landing-event-list">' + events.map(event => renderLandingEventItem(event, lang, headingLevel)).join('\n') + '</ol>';
}

function renderLandingFreshness(data: LandingPageData, lang: 'en' | 'zh'): string {
  const updatedAt = data.lastCheckedAt || data.sourceLastFetchedAt || null;
  const isZh = lang === 'zh';
  return [
    '<dl class="freshness-facts">',
    '  <div><dt>' + (isZh ? '最近更新' : 'Updated') + '</dt><dd>' + eventDateMarkup(updatedAt, lang, 'trust-time') + '</dd></div>',
    '</dl>',
  ].join('\n');
}

function renderResetTimeline(events: MonitorEvent[], lang: 'en' | 'zh'): string {
  if (events.length === 0) return '<p class="empty-state">' + (lang === 'zh' ? '暂无重置事件。' : 'No reset events are recorded.') + '</p>';

  const timeZone = displayTimeZoneForLanguage(lang);
  const englishMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const groups: Array<{ year: string; month: string; events: MonitorEvent[] }> = [];
  for (const event of events) {
    const date = event.published_at ? parseStoredUtc(event.published_at) : null;
    const parts = date ? datePartsInTimeZone(date, timeZone) : null;
    const year = parts ? parts.year : (lang === 'zh' ? '未知年份' : 'Unknown year');
    const month = parts
      ? (lang === 'zh'
        ? String(Number(parts.month)) + '月'
        : (englishMonths[Number(parts.month) - 1] || 'Unknown month'))
      : (lang === 'zh' ? '未知月份' : 'Unknown month');
    let group = groups.find(candidate => candidate.year === year && candidate.month === month);
    if (!group) {
      group = { year, month, events: [] };
      groups.push(group);
    }
    group.events.push(event);
  }

  const years: string[] = [];
  let currentYear = '';
  for (const group of groups) {
    if (group.year !== currentYear) {
      currentYear = group.year;
      years.push('<section class="history-year"><h3>' + escapeHtml(group.year) + '</h3>');
    }
    years.push('<section class="history-month"><h4>' + escapeHtml(group.month) + '</h4>' + renderLandingEventList(group.events, lang, 4) + '</section>');
    const nextGroup = groups[groups.indexOf(group) + 1];
    if (!nextGroup || nextGroup.year !== currentYear) years.push('</section>');
  }
  return years.join('\n');
}

function renderFaqContent(lang: 'en' | 'zh'): string {
  const methodologyPath = getLandingPath('methodology', lang);
  const historyPath = getLandingPath('reset-history', lang);
  const ratePath = getLandingPath('rate-limit-updates', lang);
  const items = lang === 'zh'
    ? [
      ['这个网站监控什么？', '记录 Tibo 公开发布的 Codex 额度重置、限额变化和订阅政策事件；每条事件都显示来源和状态。'],
      ['这个网站是官方的吗？', '这是独立监控站，与 OpenAI 无隶属关系。每条事件都附原始来源。'],
      ['什么是 Codex 使用额度重置？', '公开帖文会被分类为“计划重置”或“重置完成”，详情见事件来源。'],
      ['5 小时限额或周限额是多少？', '本站记录这类限额的公开变更；当前账户额度请以产品页面为准。'],
      ['什么是 Banked Reset？', '本站按原帖记录 Banked Reset 的说法，具体含义见原始来源。'],
      ['数据来自哪里？', '来源包括 X 直接数据、官方来源和网页搜索索引；来源类型会显示在事件上。'],
      ['事件如何验证？', 'DIRECT_VERIFIED、OFFICIAL_VERIFIED 和 INDEXED_ONLY 表示不同的证据路径；规则见方法论。'],
    ]
    : [
      ['What does this monitor track?', 'It records Tibo’s public Codex updates about usage resets, limit changes, and subscription policy, with the source and status shown for each event.'],
      ['Is this website official?', 'It is an independent monitor and is not affiliated with OpenAI. Every event links to its original source.'],
      ['What is a Codex usage reset?', 'A public post classified as RESET_PLANNED or RESET_COMPLETED. Open the event for its source and details.'],
      ['What is a 5-hour or weekly limit?', 'The monitor tracks public changes to these limits; current account limits belong on the product page.'],
      ['What is a banked reset?', 'The monitor keeps the wording used in the original post. Open the event for its source and status.'],
      ['Where does the data come from?', 'Sources include direct X data, official sources, and web-search index hits. The source type appears on each event.'],
      ['How are events verified?', 'DIRECT_VERIFIED, OFFICIAL_VERIFIED, and INDEXED_ONLY show the evidence path. See the methodology page for the rules.'],
    ];
  return [
    '<section class="faq-list" aria-label="' + (lang === 'zh' ? '常见问题列表' : 'Frequently asked questions') + '">',
    ...items.map(([question, answer]) => [
      '  <section class="faq-item">',
      '    <h2>' + escapeHtml(question) + '</h2>',
      '    <p>' + escapeHtml(answer) + '</p>',
      '  </section>',
    ].join('\n')),
    '</section>',
    '<p class="cross-link">' + (lang === 'zh' ? '查看完整的' : 'Read the full ') + '<a href="' + methodologyPath + '">' + (lang === 'zh' ? '方法论与验证规则' : 'methodology and verification rules') + '</a>。' + (lang === 'zh' ? '也可以浏览' : ' You can also browse the ') + '<a href="' + historyPath + '">' + (lang === 'zh' ? '重置历史' : 'reset history') + '</a> ' + (lang === 'zh' ? '和' : 'and') + ' <a href="' + ratePath + '">' + (lang === 'zh' ? '限额更新' : 'rate-limit updates') + '</a>。</p>',
  ].join('\n');
}

function renderMethodologyContent(lang: 'en' | 'zh'): string {
  const isZh = lang === 'zh';
  const sections = isZh
    ? [
      ['网站用途', '记录公开来源中的 Codex 额度、重置、限额和订阅政策动态。页面展示事件，不读取账户额度。'],
      ['数据来源', '来源包括 X 直接数据、官方来源和网页搜索索引；每条事件保留来源链接和来源类型。'],
      ['状态', 'DIRECT / OFFICIAL 表示已取得对应来源；INDEXED_ONLY 表示来自搜索索引，等待直接来源。'],
      ['摘要', '标题和摘要可能由分类器生成，并标记为 AI summary；原始来源用于复核。'],
      ['更新时间', '定时检查更新数据，并分别记录监控检查、来源获取和事件验证时间。'],
      ['更正', '后续证据可以更新事件状态；来源未提供的时间保持未知。'],
      ['当前规则', '需要账户额度或最新政策时，请查看 OpenAI 官方信息。'],
    ]
    : [
      ['Purpose', 'Tracks public Codex limit, reset, rate-limit, and subscription updates. It reports events, not account balances.'],
      ['Sources', 'Sources include direct X data, official sources, and web-search index hits. Each event keeps its source link and type.'],
      ['Status', 'DIRECT / OFFICIAL means the corresponding source was obtained; INDEXED_ONLY means it came from a search index and awaits direct source confirmation.'],
      ['Summaries', 'Titles and summaries may be generated by the classifier and are marked AI summary; the original source is the review path.'],
      ['Updates', 'Scheduled checks refresh the data and record monitor, source-fetch, and event-verification times separately.'],
      ['Corrections', 'Later evidence can update an event’s status; dates absent from the source remain Unknown.'],
      ['Current rules', 'For account limits and current policy, use OpenAI’s official information.'],
    ];
  return sections.map(([heading, text]) => [
    '<section class="methodology-section">',
    '  <h2>' + escapeHtml(heading) + '</h2>',
    '  <p>' + escapeHtml(text) + '</p>',
    '</section>',
  ].join('\n')).join('\n');
}

export function renderLandingPage(data: LandingPageData, lang: 'en' | 'zh', integrations?: SiteIntegrations): string {
  const isZh = lang === 'zh';
  const copy = LANDING_COPY[data.page][lang];
  const events = data.events;
  const latestEvent = data.latestEvent || events[0] || null;
  const indexable = data.page === 'faq' || data.page === 'methodology' || events.some(isEventIndexEligible);
  const canonical = getLandingUrl(data.page, lang);
  const breadcrumbName = copy.title;
  const breadcrumbJson = breadcrumbSchema([
    { name: isZh ? '首页' : 'Home', url: getCanonicalUrl(null, lang) },
    { name: breadcrumbName, url: canonical },
  ]);
  const itemList = events.length > 0 ? itemListSchema(events, lang) : null;
  const meta: SeoMeta = {
    lang,
    title: copy.title + ' | ' + (isZh ? 'Tibo 监控' : 'Tibo Monitor'),
    description: copy.description,
    canonical,
    isHomepage: false,
    eventId: null,
    enPath: getLandingPath(data.page, 'en'),
    zhPath: getLandingPath(data.page, 'zh'),
    robots: indexable ? 'index, follow' : 'noindex, follow',
    ogType: 'website',
    structuredData: [websiteSchema(lang, copy.lede), ...(itemList ? [itemList] : []), breadcrumbJson],
  };

  let content = '';
  if (data.page === 'latest') {
    content = [
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '当前状态' : 'Current status') + '</h2>',
      latestEvent
        ? [
          '  <div class="trust-panel">',
          '    <h3>' + (isZh ? '最近记录的事件' : 'Latest recorded event') + '</h3>',
          '    <p class="featured-event-title"><a href="' + getEventUrl(latestEvent.id!, lang) + '">' + escapeHtml(eventTitle(latestEvent, lang)) + '</a></p>',
          renderEventTrustFacts(latestEvent, lang),
          latestEvent.source_url ? '    <p class="primary-source"><strong>' + (isZh ? '主要来源：' : 'Primary source: ') + '</strong><a href="' + escapeHtml(latestEvent.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(latestEvent.id)) + '" data-analytics-event-category="' + escapeHtml(latestEvent.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(latestEvent)) + '">' + escapeHtml(latestEvent.source_url) + '</a></p>' : '',
          '  </div>',
        ].filter(Boolean).join('\n')
        : '  <p class="empty-state">' + (isZh ? '当前状态：未知，尚无事件记录。' : 'Current status: Unknown; no event is recorded.') + '</p>',
      renderLandingFreshness(data, lang),
      '</section>',
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '最近事件' : 'Recent events') + '</h2>',
      renderLandingEventList(events, lang),
      '</section>',
      '<section class="landing-section cross-link-section">',
      '  <h2>' + (isZh ? '如何阅读' : 'How to read this page') + '</h2>',
      '  <p>' + (isZh ? '验证状态、来源类型和时间字段的定义见' : 'Definitions for verification, source type, and timestamps are in the ') + '<a href="' + getLandingPath('methodology', lang) + '">' + (isZh ? '方法论' : 'methodology') + '</a>。</p>',
      '</section>',
    ].join('\n');
  } else if (data.page === 'reset-history') {
    content = [
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '当前状态' : 'Current status') + '</h2>',
      latestEvent
        ? '  <p>' + (isZh ? '最近的重置记录：' : 'Latest reset record: ') + '<a href="' + getEventUrl(latestEvent.id!, lang) + '">' + escapeHtml(eventTitle(latestEvent, lang)) + '</a> · ' + escapeHtml(getVerificationLabel(latestEvent, lang)) + '</p>'
        : '  <p class="empty-state">' + (isZh ? '当前状态：未知，暂无重置事件。' : 'Current status: Unknown; no reset events are recorded.') + '</p>',
      '</section>',
      '<section class="landing-section history-timeline">',
      '  <h2>' + (isZh ? '时间线' : 'Timeline') + '</h2>',
      renderResetTimeline(events, lang),
      '</section>',
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '重置类型' : 'Reset types recorded') + '</h2>',
      '  <ul class="plain-list">',
      '    <li><code>RESET_PLANNED</code> — ' + (isZh ? '公开来源中的计划或公告。' : 'planned or announced in the public source.') + '</li>',
      '    <li><code>RESET_COMPLETED</code> — ' + (isZh ? '公开来源中的完成公告。' : 'completed in the public source.') + '</li>',
      '    <li><code>RESET_TIME_CHANGED</code> — ' + (isZh ? '重置时间发生变化。' : 'reset timing changed.') + '</li>',
      '  </ul>',
      '</section>',
      '<section class="landing-section cross-link-section">',
      '  <h2>' + (isZh ? '相关限额更新' : 'Related limit updates') + '</h2>',
      '  <p><a href="' + getLandingPath('rate-limit-updates', lang) + '">' + (isZh ? '查看限额和政策更新' : 'Browse rate-limit and policy updates') + '</a> · <a href="' + getLandingPath('faq', lang) + '">' + (isZh ? '查看常见问题' : 'Read the FAQ') + '</a> · <a href="' + getLandingPath('methodology', lang) + '">' + (isZh ? '查看方法论' : 'Read the methodology') + '</a>。</p>',
      '</section>',
    ].join('\n');
  } else if (data.page === 'rate-limit-updates') {
    content = [
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '本页包含的分类' : 'Recorded categories on this page') + '</h2>',
      '  <ul class="plain-list">',
      '    <li><code>POLICY_CHANGE</code> — ' + (isZh ? '政策或订阅相关的事件分类。' : 'events classified as policy or subscription changes.') + '</li>',
      '    <li><code>RESET_TIME_CHANGED</code> — ' + (isZh ? '重置时间变更分类。' : 'events classified as reset-time changes.') + '</li>',
      '  </ul>',
      '</section>',
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '更新' : 'Updates') + '</h2>',
      renderLandingEventList(events, lang),
      '</section>',
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '范围说明' : 'Scope') + '</h2>',
      '  <p>' + (isZh ? '记录涵盖 5 小时、周限额、速率、套餐和订阅更新；打开事件查看来源和状态。' : 'Covers 5-hour, weekly, rate, plan, and subscription updates. Open an event for its source and status.') + '</p>',
      '  <p><a href="' + getLandingPath('reset-history', lang) + '">' + (isZh ? '查看重置历史' : 'View reset history') + '</a> · <a href="' + getLandingPath('methodology', lang) + '">' + (isZh ? '查看方法论' : 'Read methodology') + '</a></p>',
      '</section>',
    ].join('\n');
  } else if (data.page === 'faq') {
    content = renderFaqContent(lang);
  } else {
    content = renderMethodologyContent(lang);
  }

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { alternatePath: getLandingPath(data.page, lang === 'zh' ? 'en' : 'zh') }),
    '    <main class="landing-page">',
    '      <nav class="breadcrumb" aria-label="' + (isZh ? '面包屑导航' : 'Breadcrumb') + '">',
    '        <a href="' + getHomePath(lang) + '">' + (isZh ? '首页' : 'Home') + '</a><span class="breadcrumb-sep">/</span><span class="breadcrumb-current">' + escapeHtml(copy.title) + '</span>',
    '      </nav>',
    '      <header class="landing-header">',
    '        <h1>' + escapeHtml(copy.title) + '</h1>',
    '        <p>' + escapeHtml(copy.lede) + '</p>',
    '      </header>',
    content,
    '    </main>',
    renderSiteFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
  return renderHead(meta, integrations) + '\n' + body;
}

// ── Homepage SSR ──

export function renderHomepage(data: HomepageData, lang: 'en' | 'zh', integrations?: SiteIntegrations): string {
  const isZh = lang === 'zh';
  const accounts = data.accounts && data.accounts.length > 0 ? data.accounts : ['thsottiaux'];
  const accountLabel = accounts.map(account => '@' + account).join(', ');
  const accountDescription = accounts.length === 1 && accounts[0] === 'thsottiaux'
    ? (isZh ? 'Tibo（@thsottiaux）' : 'Tibo (@thsottiaux)')
    : accountLabel;
  const meta: SeoMeta = {
    lang,
    title: HOMEPAGE_COPY[lang].title,
    description: accounts.length === 1 && accounts[0] === 'thsottiaux'
      ? HOMEPAGE_COPY[lang].description
      : (isZh
        ? '追踪 ' + accountDescription + ' 公开发布的 Codex 额度重置、限额变化与订阅政策更新。'
        : 'Track public Codex usage-limit resets, rate-limit changes and policy updates from ' + accountDescription + '.'),
    canonical: getCanonicalUrl(null, lang),
    isHomepage: true,
    eventId: null,
    enPath: '/',
    zhPath: '/zh/',
    ogType: 'website',
  };

  const latestEvent = data.latestEvent;
  const manualReset = data.manualReset ?? null;
  const lastChecked = data.lastCheckedAt
    ? formatDateForLanguage(data.lastCheckedAt, lang)
    : (isZh ? '未知（尚无成功监控运行）' : 'Unknown (no successful monitor run)');
  const lastCheckedMarkup = data.lastCheckedAt
    ? localTimeElement(data.lastCheckedAt, lastChecked, 'status-time')
    : escapeHtml(lastChecked);

  const lastResetLabel = isZh ? '最近重置' : 'Last Reset';
  const policyLabel = isZh ? '最新政策变更' : 'Latest Policy Change';
  const latestChangeLabel = isZh ? '最新动态' : 'Latest Change';
  const lastCheckedLabel = isZh ? '最近检查' : 'Last Checked';
  const sourceStatusLabel = isZh ? '信息源' : 'Information Source';
  const sourceStatusValue = data.sourceMode === 'x_direct'
    ? (isZh ? 'X 直接源' : 'X Direct')
    : data.sourceMode === 'web_indexed'
      ? (isZh ? '网页索引' : 'Web Indexed')
      : '—';

  const effectiveLastResetAt = manualReset?.resetAt ?? data.lastReset?.published_at ?? null;
  const lastResetIsManual = Boolean(manualReset?.resetAt);
  const lastResetFallback = effectiveLastResetAt
    ? (lastResetIsManual
      ? formatManualResetTime(effectiveLastResetAt, lang)
      : formatDateForLanguage(effectiveLastResetAt, lang))
    : '—';
  const lastResetMarkup = effectiveLastResetAt
    ? (lastResetIsManual
      ? fixedTimezoneTimeElement(effectiveLastResetAt, lang, 'status-time manual-reset-time')
      : localTimeElement(effectiveLastResetAt, lastResetFallback, 'status-time'))
    : escapeHtml(lastResetFallback);
  const policyVal = data.lastPolicy
    ? (isZh ? data.lastPolicy.title_zh : data.lastPolicy.title_en)
    : '—';
  const latestVal = latestEvent
    ? (isZh ? latestEvent.title_zh : latestEvent.title_en)
    : '—';

  // SSR events list
  let eventsHtml = '';
  if (data.events.length === 0) {
    eventsHtml = '<li class="timeline-empty"><p>' + (isZh ? '暂无事件。' : 'No events to display.') + '</p></li>';
  } else {
    let lastDate = '';
    for (const event of data.events) {
      const dateStr = formatDateShort(event.published_at, lang);
      const showDate = dateStr !== lastDate;
      lastDate = dateStr;
      const title = isZh ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
      const summary = isZh ? (event.summary_zh || event.summary_en) : (event.summary_en || event.summary_zh);
      const category = getCategoryLabel(event.category, lang);
      const eventUrl = getEventUrl(event.id!, lang);

      eventsHtml += [
        '<li class="timeline-item ' + event.category + '">',
        '  <div class="timeline-dot">',
        '    <div class="timeline-dot-marker"></div>',
        '  </div>',
        '  <div class="timeline-content">',
        (showDate ? '    <div class="timeline-date">' + localTimeElement(event.published_at, dateStr, 'timeline-date', 'date') + '</div>' : ''),
        '    <div style="margin-bottom:0.375rem">',
      '      <span class="category-badge category-' + event.category + '">' + escapeHtml(category) + '</span>',
        '      <span class="source-quality-badge ' + sourceQualityClass(event) + '">' + escapeHtml(getSourceQualityLabel(event, lang)) + '</span>',
        '    </div>',
        '    <a href="' + escapeHtml(eventUrl) + '" class="timeline-title-link">',
        '      <h3 class="timeline-title">' + escapeHtml(title) + '</h3>',
        '    </a>',
        '    <div class="timeline-summary">' + escapeHtml(summary) + '</div>',
        '  </div>',
        '</li>',
      ].join('\n');
    }
  }

  // Latest event highlight
  let highlightHtml = '';
  if (latestEvent) {
    const title = isZh ? (latestEvent.title_zh || latestEvent.title_en) : (latestEvent.title_en || latestEvent.title_zh);
    const summary = isZh ? (latestEvent.summary_zh || latestEvent.summary_en) : (latestEvent.summary_en || latestEvent.summary_zh);
    const category = getCategoryLabel(latestEvent.category, lang);
    const eventUrl = getEventUrl(latestEvent.id!, lang);

    highlightHtml = [
      '<div class="event-highlight-card">',
      '  <div class="event-highlight-top">',
      '    <div>',
      '      <span class="category-badge category-' + latestEvent.category + '">',
      '        ' + escapeHtml(category),
      '      </span>',
      '      <span class="source-quality-badge ' + sourceQualityClass(latestEvent) + '">' + escapeHtml(getSourceQualityLabel(latestEvent, lang)) + '</span>',
      '    </div>',
    '    <div class="event-highlight-meta">',
      '      <span>' + localTimeElement(latestEvent.published_at, formatDateForLanguage(latestEvent.published_at, lang), 'event-time') + '</span>',
      latestEvent.source_url ? '      <a href="' + escapeHtml(latestEvent.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(latestEvent.id)) + '" data-analytics-event-category="' + escapeHtml(latestEvent.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(latestEvent)) + '">' + (isZh ? '查看来源' : 'View source') + ' →</a>' : '',
    '    </div>',
      '  </div>',
      '  <a href="' + escapeHtml(eventUrl) + '" class="event-highlight-title-link">',
      '    <h3 class="event-highlight-title">' + escapeHtml(title) + '</h3>',
      '  </a>',
      '  <div class="event-highlight-summary">' + escapeHtml(summary) + '</div>',
      '</div>',
    ].join('\n');
  } else {
    highlightHtml = '<div class="highlight-empty"><p>' + (isZh ? '暂无最新事件。' : 'No recent events.') + '</p></div>';
  }

  // Intro paragraph
  const introText = isZh
    ? '追踪 ' + accountDescription + ' 公开发布的 Codex 额度重置、限额变化和订阅动态；每条事件都附来源和状态。'
    : 'Track public Codex resets, limit changes, and subscription updates from ' + accountDescription + '; every event includes its source and status.';

  const manualResetNotice = manualReset
    ? [
      '    <section class="manual-reset-notice" id="manualResetNotice" aria-live="polite">',
      '      <div class="manual-reset-notice-title">' + (isZh ? '服务器重置报告' : 'Server reset report') + '</div>',
      '      <div class="manual-reset-notice-body">' + (isZh ? '服务器报告额度已重置。 ' : 'Server reported a usage reset. ') + fixedTimezoneTimeElement(manualReset.resetAt, lang, 'manual-reset-time') + '</div>',
      manualReset.note ? '      <div class="manual-reset-notice-note">' + (isZh ? '备注：' : 'Note: ') + escapeHtml(manualReset.note) + '</div>' : '',
      '      <div class="manual-reset-notice-meta">' + (isZh ? '系统自动报告。' : 'Automated report.') + '</div>',
      '    </section>',
    ].filter(Boolean).join('\n')
    : '    <section class="manual-reset-notice" id="manualResetNotice" style="display:none" aria-live="polite"></section>';

  // The same array is rendered below and represented in ItemList. Keeping
  // this as one value prevents SSR/schema count drift.
  const itemListJson = itemListSchema(data.events, lang);
  meta.structuredData = [websiteSchema(lang, introText)];

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { accounts, interactive: true }),
    '',
    '    <main class="homepage-main">',
    '      <section class="site-intro" aria-labelledby="pageTitle">',
    '        <h1 id="pageTitle">' + escapeHtml(meta.title) + '</h1>',
    '        <p class="intro-lede">' + escapeHtml(introText) + '</p>',
    '      </section>',
    '',
    manualResetNotice,
    '',
    '    <!-- Reset Countdown -->',
    '    <section class="countdown-section" id="countdownSection" style="display:none">',
    '      <div class="countdown-header">',
    '        <span class="countdown-title" id="countdownTitle">' + (isZh ? '重置倒计时' : 'Reset Countdown') + '</span>',
    '        <span class="countdown-status-badge" id="countdownStatusBadge"></span>',
    '      </div>',
    '      <div class="countdown-display" id="countdownDisplay">',
    '        <div class="countdown-time" id="countdownTime">--:--:--</div>',
    '        <div class="countdown-info" id="countdownInfo"></div>',
    '      </div>',
    '      <div class="countdown-empty" id="countdownEmpty">',
    '        <p id="countdownEmptyText">' + (isZh ? '目前没有已知的重置计划。' : 'No reset currently scheduled.') + '</p>',
    '        <div class="countdown-history-reference" id="countdownHistoryReference" style="display:none" aria-live="polite">',
    '          <div class="countdown-history-line" id="countdownDaysSinceLastReset"></div>',
    '          <div class="countdown-history-line" id="countdownAverageResetInterval"></div>',
    '          <div class="countdown-history-disclaimer" id="countdownHistoryDisclaimer">' + (isZh ? '历史参考' : 'Historical reference') + '</div>',
    '        </div>',
    '      </div>',
    '    </section>',
    '',
    '    <!-- Status Cards -->',
    '    <section class="status-grid" id="statusGrid">',
    '      <div class="status-card">',
    '        <div class="status-card-label" id="cardLabelLastReset">' + lastResetLabel + '</div>',
    '        <div class="status-card-value" id="lastResetValue">' + lastResetMarkup + '</div>',
    '      </div>',
    '      <div class="status-card">',
    '        <div class="status-card-label" id="cardLabelCurrentPolicy">' + policyLabel + '</div>',
    '        <div class="status-card-value" id="currentPolicyValue">' + escapeHtml(policyVal) + '</div>',
    '      </div>',
    '      <div class="status-card">',
    '        <div class="status-card-label" id="cardLabelLatestChange">' + latestChangeLabel + '</div>',
    '        <div class="status-card-value" id="latestChangeValue">' + escapeHtml(latestVal) + '</div>',
    '      </div>',
      '      <div class="status-card">',
      '        <div class="status-card-label" id="cardLabelLastChecked">' + lastCheckedLabel + '</div>',
      '        <div class="status-card-value" id="lastCheckedValue">' + lastCheckedMarkup + '</div>',
      '      </div>',
      '      <div class="status-card">',
      '        <div class="status-card-label" id="cardLabelSourceStatus">' + sourceStatusLabel + '</div>',
      '        <div class="status-card-value" id="sourceStatusValue">' + escapeHtml(sourceStatusValue) + '</div>',
      '      </div>',
    '    </section>',
    '',
    '    <!-- Latest Event Highlight -->',
    '    <section class="latest-event" id="latestEvent">',
    '      <h2 id="latestEventTitle">' + (isZh ? '最新事件' : 'Latest event') + '</h2>',
    '      <div class="event-highlight" id="eventHighlight">',
    highlightHtml,
    '      </div>',
    '    </section>',
    '',
    '    <!-- Timeline -->',
    '    <section class="timeline-section">',
    '      <div class="section-header">',
    '        <h2 id="timelineTitle">' + (isZh ? '时间线' : 'Timeline') + '</h2>',
    '        <div class="filter-bar">',
    '          <button class="filter-btn active" data-filter="ALL" id="filterAll">' + (isZh ? '全部' : 'All') + '</button>',
    '          <button class="filter-btn" data-filter="RESET_PLANNED" id="filterResetPlanned">' + (isZh ? '计划重置' : 'Reset Planned') + '</button>',
    '          <button class="filter-btn" data-filter="RESET_COMPLETED" id="filterResetCompleted">' + (isZh ? '重置完成' : 'Reset Completed') + '</button>',
    '          <button class="filter-btn" data-filter="RESET_TIME_CHANGED" id="filterTimeChanged">' + (isZh ? '时间变更' : 'Time Changed') + '</button>',
    '          <button class="filter-btn" data-filter="POLICY_CHANGE" id="filterPolicyChange">' + (isZh ? '政策' : 'Policy') + '</button>',
    '        </div>',
    '      </div>',
    '      <div class="event-tools" id="eventTools">',
    '        <form class="event-search-form" id="eventSearchForm" role="search">',
    '          <label class="sr-only" id="eventSearchLabel" for="eventSearchInput">' + (isZh ? '搜索事件' : 'Search events') + '</label>',
    '          <div class="search-input-wrap">',
    '            <svg class="search-input-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>',
    '            <input id="eventSearchInput" type="search" autocomplete="off" maxlength="120" placeholder="' + (isZh ? '搜索标题、摘要或来源文本' : 'Search titles, summaries or source text') + '">',
    '          </div>',
    '          <div class="date-filter-group">',
    '            <label for="startDateInput" id="startDateLabel">' + (isZh ? '从' : 'From') + '</label>',
    '            <input id="startDateInput" type="date">',
    '            <label for="endDateInput" id="endDateLabel">' + (isZh ? '至' : 'To') + '</label>',
    '            <input id="endDateInput" type="date">',
    '          </div>',
    '          <button class="secondary-btn" type="button" id="clearFilters">' + (isZh ? '清除' : 'Clear') + '</button>',
    '        </form>',
    '        <div class="export-actions">',
    '          <span class="export-label" id="exportLabel">' + (isZh ? '导出' : 'Export') + '</span>',
    '          <button class="export-btn" type="button" data-export-format="csv" id="exportCsv">CSV</button>',
    '          <button class="export-btn" type="button" data-export-format="json" id="exportJson">JSON</button>',
    '          <span class="export-status" id="exportStatus" role="status" aria-live="polite"></span>',
    '        </div>',
    '      </div>',
      '      <ol class="timeline" id="timeline">',
    eventsHtml,
    '      </ol>',
    (data.events.length === 0
      ? '      <div class="timeline-loading" id="timelineLoading" style="display:none">\n' +
        '        <div class="loading-spinner"></div>\n' +
        '        <span id="loadingText">' + (isZh ? '正在加载事件...' : 'Loading events...') + '</span>\n' +
        '      </div>'
      : ''),
    '    </section>',
    '    </main>',
    '',
    '    <!-- Event Detail Modal -->',
    '    <div class="modal-overlay" id="eventModal" style="display:none">',
    '      <div class="modal">',
    '        <button class="modal-close" id="modalClose">&times;</button>',
    '        <div class="modal-content" id="modalContent">',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    renderSiteFooter(lang),
    '  </div>',
    '',
    '  <script src="/app.js" defer></script>',
    '',
    '  <!-- SSR Data (consumed by app.js) -->',
    '  <script>',
    '    window.__SSR_META__ = ' + safeJsonForScript({
      lang: lang === 'zh' ? 'zh-CN' : 'en',
      title: meta.title,
      description: meta.description,
      canonical: meta.canonical,
    }) + ';',
    '    window.__SSR_EVENTS__ = ' + safeJsonForScript(data.events) + ';',
    '    window.__SSR_LATEST_EVENT__ = ' + safeJsonForScript(data.latestEvent) + ';',
    '    window.__SSR_LAST_RESET__ = ' + safeJsonForScript(data.lastReset) + ';',
    '    window.__SSR_MANUAL_RESET__ = ' + safeJsonForScript(manualReset) + ';',
    '    window.__SSR_LAST_POLICY__ = ' + safeJsonForScript(data.lastPolicy) + ';',
    '    window.__SSR_LAST_CHECKED__ = ' + safeJsonForScript(data.lastCheckedAt) + ';',
    '    window.__SSR_SOURCE_FETCHED__ = ' + safeJsonForScript(data.sourceLastFetchedAt ?? null) + ';',
    '    window.__SSR_SOURCE_LAST_NEW_POST__ = ' + safeJsonForScript(data.sourceLastNewPostAt ?? null) + ';',
    '    window.__SSR_SOURCE_MODE__ = ' + safeJsonForScript(data.sourceMode ?? null) + ';',
    '    window.__SSR_ACCOUNTS__ = ' + safeJsonForScript(accounts) + ';',
    '    window.__SSR_TOTAL_EVENTS__ = ' + data.totalEvents + ';',
    '  </script>',
    '',
    '  <!-- ItemList Structured Data -->',
    '  <script type="application/ld+json">',
    itemListJson,
    '</script>',
    '',
    '</body>',
    '</html>',
  ].join('\n');

  return renderHead(meta, integrations) + '\n' + body;
}

// ── Event Page SSR ──

export function renderEventPage(data: EventPageData, lang: 'en' | 'zh', integrations?: SiteIntegrations): string {
  const event = data.event;
  const isZh = lang === 'zh';

  const title = isZh ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
  const description = isZh ? (event.summary_zh || event.summary_en) : (event.summary_en || event.summary_zh);
  const category = getCategoryLabel(event.category, lang);
  const sourceAccount = event.source_account
    ? (event.source_account === 'thsottiaux' ? 'Tibo (@thsottiaux)' : '@' + event.source_account)
    : (isZh ? '未知' : 'Unknown');

  const meta: SeoMeta = {
    lang,
    title: title + ' — ' + (isZh ? 'Tibo Codex 监控' : 'Tibo Codex Monitor'),
    description: truncateMetaDescription(description),
    canonical: getCanonicalUrl(event.id!, lang),
    isHomepage: false,
    eventId: event.id!,
    enPath: getEventUrl(event.id!, 'en'),
    zhPath: getEventUrl(event.id!, 'zh'),
    ogType: 'article',
    robots: isEventIndexEligible(event) ? 'index, follow' : 'noindex, follow',
    publishedAt: event.published_at,
    modifiedAt: event.updated_at,
  };

  const unavailable = isZh ? '未知' : 'Unknown';
  const pendingVerification = isZh ? '待验证' : 'Pending verification';
  const pubTime = event.published_at
    ? formatDateForLanguage(event.published_at, lang)
    : unavailable;
  const localPubTime = localTimeElement(event.published_at, pubTime, 'event-detail-time');
  const observedTime = event.observed_at
    ? localTimeElement(event.observed_at, formatDateForLanguage(event.observed_at, lang), 'event-detail-time')
    : escapeHtml(unavailable);
  const verifiedTime = event.verified_at
    ? localTimeElement(event.verified_at, formatDateForLanguage(event.verified_at, lang), 'event-detail-time')
    : escapeHtml(pendingVerification);
  const effectiveTime = event.effective_at
    ? eventDateMarkup(event.effective_at, lang, 'event-detail-time')
    : '';
  const resetTime = event.reset_at
    ? eventDateMarkup(event.reset_at, lang, 'event-detail-time')
    : '';

  // Build structured content sections
  const sections: string[] = [];

  // What changed?
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '变更内容' : 'What Changed') + '</h2>',
    '  <div class="modal-value">' + escapeHtml(title) + '</div>',
    '</section>',
  ].join('\n'));

  // Evidence provenance is intentionally visible next to the event details.
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '验证' : 'Verification') + '</h2>',
    '  <dl class="event-facts">',
    '    <div><dt>' + (isZh ? '来源类型' : 'Source type') + '</dt><dd><span class="source-quality-badge ' + sourceQualityClass(event) + '">' + escapeHtml(getSourceQualityLabel(event, lang)) + '</span></dd></div>',
    '    <div><dt>' + (isZh ? '状态' : 'Status') + '</dt><dd><code>' + escapeHtml(getVerificationStatusCode(event)) + '</code> · ' + escapeHtml(getVerificationLabel(event, lang)) + '</dd></div>',
    '    <div><dt>' + (isZh ? '发现方式' : 'Found via') + '</dt><dd>' + escapeHtml(event.first_discovered_via || unavailable) + '</dd></div>',
    '    <div><dt>' + (isZh ? '验证方式' : 'Verified via') + '</dt><dd>' + escapeHtml(event.last_verified_via || pendingVerification) + '</dd></div>',
    '  </dl>',
    '</section>',
  ].join('\n'));

  // Summary
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '摘要' : 'Summary') + ' <span class="modal-tag ai">AI summary</span></h2>',
    '  <div class="modal-value ai-summary">' + escapeHtml(description) + '</div>',
    '</section>',
  ].join('\n'));

  // Keep the interpretation close to the source without repeating a general
  // account-scope disclaimer on every event page.
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '这意味着什么？' : 'What does this mean?') + '</h2>',
    '  <p class="modal-value">' + escapeHtml(isZh
      ? '根据链接的公开来源归类为「' + category + '」。详情见原始来源。'
      : 'Classified from the linked public source as “' + category + '”. See the original source for details.') + '</p>',
    '</section>',
  ].join('\n'));

  // Category
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '类型' : 'Type') + '</h2>',
    '  <div>',
    '    <span class="category-badge category-' + event.category + '">' + escapeHtml(category) + '</span>',
    '  </div>',
    '</section>',
  ].join('\n'));

  // Dates are kept distinct: publication is source time, observed is fetch
  // time, and verified is the event-level verification timestamp.
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '时间' : 'Event dates') + '</h2>',
    '  <dl class="event-facts">',
    '    <div><dt>' + (isZh ? '发布时间' : 'Published') + '</dt><dd>' + localPubTime + '</dd></div>',
    '    <div><dt>' + (isZh ? '观察时间' : 'Observed') + '</dt><dd>' + observedTime + '</dd></div>',
    '    <div><dt>' + (isZh ? '最近验证' : 'Last verified') + '</dt><dd>' + verifiedTime + '</dd></div>',
    effectiveTime ? '    <div><dt>' + (isZh ? '生效时间' : 'Effective') + '</dt><dd>' + effectiveTime + '</dd></div>' : '',
    resetTime ? '    <div><dt>' + (isZh ? '重置时间' : 'Reset time') + '</dt><dd>' + resetTime + '</dd></div>' : '',
    event.updated_at ? '    <div><dt>' + (isZh ? '记录更新时间' : 'Record updated') + '</dt><dd>' + eventDateMarkup(event.updated_at, lang, 'event-detail-time') + '</dd></div>' : '',
    '</dl>',
    '</section>',
  ].join('\n'));

  // Original source
  if (event.source_text) {
    const excerpt = event.source_text.length > 300
      ? event.source_text.substring(0, 300) + '...'
      : event.source_text;
    sections.push([
      '<section class="modal-section">',
      '  <h2 class="modal-label">' + (isZh ? '原始来源' : 'Original source') + ' <span class="modal-tag source">' + (isZh ? '证据' : 'Evidence') + '</span></h2>',
      '  <div class="modal-value source-text">' + escapeHtml(excerpt) + '</div>',
      '</section>',
    ].join('\n'));
  }

  // Source account
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '来源' : 'Source') + '</h2>',
    '  <div class="modal-value">' + escapeHtml(sourceAccount) + '</div>',
    '</section>',
  ].join('\n'));

  // View original
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '查看原帖' : 'View Original') + '</h2>',
    event.source_url
      ? '  <a class="modal-link" href="' + escapeHtml(event.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(event)) + '">' + (isZh ? '打开来源 →' : 'Open source →') + '</a>'
      : '  <div class="modal-value">' + escapeHtml(unavailable) + '</div>',
    '</section>',
  ].join('\n'));

  // Confidence
  const confidencePercent = Math.round(event.confidence * 100);
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '置信度' : 'Confidence') + '</h2>',
    '  <div class="modal-value">' + confidencePercent + '%</div>',
    '</section>',
  ].join('\n'));

  // Breadcrumb
  const breadcrumbJson = breadcrumbSchema([
    { name: isZh ? '首页' : 'Home', url: getCanonicalUrl(null, lang) },
    { name: title, url: getCanonicalUrl(event.id!, lang) },
  ]);
  meta.structuredData = [
    websiteSchema(lang),
    articleSchema(event, lang, meta.canonical!),
    breadcrumbJson,
  ];

  // Navigation
  let navHtml = '';
  if (data.prevEvent) {
    const prevTitle = isZh ? (data.prevEvent.title_zh || data.prevEvent.title_en) : (data.prevEvent.title_en || data.prevEvent.title_zh);
    navHtml += '<a href="' + getEventUrl(data.prevEvent.id!, lang) + '" class="event-nav-prev">← ' + escapeHtml(prevTitle) + '</a>';
  }
  if (data.nextEvent) {
    const nextTitle = isZh ? (data.nextEvent.title_zh || data.nextEvent.title_en) : (data.nextEvent.title_en || data.nextEvent.title_zh);
    navHtml += '<a href="' + getEventUrl(data.nextEvent.id!, lang) + '" class="event-nav-next">' + escapeHtml(nextTitle) + ' →</a>';
  }

  // Related events
  let relatedHtml = '';
  if (data.relatedEvents.length > 0) {
    relatedHtml = '<section class="related-events"><h2>' + (isZh ? '同类型事件' : 'More events in this category') + '</h2><ol>';
    for (const re of data.relatedEvents) {
      const reTitle = isZh ? (re.title_zh || re.title_en) : (re.title_en || re.title_zh);
      const reDate = formatDateShort(re.published_at, lang);
      relatedHtml += '<li><a href="' + getEventUrl(re.id!, lang) + '">' + escapeHtml(reTitle) + '</a> <span class="event-date">' + localTimeElement(re.published_at, reDate, 'event-date', 'date') + '</span></li>';
    }
    relatedHtml += '</ol></section>';
  }
  const topicHtml = '<p class="event-topic-link">' + (isZh ? '主题入口：' : 'Topic: ') + '<a href="' + getTopicPath(event.category, lang) + '">' + escapeHtml(event.category === 'POLICY_CHANGE' || event.category === 'RESET_TIME_CHANGED'
    ? (isZh ? '限额更新' : 'Rate limit updates')
    : (isZh ? '重置历史' : 'Reset history')) + '</a></p>';
  const contextHtml = [
    '<section class="event-context">',
    '  <h2>' + (isZh ? '历史上下文' : 'Historical context') + '</h2>',
    '  <p>' + (isZh ? '查看前后事件或' : 'See the previous/next events or the ') + '<a href="' + getTopicPath(event.category, lang) + '">' + (isZh ? '主题时间线' : 'topic timeline') + '</a>。</p>',
    '</section>',
  ].join('\n');

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { alternatePath: getEventUrl(event.id!, lang === 'zh' ? 'en' : 'zh') }),
    '',
    '    <!-- Breadcrumb -->',
    '    <nav class="breadcrumb" aria-label="' + (isZh ? '面包屑导航' : 'Breadcrumb') + '">',
    '      <a href="' + getHomePath(lang) + '">' + (isZh ? '首页' : 'Home') + '</a>',
    '      <span class="breadcrumb-sep">/</span>',
    '      <span class="breadcrumb-current">' + escapeHtml(title) + '</span>',
    '    </nav>',
    '',
    '    <main>',
    '      <!-- Event Detail -->',
    '      <article class="event-detail-page" data-analytics-page-type="event_detail" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(event)) + '" data-analytics-verification-status="' + escapeHtml(getVerificationStatusCode(event)) + '">',
    '      <header class="event-detail-header">',
    '        <h1 class="event-detail-title">' + escapeHtml(title) + '</h1>',
    '        <div class="event-detail-meta">',
    '          <span class="category-badge category-' + event.category + '">' + escapeHtml(category) + '</span>',
    '          ' + localTimeElement(event.published_at, pubTime, 'event-detail-date'),
    '        </div>',
    '      </header>',
    '',
    '      <div class="event-detail-body">',
    sections.join('\n'),
    '      </div>',
    '',
    contextHtml,
    '',
    '      <!-- Event Navigation -->',
    '      <nav class="event-navigation" aria-label="' + (isZh ? '事件时间顺序' : 'Event chronology') + '">',
    navHtml,
    '      </nav>',
    '',
    topicHtml,
    relatedHtml,
    '',
    '      </article>',
    '    </main>',
    '',
    renderSiteFooter(lang),
    '  </div>',
    '',
    '</body>',
    '</html>',
  ].join('\n');

  return renderHead(meta, integrations) + '\n' + body;
}

// ── 404 Page ──

export function render404(lang: 'en' | 'zh', integrations?: SiteIntegrations): string {
  const isZh = lang === 'zh';
  const meta: SeoMeta = {
    lang,
    title: isZh ? '页面未找到 — Tibo Codex 监控' : 'Page Not Found — Tibo Codex Monitor',
    description: isZh ? '请求的页面不存在。' : 'The requested page was not found.',
    canonical: null,
    isHomepage: false,
    eventId: null,
    robots: 'noindex, nofollow',
  };

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { alternatePath: null }),
    '    <main class="not-found-page">',
    '      <h1>' + (isZh ? '404 — 页面未找到' : '404 — Page not found') + '</h1>',
    '      <p>' + (isZh ? '请求的页面不存在。' : 'The requested page does not exist.') + '</p>',
    '      <nav aria-label="' + (isZh ? '帮助导航' : 'Helpful navigation') + '">',
    '        <a href="' + getHomePath(lang) + '">' + (isZh ? '首页' : 'Home') + '</a>',
    '        <a href="' + getLandingPath('latest', lang) + '">' + (isZh ? '最新动态' : 'Latest') + '</a>',
    '        <a href="' + getLandingPath('reset-history', lang) + '">' + (isZh ? '重置历史' : 'Reset History') + '</a>',
    '        <a href="' + getLandingPath('faq', lang) + '">' + (isZh ? '常见问题' : 'FAQ') + '</a>',
    '      </nav>',
    '    </main>',
    renderSiteFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');

  return renderHead(meta, integrations) + '\n' + body;
}

// ── RSS Feed ──

function rssDate(value: string | null | undefined): string {
  if (!value) return new Date(0).toUTCString();
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const parsed = parseStoredUtc(sqliteUtc);
  return parsed ? parsed.toUTCString() : new Date(0).toUTCString();
}

export function renderRssFeed(
  events: MonitorEvent[],
  lang: 'en' | 'zh' = 'zh',
  manualReset: ManualResetReportPublic | null = null,
): string {
  const visibleEvents = events.filter(event => event.id !== undefined).slice(0, 20);
  const channelTitle = lang === 'zh' ? 'Tibo Codex 监控' : 'Tibo Codex Monitor';
  const channelDescription = lang === 'zh'
    ? '追踪 Tibo（@thsottiaux）公开发布的 Codex 额度重置、限额和订阅政策事件。'
    : 'Public Codex usage-limit reset, rate-limit and subscription policy events tracked by Tibo Monitor.';
  const eventItems = visibleEvents.map(event => {
    const title = eventTitle(event, lang);
    const summary = eventSummary(event, lang);
    const eventUrl = SITE_URL + getEventUrl(event.id!, lang);
    const description = [
      summary,
      event.source_text ? (lang === 'zh' ? '原始来源：' : 'Source text: ') + event.source_text : '',
      event.source_url ? (lang === 'zh' ? '来源链接：' : 'Source: ') + event.source_url : '',
    ].filter(Boolean).join('\n\n');
    return {
      date: event.published_at || event.created_at || new Date(0).toISOString(),
      markup: [
      '    <item>',
      '      <title>' + escapeXml(title) + '</title>',
      '      <description>' + escapeXml(description) + '</description>',
      '      <link>' + escapeXml(eventUrl) + '</link>',
      '      <guid isPermaLink="true">' + escapeXml(eventUrl) + '</guid>',
      '      <pubDate>' + rssDate(event.published_at || event.created_at) + '</pubDate>',
      '      <category>' + escapeXml(getCategoryLabel(event.category, lang)) + '</category>',
      '    </item>',
      ].join('\n'),
    };
  });

  const feedItems = [...eventItems];
  if (manualReset) {
    const manualTitle = lang === 'zh' ? '服务器报告：额度已重置' : 'Server report: usage reset';
    const manualDescription = [
      lang === 'zh'
        ? '服务器报告额度已重置。 ' + formatManualResetTime(manualReset.resetAt, lang)
        : 'Server reported a usage reset. ' + formatManualResetTime(manualReset.resetAt, lang),
      lang === 'zh' ? '系统自动报告。' : 'Automated report.',
      manualReset.note ? (lang === 'zh' ? '备注：' : 'Note: ') + manualReset.note : '',
    ].filter(Boolean).join('\n\n');
    const homepageUrl = SITE_URL + (lang === 'zh' ? '/zh/' : '/');
    feedItems.push({
      date: manualReset.resetAt,
      markup: [
        '    <item>',
        '      <title>' + escapeXml(manualTitle) + '</title>',
        '      <description>' + escapeXml(manualDescription) + '</description>',
        '      <link>' + escapeXml(homepageUrl) + '</link>',
        '      <guid isPermaLink="false">system-reset-report:' + manualReset.id + '</guid>',
        '      <pubDate>' + rssDate(manualReset.resetAt) + '</pubDate>',
        '      <category>' + escapeXml(lang === 'zh' ? '服务器报告' : 'Server report') + '</category>',
        '    </item>',
      ].join('\n'),
    });
  }
  feedItems.sort((left, right) => {
    const leftTime = parseStoredUtc(left.date)?.getTime() ?? Number.NaN;
    const rightTime = parseStoredUtc(right.date)?.getTime() ?? Number.NaN;
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
  const items = feedItems.slice(0, 20).map(item => item.markup);
  const latestDate = feedItems[0]?.date;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>' + escapeXml(channelTitle) + '</title>',
    '    <link>' + SITE_URL + (lang === 'zh' ? '/zh/' : '/') + '</link>',
    '    <description>' + escapeXml(channelDescription) + '</description>',
    '    <language>' + (lang === 'zh' ? 'zh-CN' : 'en') + '</language>',
    '    <lastBuildDate>' + rssDate(latestDate || new Date().toISOString()) + '</lastBuildDate>',
    '    <atom:link href="' + SITE_URL + '/feed.xml" rel="self" type="application/rss+xml" />',
    items.join('\n'),
    '  </channel>',
    '</rss>',
  ].join('\n');
}

// ── Sitemap XML ──

export interface SitemapLandingPage {
  page: LandingPageKey;
  indexable: boolean;
  lastmod?: string | null;
}

export function renderSitemap(events: MonitorEvent[], lastmod: string | null, landingPages: SitemapLandingPage[] = []): string {
  const urls: string[] = [];
  const normalizedLastmod = normalizeSitemapDate(lastmod);

  // Homepage
  urls.push([
    '  <url>',
    '    <loc>' + SITE_URL + '/</loc>',
    sitemapLastmodMarkup(normalizedLastmod),
    '    <changefreq>hourly</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
  ].join('\n'));

  // /zh/
  urls.push([
    '  <url>',
    '    <loc>' + SITE_URL + '/zh/</loc>',
    sitemapLastmodMarkup(normalizedLastmod),
    '    <changefreq>hourly</changefreq>',
    '    <priority>0.9</priority>',
    '  </url>',
  ].join('\n'));

  // Core landing pages are included only when they are index-eligible. The
  // dynamic aggregations become noindex when their underlying category has no
  // real events; FAQ and methodology remain indexable because they contain
  // their own substantive content.
  for (const landing of landingPages) {
    if (!landing.indexable) continue;
    const landingLastmod = normalizeSitemapDate(landing.lastmod || lastmod);
    urls.push([
      '  <url>',
      '    <loc>' + getLandingUrl(landing.page, 'en') + '</loc>',
      sitemapLastmodMarkup(landingLastmod),
      '    <changefreq>daily</changefreq>',
      '    <priority>0.8</priority>',
      '  </url>',
      '  <url>',
      '    <loc>' + getLandingUrl(landing.page, 'zh') + '</loc>',
      sitemapLastmodMarkup(landingLastmod),
      '    <changefreq>daily</changefreq>',
      '    <priority>0.8</priority>',
      '  </url>',
    ].join('\n'));
  }

  // Event pages
  for (const event of events) {
    if (!event.id || !isEventIndexEligible(event)) continue;
    const eventUpdated = normalizeSitemapDate(event.updated_at || event.created_at || lastmod);
    urls.push([
      '  <url>',
      '    <loc>' + SITE_URL + '/events/' + event.id + '</loc>',
      sitemapLastmodMarkup(eventUpdated),
      '    <changefreq>daily</changefreq>',
      '    <priority>0.8</priority>',
      '  </url>',
    ].join('\n'));

    // Chinese event pages
    urls.push([
      '  <url>',
      '    <loc>' + SITE_URL + '/zh/events/' + event.id + '</loc>',
      sitemapLastmodMarkup(eventUpdated),
      '    <changefreq>daily</changefreq>',
      '    <priority>0.7</priority>',
      '  </url>',
    ].join('\n'));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls.join('\n'),
    '</urlset>',
  ].join('\n');
}

function sitemapLastmodMarkup(value: string | null): string {
  return value ? '    <lastmod>' + value + '</lastmod>' : '';
}

function normalizeSitemapDate(value: string | null | undefined): string | null {
  const source = value?.trim() || '';
  if (!source) return null;
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)
    ? source.replace(' ', 'T') + 'Z'
    : source;
  const parsed = new Date(sqliteUtc);
  return Number.isNaN(parsed.getTime()) ? source.slice(0, 10) : parsed.toISOString();
}
