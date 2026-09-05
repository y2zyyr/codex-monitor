import { SITE_HTML_LANG, type SiteLocale } from '../i18n';
import { MODELYARD_BRAND, PRIMARY_NAV_LABELS, renderSharedFooter, renderSharedHeader } from '../site-shell';
import {
  AI_OPERATION_DISCLOSURE_EN,
  AI_OPERATION_DISCLOSURE_ZH,
} from './disclosure';
import type { GambitPublicArticle, GambitTranslation, GambitTrajectory } from './types';

export const OPEN_GAMBIT_SITE_URL = 'https://tibo.modelyard.dev';

interface OpenGambitHeadOptions {
  lang: SiteLocale;
  title: string;
  description: string;
  canonical: string;
  alternatePaths: Partial<Record<SiteLocale, string>>;
  type?: 'website' | 'article';
  publishedAt?: string | null;
  modifiedAt?: string | null;
  structuredData?: unknown;
}

export function renderOpenGambitLanding(articles: GambitPublicArticle[], lang: 'en' | 'zh', siteUrl = OPEN_GAMBIT_SITE_URL): string {
  const baseUrl = normalizeSiteUrl(siteUrl);
  const isZh = lang === 'zh';
  const heading = isZh ? '阳谋' : 'Open Gambit';
  const title = `${MODELYARD_BRAND} · ${heading}`;
  const description = isZh
    ? '从公开事实出发，分析 AI 公司、模型、API、协议、开发者生态与产品竞争中摆在桌面上的棋。'
    : 'From public facts, Open Gambit analyzes the visible moves in AI companies, models, APIs, protocols, developer ecosystems and product competition.';
  const canonical = `${baseUrl}${isZh ? '/zh/open-gambit/' : '/open-gambit/'}`;
  const cards = articles.filter(article => article.status === 'PUBLISHED' && !article.politicalTopic).map(article => {
    const content = localizedContent(article, lang);
    return [
      '<article class="gambit-card">',
      `  <div class="gambit-card-kicker">${isZh ? '分析' : 'ANALYSIS'}</div>`,
      `  <h2><a href="${escapeHtml(articleUrl(article.slug, lang))}">${escapeHtml(content.headline)}</a></h2>`,
      `  <p>${escapeHtml(content.surfaceEvent)}</p>`,
      `  <div class="gambit-card-meta">${escapeHtml(formatDate(article.publishedAt || article.modifiedAt, lang))} · ${article.trajectories.length} ${isZh ? '条走势' : article.trajectories.length === 1 ? 'trajectory' : 'trajectories'}</div>`,
      '</article>',
    ].join('\n');
  }).join('\n');
  const empty = cards ? '' : `<p class="gambit-empty">${isZh ? '暂无已发布的阳谋。' : 'No published Open Gambit analyses yet.'}</p>`;
  const body = [
    '<body>',
    '  <div class="gambit-site">',
    renderSharedHeader(lang, { alternatePath: isZh ? '/zh/open-gambit/' : '/open-gambit/' }),
    '    <main class="gambit-main" aria-labelledby="gambitTitle">',
    `      <p class="gambit-eyebrow">${isZh ? 'Open Gambit · AI 行业战略分析' : 'AI strategy analysis'}</p>`,
    `      <h1 id="gambitTitle">${escapeHtml(heading)}</h1>`,
    `      <p class="gambit-lede">${escapeHtml(isZh ? '事实 → 阳谋 → 走势 → 验证。' : 'Facts → Gambit → Trajectory → Verification.')}</p>`,
    `      <p class="gambit-lede">${escapeHtml(description)}</p>`,
    '      <section class="gambit-list" aria-labelledby="latestGambitTitle">',
    `        <h2 id="latestGambitTitle">${isZh ? '最新分析' : 'Latest analysis'}</h2>`,
    cards || empty,
    '      </section>',
    '    </main>',
    renderSharedFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
  return renderOpenGambitHead({ lang, title, description, canonical, alternatePaths: localizedLandingPaths(baseUrl), type: 'website' }) + body;
}

export function renderOpenGambitArticle(article: GambitPublicArticle, lang: 'en' | 'zh', siteUrl = OPEN_GAMBIT_SITE_URL): string {
  const baseUrl = normalizeSiteUrl(siteUrl);
  const isZh = lang === 'zh';
  const content = localizedContent(article, lang);
  const canonical = `${baseUrl}${articleUrl(article.slug, lang)}`;
  const pageTitle = `${content.headline} · ${MODELYARD_BRAND} · ${PRIMARY_NAV_LABELS[lang].openGambit}`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: content.headline,
    description: content.surfaceEvent,
    datePublished: article.publishedAt,
    dateModified: article.modifiedAt,
    mainEntityOfPage: canonical,
    author: { '@type': 'Organization', name: MODELYARD_BRAND },
    publisher: { '@type': 'Organization', name: MODELYARD_BRAND },
    isBasedOn: article.evidence.map(evidence => ({ '@type': 'WebPage', url: evidence.canonicalUrl })),
  };
  const body = [
    '<body>',
    '  <div class="gambit-site">',
    renderSharedHeader(lang, { alternatePath: `${isZh ? '/zh' : ''}${articleUrl(article.slug, 'en')}` }),
    '    <main class="gambit-main gambit-article-main" aria-labelledby="articleTitle">',
    `      <nav class="gambit-breadcrumb"><a href="${escapeHtml(lang === 'zh' ? '/zh/' : '/')}">${isZh ? '首页' : 'Home'}</a> / <a href="${escapeHtml(lang === 'zh' ? '/zh/open-gambit/' : '/open-gambit/')}">${escapeHtml(PRIMARY_NAV_LABELS[lang].openGambit)}</a></nav>`,
    `      <h1 id="articleTitle">${escapeHtml(content.headline)}</h1>`,
    `      <div class="gambit-article-meta">${escapeHtml(formatDate(article.publishedAt || article.modifiedAt, lang))}</div>`,
    section('FACT', isZh ? '发生了什么' : 'What happened', content.facts.map(fact => `<p>${escapeHtml(fact)}</p>`).join('\n')),
    section('ANALYSIS', isZh ? '明显逻辑' : 'The obvious logic', `<p>${escapeHtml(content.obviousLogic)}</p>`),
    section('ANALYSIS', isZh ? '阳谋' : 'The Gambit', `<p>${escapeHtml(content.thesis)}</p><p>${escapeHtml(content.mechanism)}</p>`),
    section('ANALYSIS', isZh ? '为什么其他参与者可能跟进' : 'Why others may still follow', `<p>${escapeHtml([...content.beneficiaries, ...content.pressuredActors].join(' · '))}</p>`),
    section('ANALYSIS', isZh ? '反方观点' : 'Countercase', `<p>${escapeHtml(content.countercase)}</p>`),
    renderTrajectories(content.trajectories, lang),
    section('ANALYSIS', isZh ? '什么会改变我们的看法' : 'What would change our mind', `<p>${escapeHtml(content.falsifier)}</p><p class="gambit-uncertainty">${escapeHtml(content.uncertainty)}</p>`),
    renderSources(article.evidence, lang),
    renderResolutionHistory(article, lang),
    '    </main>',
    renderSharedFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
  return renderOpenGambitHead({
    lang,
    title: pageTitle,
    description: content.surfaceEvent,
    canonical,
    alternatePaths: localizedArticlePaths(article.slug, baseUrl),
    type: 'article',
    publishedAt: article.publishedAt,
    modifiedAt: article.modifiedAt,
    structuredData: schema,
  }) + body;
}

export function renderAiDisclosurePage(lang: 'en' | 'zh', siteUrl = OPEN_GAMBIT_SITE_URL): string {
  const baseUrl = normalizeSiteUrl(siteUrl);
  const isZh = lang === 'zh';
  const title = isZh ? 'ModelYard AI 说明' : 'ModelYard AI';
  const text = isZh ? AI_OPERATION_DISCLOSURE_ZH : AI_OPERATION_DISCLOSURE_EN;
  const canonical = `${baseUrl}${isZh ? '/zh/about/ai/' : '/about/ai/'}`;
  const body = [
    '<body>',
    '  <div class="gambit-site">',
    renderSharedHeader(lang, { alternatePath: isZh ? '/zh/about/ai/' : '/about/ai/' }),
    '    <main class="gambit-main" aria-labelledby="aiDisclosureTitle">',
    `      <h1 id="aiDisclosureTitle">${escapeHtml(title)}</h1>`,
    `      <p class="gambit-lede">${escapeHtml(text)}</p>`,
    `      <section class="gambit-disclosure-full"><h2>${isZh ? '阳谋' : 'Open Gambit'}</h2><p>${escapeHtml(isZh ? '来源事实、战略分析和 AI 走势预测会分别标注。预测会保留原始版本，以便后续验证。' : 'Sourced facts, strategic analysis and AI forecasts are labelled separately. Original forecasts are retained for later verification.')}</p></section>`,
    '    </main>',
    renderSharedFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
  return renderOpenGambitHead({ lang, title, description: text, canonical, alternatePaths: localizedDisclosurePaths(baseUrl), type: 'website' }) + body;
}

export function renderOpenGambitAdminPage(): string {
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Open Gambit Review</title><meta name="robots" content="noindex, nofollow"><link rel="stylesheet" href="/style.css"></head>',
    '<body><main class="gambit-main gambit-admin-main"><h1>Open Gambit Review</h1><p>Authenticated exception console for ambiguous candidates, corrections and manual intervention. Drafts are immutable revisions; approving a stale revision requires explicit acknowledgement.</p><p class="gambit-admin-status" id="gambitAdminStatus" role="status"></p><section id="gambitReviewQueue" class="gambit-review-queue"></section></main><script src="/open-gambit-admin.js" defer></script></body></html>',
  ].join('');
}

function localizedContent(article: GambitPublicArticle, lang: 'en' | 'zh'): GambitTranslation | GambitPublicArticle {
  if (lang === 'zh' && article.translations.zh?.status === 'TRANSLATED') return article.translations.zh;
  return article;
}

function renderTrajectories(trajectories: GambitTrajectory[], lang: 'en' | 'zh'): string {
  const isZh = lang === 'zh';
  if (trajectories.length === 0) return section('AI FORECAST', isZh ? 'AI 走势' : 'AI Trajectory', `<p>${isZh ? 'NO_TRAJECTORY_ISSUED：没有发布负责任的走势预测。' : 'NO_TRAJECTORY_ISSUED: no responsibly resolvable forecast was issued.'}</p>`);
  const cards = trajectories.map(trajectory => [
    '<article class="gambit-trajectory-card">',
    `  <div class="gambit-probability">AI estimate · ~${escapeHtml(String(trajectory.probability))}%</div>`,
    `  <h3>${escapeHtml(trajectory.predictionStatement)}</h3>`,
    `  <dl><div><dt>${isZh ? '目标与期限' : 'Target and deadline'}</dt><dd>${escapeHtml(trajectory.targetEntity)} · ${escapeHtml(trajectory.deadline)}</dd></div>`,
    `  <div><dt>${isZh ? '为什么' : 'Why'}</dt><dd>${escapeHtml(trajectory.reasoning)}</dd></div>`,
    `  <div><dt>${isZh ? '如何确认' : 'What would confirm it'}</dt><dd>${escapeHtml(trajectory.evidenceCriteria)}</dd></div>`,
    `  <div><dt>${isZh ? '如何削弱' : 'What would weaken it'}</dt><dd>${escapeHtml(trajectory.falsifier)}</dd></div>`,
    `  <div><dt>${isZh ? '当前状态' : 'Resolution status'}</dt><dd>${escapeHtml(trajectory.status)}</dd></div></dl>`,
    '</article>',
  ].join('\n')).join('\n');
  return section('AI FORECAST', isZh ? 'AI 走势' : 'AI Trajectory', `<div class="gambit-trajectories">${cards}</div>`);
}

function renderSources(evidence: GambitPublicArticle['evidence'], lang: 'en' | 'zh'): string {
  const title = lang === 'zh' ? '来源' : 'Sources';
  const items = evidence.map(item => `<li><a href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || item.canonicalUrl)}</a><span>${escapeHtml(item.sourceTier)} · ${escapeHtml(item.publisher || '')}</span></li>`).join('');
  return `<section class="gambit-section gambit-section-sources"><p class="gambit-label">FACT</p><h2>${title}</h2><ol>${items}</ol></section>`;
}

function renderResolutionHistory(article: GambitPublicArticle, lang: 'en' | 'zh'): string {
  const events = (article.resolutionHistory ?? []).filter(item => !['WATCHING', 'DUE'].includes(item.state));
  const corrections = article.corrections ?? [];
  if (events.length === 0 && corrections.length === 0) return '';
  const items = [
    ...events.map(item => `<li><strong>${escapeHtml(item.state)}</strong> · ${escapeHtml(formatDate(item.createdAt, lang))} — ${escapeHtml(item.explanation)}</li>`),
    ...corrections.map(item => `<li><strong>${escapeHtml(item.correctionType)}</strong> · ${escapeHtml(formatDate(item.createdAt, lang))} — ${escapeHtml(item.explanation)}</li>`),
  ].join('');
  return `<section class="gambit-section gambit-resolution-history"><p class="gambit-label">FACT</p><h2>${lang === 'zh' ? '验证与更正历史' : 'Resolution history'}</h2><ol>${items}</ol></section>`;
}

function section(label: string, title: string, content: string): string {
  return `<section class="gambit-section"><p class="gambit-label gambit-label-${label.toLowerCase().replace(/\s+/gu, '-')}">${escapeHtml(label)}</p><h2>${escapeHtml(title)}</h2>${content}</section>`;
}

function renderOpenGambitHead(options: OpenGambitHeadOptions): string {
  const langAttr = SITE_HTML_LANG[options.lang];
  const jsonLd = options.structuredData ? `<script type="application/ld+json">${safeJson(options.structuredData)}</script>` : '';
  const alternate = Object.entries(options.alternatePaths).map(([locale, path]) => `<link rel="alternate" hreflang="${locale === 'zh' ? 'zh-CN' : locale}" href="${escapeHtml(path)}">`).join('\n');
  return [
    '<!DOCTYPE html>',
    `<html lang="${escapeHtml(langAttr)}"><head>`,
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<meta name="description" content="${escapeHtml(options.description.slice(0, 300))}">`,
    `<link rel="canonical" href="${escapeHtml(options.canonical)}">`,
    '<meta name="robots" content="index, follow">',
    `<meta property="og:type" content="${options.type || 'website'}"><meta property="og:title" content="${escapeHtml(options.title)}"><meta property="og:description" content="${escapeHtml(options.description.slice(0, 300))}"><meta property="og:url" content="${escapeHtml(options.canonical)}"><meta property="og:site_name" content="${MODELYARD_BRAND}">`,
    options.publishedAt ? `<meta property="article:published_time" content="${escapeHtml(options.publishedAt)}">` : '',
    options.modifiedAt ? `<meta property="article:modified_time" content="${escapeHtml(options.modifiedAt)}">` : '',
    alternate,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(options.alternatePaths.en || options.canonical)}">`,
    jsonLd,
    '<link rel="stylesheet" href="/style.css"><link rel="icon" href="/favicon.svg">',
    '</head>',
  ].join('\n');
}

function localizedLandingPaths(siteUrl: string): Partial<Record<SiteLocale, string>> {
  return { en: `${siteUrl}/open-gambit/`, zh: `${siteUrl}/zh/open-gambit/` };
}

function localizedArticlePaths(slug: string, siteUrl: string): Partial<Record<SiteLocale, string>> {
  return { en: `${siteUrl}/open-gambit/${encodeURIComponent(slug)}/`, zh: `${siteUrl}/zh/open-gambit/${encodeURIComponent(slug)}/` };
}

function localizedDisclosurePaths(siteUrl: string): Partial<Record<SiteLocale, string>> {
  return { en: `${siteUrl}/about/ai/`, zh: `${siteUrl}/zh/about/ai/` };
}

function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/u, '') || OPEN_GAMBIT_SITE_URL;
}

function articleUrl(slug: string, lang: 'en' | 'zh'): string {
  return `${lang === 'zh' ? '/zh' : ''}/open-gambit/${encodeURIComponent(slug)}/`;
}

function aiDisclosureUrl(lang: 'en' | 'zh'): string {
  return `${lang === 'zh' ? '/zh' : ''}/about/ai/`;
}

function formatDate(value: string | null | undefined, lang: 'en' | 'zh'): string {
  if (!value) return lang === 'zh' ? '日期未知' : 'Date unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeZone: lang === 'zh' ? 'Asia/Shanghai' : 'America/New_York' }).format(date);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e').replace(/&/gu, '\\u0026');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}
