import { SITE_HTML_LANG, localePath, type SiteLocale } from '../i18n';
import {
  AI_DISCLOSURE_PATHS,
  MODELYARD_BRAND,
  OPEN_GAMBIT_PATHS,
  PRIMARY_NAV_LABELS,
  renderSharedFooter,
  renderSharedHeader,
} from '../site-shell';
import {
  AI_OPERATION_DISCLOSURE_EN,
  AI_OPERATION_DISCLOSURE_ES,
  AI_OPERATION_DISCLOSURE_FR,
  AI_OPERATION_DISCLOSURE_JA,
  AI_OPERATION_DISCLOSURE_ZH,
} from './disclosure';
import type { GambitPublicArticle, GambitTranslation, GambitTrajectory } from './types';
import { formatDateShortForLocale } from '../utils/timezone';

export const OPEN_GAMBIT_SITE_URL = 'https://tibo.modelyard.dev';

type GambitCopy = {
  heading: string;
  description: string;
  eyebrow: string;
  sequence: string;
  latest: string;
  analysis: string;
  empty: string;
  home: string;
  facts: string;
  obviousLogic: string;
  thesis: string;
  follow: string;
  countercase: string;
  changeMind: string;
  forecast: string;
  targetDeadline: string;
  why: string;
  confirm: string;
  weaken: string;
  resolution: string;
  sources: string;
  resolutionHistory: string;
  noTrajectory: string;
  estimate: string;
  viewAll: string;
  aiDisclosureTitle: string;
  disclosureSection: string;
  disclosureText: string;
};

const OPEN_GAMBIT_COPY: Record<SiteLocale, GambitCopy> = {
  en: {
    heading: 'Open Gambit',
    description: 'From public facts, Open Gambit analyzes the visible moves in AI companies, models, APIs, protocols, developer ecosystems and product competition.',
    eyebrow: 'AI strategy analysis',
    sequence: 'Facts → Gambit → Trajectory → Verification.',
    latest: 'Latest analysis',
    analysis: 'ANALYSIS',
    empty: 'No published Open Gambit analyses yet.',
    home: 'Home',
    facts: 'What happened',
    obviousLogic: 'The obvious logic',
    thesis: 'The Gambit',
    follow: 'Why others may still follow',
    countercase: 'Countercase',
    changeMind: 'What would change our mind',
    forecast: 'AI Trajectory',
    targetDeadline: 'Target and deadline',
    why: 'Why',
    confirm: 'What would confirm it',
    weaken: 'What would weaken it',
    resolution: 'Resolution status',
    sources: 'Sources',
    resolutionHistory: 'Resolution history',
    noTrajectory: 'NO_TRAJECTORY_ISSUED: no responsibly resolvable forecast was issued.',
    estimate: 'AI estimate',
    viewAll: 'View all',
    aiDisclosureTitle: 'ModelYard AI',
    disclosureSection: 'Open Gambit',
    disclosureText: 'Sourced facts, strategic analysis and AI forecasts are labelled separately. Original forecasts are retained for later verification.',
  },
  zh: {
    heading: '阳谋',
    description: '从公开事实出发，分析 AI 公司、模型、API、协议、开发者生态与产品竞争中摆在桌面上的棋。',
    eyebrow: 'Open Gambit · AI 行业战略分析',
    sequence: '事实 → 阳谋 → 走势 → 验证。',
    latest: '最新分析',
    analysis: '分析',
    empty: '暂无已发布的阳谋。',
    home: '首页',
    facts: '发生了什么',
    obviousLogic: '明显逻辑',
    thesis: '阳谋',
    follow: '为什么其他参与者可能跟进',
    countercase: '反方观点',
    changeMind: '什么会改变我们的看法',
    forecast: 'AI 走势',
    targetDeadline: '目标与期限',
    why: '为什么',
    confirm: '如何确认',
    weaken: '如何削弱',
    resolution: '当前状态',
    sources: '来源',
    resolutionHistory: '验证与更正历史',
    noTrajectory: 'NO_TRAJECTORY_ISSUED：没有发布负责任的走势预测。',
    estimate: 'AI 估计',
    viewAll: '查看全部',
    aiDisclosureTitle: 'ModelYard AI 说明',
    disclosureSection: '阳谋',
    disclosureText: '来源事实、战略分析和 AI 走势预测会分别标注。预测会保留原始版本，以便后续验证。',
  },
  ja: {
    heading: 'Open Gambit',
    description: '公開情報を起点に、AI 企業、モデル、API、プロトコル、開発者エコシステム、製品競争で表に出ている動きを分析します。',
    eyebrow: 'AI 戦略分析',
    sequence: '事実 → ガンビット → 予測 → 検証。',
    latest: '最新の分析',
    analysis: '分析',
    empty: '公開された Open Gambit の分析はまだありません。',
    home: 'ホーム',
    facts: '何が起きたか',
    obviousLogic: '明らかな論理',
    thesis: 'ガンビット',
    follow: '他の参加者も追随する理由',
    countercase: '反対の見方',
    changeMind: '見方を変える条件',
    forecast: 'AI 予測',
    targetDeadline: '対象と期限',
    why: '理由',
    confirm: '確認できる兆候',
    weaken: '弱める兆候',
    resolution: '検証状況',
    sources: '出典',
    resolutionHistory: '検証と訂正の履歴',
    noTrajectory: 'NO_TRAJECTORY_ISSUED：責任を持って検証できる予測は発行されませんでした。',
    estimate: 'AI 推定',
    viewAll: 'すべて見る',
    aiDisclosureTitle: 'ModelYard AI',
    disclosureSection: 'Open Gambit',
    disclosureText: '出典のある事実、戦略分析、AI 予測を分けて表示します。予測の原文は後日の検証のために保存します。',
  },
  fr: {
    heading: 'Open Gambit',
    description: 'À partir de faits publics, Open Gambit analyse les mouvements visibles des entreprises, modèles, API, protocoles, écosystèmes de développeurs et produits d’IA.',
    eyebrow: 'Analyse stratégique de l’IA',
    sequence: 'Faits → Gambit → Trajectoire → Vérification.',
    latest: 'Dernières analyses',
    analysis: 'ANALYSE',
    empty: 'Aucune analyse Open Gambit publiée pour le moment.',
    home: 'Accueil',
    facts: 'Ce qui s’est passé',
    obviousLogic: 'La logique apparente',
    thesis: 'Le gambit',
    follow: 'Pourquoi les autres peuvent suivre',
    countercase: 'Point de vue contraire',
    changeMind: 'Ce qui changerait notre analyse',
    forecast: 'Prévision IA',
    targetDeadline: 'Cible et échéance',
    why: 'Pourquoi',
    confirm: 'Ce qui la confirmerait',
    weaken: 'Ce qui l’affaiblirait',
    resolution: 'État de vérification',
    sources: 'Sources',
    resolutionHistory: 'Historique des vérifications et corrections',
    noTrajectory: 'NO_TRAJECTORY_ISSUED : aucune prévision pouvant être vérifiée de façon responsable n’a été publiée.',
    estimate: 'Estimation IA',
    viewAll: 'Tout voir',
    aiDisclosureTitle: 'ModelYard IA',
    disclosureSection: 'Open Gambit',
    disclosureText: 'Les faits sourcés, l’analyse stratégique et les prévisions IA sont signalés séparément. Les prévisions originales sont conservées pour une vérification ultérieure.',
  },
  es: {
    heading: 'Open Gambit',
    description: 'A partir de hechos públicos, Open Gambit analiza los movimientos visibles de empresas, modelos, API, protocolos, ecosistemas de desarrolladores y productos de IA.',
    eyebrow: 'Análisis estratégico de IA',
    sequence: 'Hechos → Gambit → Trayectoria → Verificación.',
    latest: 'Últimos análisis',
    analysis: 'ANÁLISIS',
    empty: 'Todavía no hay análisis de Open Gambit publicados.',
    home: 'Inicio',
    facts: 'Qué ha ocurrido',
    obviousLogic: 'La lógica evidente',
    thesis: 'El gambito',
    follow: 'Por qué otros pueden seguirlo',
    countercase: 'Argumento contrario',
    changeMind: 'Qué cambiaría nuestro análisis',
    forecast: 'Previsión de IA',
    targetDeadline: 'Objetivo y fecha límite',
    why: 'Por qué',
    confirm: 'Qué lo confirmaría',
    weaken: 'Qué lo debilitaría',
    resolution: 'Estado de resolución',
    sources: 'Fuentes',
    resolutionHistory: 'Historial de verificaciones y correcciones',
    noTrajectory: 'NO_TRAJECTORY_ISSUED: no se emitió una previsión que pudiera resolverse de forma responsable.',
    estimate: 'Estimación de IA',
    viewAll: 'Ver todo',
    aiDisclosureTitle: 'ModelYard IA',
    disclosureSection: 'Open Gambit',
    disclosureText: 'Los hechos con fuentes, el análisis estratégico y las previsiones de IA aparecen diferenciados. Las previsiones originales se conservan para verificarlas más adelante.',
  },
};

interface OpenGambitHeadOptions {
  lang: SiteLocale;
  title: string;
  description: string;
  canonical: string;
  alternatePaths: Record<SiteLocale, string>;
  type?: 'website' | 'article';
  publishedAt?: string | null;
  modifiedAt?: string | null;
  structuredData?: unknown;
}

export function renderOpenGambitLanding(articles: GambitPublicArticle[], lang: SiteLocale, siteUrl = OPEN_GAMBIT_SITE_URL): string {
  const baseUrl = normalizeSiteUrl(siteUrl);
  const copy = OPEN_GAMBIT_COPY[lang];
  const title = `${MODELYARD_BRAND} · ${copy.heading}`;
  const canonical = `${baseUrl}${OPEN_GAMBIT_PATHS[lang]}`;
  const cards = articles
    .filter(article => article.status === 'PUBLISHED' && !article.politicalTopic)
    .map(article => {
      const localized = localizedContent(article, lang);
      return [
        `<article class="gambit-card"${localized.fallback ? ' data-locale-fallback="en"' : ''}>`,
        `  <div class="gambit-card-kicker">${escapeHtml(copy.analysis)}</div>`,
        `  <h2><a href="${escapeHtml(articleUrl(article.slug, lang))}">${escapeHtml(localized.content.headline)}</a></h2>`,
        `  <p>${escapeHtml(localized.content.surfaceEvent)}</p>`,
        `  <div class="gambit-card-meta">${escapeHtml(formatDate(article.publishedAt || article.modifiedAt, lang))} · ${article.trajectories.length} ${escapeHtml(trajectoryLabel(article.trajectories.length, lang))}</div>`,
        '</article>',
      ].join('\n');
    })
    .join('\n');
  const empty = cards ? '' : `<p class="gambit-empty">${escapeHtml(copy.empty)}</p>`;
  const body = [
    '<body>',
    '  <div class="gambit-site">',
    renderSharedHeader(lang, { alternatePath: OPEN_GAMBIT_PATHS[lang] }),
    '    <main class="gambit-main" aria-labelledby="gambitTitle">',
    `      <p class="gambit-eyebrow">${escapeHtml(copy.eyebrow)}</p>`,
    `      <h1 id="gambitTitle">${escapeHtml(copy.heading)}</h1>`,
    `      <p class="gambit-lede">${escapeHtml(copy.sequence)}</p>`,
    `      <p class="gambit-lede">${escapeHtml(copy.description)}</p>`,
    '      <section class="gambit-list" aria-labelledby="latestGambitTitle">',
    `        <h2 id="latestGambitTitle">${escapeHtml(copy.latest)}</h2>`,
    cards || empty,
    '      </section>',
    '    </main>',
    renderSharedFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
  return renderOpenGambitHead({ lang, title, description: copy.description, canonical, alternatePaths: localizedLandingPaths(baseUrl), type: 'website' }) + body;
}

export function renderOpenGambitArticle(article: GambitPublicArticle, lang: SiteLocale, siteUrl = OPEN_GAMBIT_SITE_URL): string {
  const baseUrl = normalizeSiteUrl(siteUrl);
  const copy = OPEN_GAMBIT_COPY[lang];
  const localized = localizedContent(article, lang);
  const content = localized.content;
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
    inLanguage: SITE_HTML_LANG[lang],
    author: { '@type': 'Organization', name: MODELYARD_BRAND },
    publisher: { '@type': 'Organization', name: MODELYARD_BRAND },
    isBasedOn: article.evidence.map(evidence => ({ '@type': 'WebPage', url: evidence.canonicalUrl })),
  };
  const body = [
    '<body>',
    '  <div class="gambit-site">',
    renderSharedHeader(lang, { alternatePath: articleUrl(article.slug, lang) }),
    '    <main class="gambit-main gambit-article-main" aria-labelledby="articleTitle">',
    `      <nav class="gambit-breadcrumb"><a href="${escapeHtml(localePath('/', lang))}">${escapeHtml(copy.home)}</a> / <a href="${escapeHtml(OPEN_GAMBIT_PATHS[lang])}">${escapeHtml(PRIMARY_NAV_LABELS[lang].openGambit)}</a></nav>`,
    `      <h1 id="articleTitle">${escapeHtml(content.headline)}</h1>`,
    `      <div class="gambit-article-meta">${escapeHtml(formatDate(article.publishedAt || article.modifiedAt, lang))}</div>`,
    section('FACT', copy.facts, content.facts.map(fact => `<p>${escapeHtml(fact)}</p>`).join('\n')),
    section('ANALYSIS', copy.obviousLogic, `<p>${escapeHtml(content.obviousLogic)}</p>`),
    section('ANALYSIS', copy.thesis, `<p>${escapeHtml(content.thesis)}</p><p>${escapeHtml(content.mechanism)}</p>`),
    section('ANALYSIS', copy.follow, `<p>${escapeHtml([...content.beneficiaries, ...content.pressuredActors].join(' · '))}</p>`),
    section('ANALYSIS', copy.countercase, `<p>${escapeHtml(content.countercase)}</p>`),
    renderTrajectories(content.trajectories, lang),
    section('ANALYSIS', copy.changeMind, `<p>${escapeHtml(content.falsifier)}</p><p class="gambit-uncertainty">${escapeHtml(content.uncertainty)}</p>`),
    renderSources(article.evidence, lang),
    renderResolutionHistory(article, lang),
    '    </main>',
    renderSharedFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
  const markedBody = localized.fallback
    ? body.replace('<main class="gambit-main gambit-article-main"', '<main class="gambit-main gambit-article-main" data-locale-fallback="en"')
    : body;
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
  }) + markedBody;
}

export function renderAiDisclosurePage(lang: SiteLocale, siteUrl = OPEN_GAMBIT_SITE_URL): string {
  const baseUrl = normalizeSiteUrl(siteUrl);
  const copy = OPEN_GAMBIT_COPY[lang];
  const text = disclosureForLocale(lang);
  const title = copy.aiDisclosureTitle;
  const canonical = `${baseUrl}${AI_DISCLOSURE_PATHS[lang]}`;
  const body = [
    '<body>',
    '  <div class="gambit-site">',
    renderSharedHeader(lang, { alternatePath: AI_DISCLOSURE_PATHS[lang] }),
    '    <main class="gambit-main" aria-labelledby="aiDisclosureTitle">',
    `      <h1 id="aiDisclosureTitle">${escapeHtml(title)}</h1>`,
    `      <p class="gambit-lede">${escapeHtml(text)}</p>`,
    `      <section class="gambit-disclosure-full"><h2>${escapeHtml(copy.disclosureSection)}</h2><p>${escapeHtml(copy.disclosureText)}</p></section>`,
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

function localizedContent(article: GambitPublicArticle, lang: SiteLocale): { content: GambitTranslation | GambitPublicArticle; fallback: boolean } {
  const translation = article.translations[lang];
  if (translation?.status === 'TRANSLATED'
    && (!translation.translationState || translation.translationState === 'TRANSLATION_READY')) {
    return { content: translation, fallback: false };
  }
  if (lang === 'en') return { content: article, fallback: false };
  return { content: article, fallback: true };
}

function disclosureForLocale(lang: SiteLocale): string {
  return {
    en: AI_OPERATION_DISCLOSURE_EN,
    zh: AI_OPERATION_DISCLOSURE_ZH,
    ja: AI_OPERATION_DISCLOSURE_JA,
    fr: AI_OPERATION_DISCLOSURE_FR,
    es: AI_OPERATION_DISCLOSURE_ES,
  }[lang];
}

function trajectoryLabel(count: number, lang: SiteLocale): string {
  if (lang === 'zh') return '条走势';
  if (lang === 'ja') return '件の予測';
  if (lang === 'fr') return count === 1 ? 'trajectoire' : 'trajectoires';
  if (lang === 'es') return count === 1 ? 'trayectoria' : 'trayectorias';
  return count === 1 ? 'trajectory' : 'trajectories';
}

function renderTrajectories(trajectories: GambitTrajectory[], lang: SiteLocale): string {
  const copy = OPEN_GAMBIT_COPY[lang];
  if (trajectories.length === 0) return section('AI FORECAST', copy.forecast, `<p>${escapeHtml(copy.noTrajectory)}</p>`);
  const cards = trajectories.map(trajectory => [
    '<article class="gambit-trajectory-card">',
    `  <div class="gambit-probability">${escapeHtml(copy.estimate)} · ~${escapeHtml(String(trajectory.probability))}%</div>`,
    `  <h3>${escapeHtml(trajectory.predictionStatement)}</h3>`,
    `  <dl><div><dt>${escapeHtml(copy.targetDeadline)}</dt><dd>${escapeHtml(trajectory.targetEntity)} · ${escapeHtml(trajectory.deadline)}</dd></div>`,
    `  <div><dt>${escapeHtml(copy.why)}</dt><dd>${escapeHtml(trajectory.reasoning)}</dd></div>`,
    `  <div><dt>${escapeHtml(copy.confirm)}</dt><dd>${escapeHtml(trajectory.evidenceCriteria)}</dd></div>`,
    `  <div><dt>${escapeHtml(copy.weaken)}</dt><dd>${escapeHtml(trajectory.falsifier)}</dd></div>`,
    `  <div><dt>${escapeHtml(copy.resolution)}</dt><dd>${escapeHtml(trajectory.status)}</dd></div></dl>`,
    '</article>',
  ].join('\n')).join('\n');
  return section('AI FORECAST', copy.forecast, `<div class="gambit-trajectories">${cards}</div>`);
}

function renderSources(evidence: GambitPublicArticle['evidence'], lang: SiteLocale): string {
  const items = evidence.map(item => `<li><a href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || item.canonicalUrl)}</a><span>${escapeHtml(item.sourceTier)} · ${escapeHtml(item.publisher || '')}</span></li>`).join('');
  return `<section class="gambit-section gambit-section-sources"><p class="gambit-label">FACT</p><h2>${escapeHtml(OPEN_GAMBIT_COPY[lang].sources)}</h2><ol>${items}</ol></section>`;
}

function renderResolutionHistory(article: GambitPublicArticle, lang: SiteLocale): string {
  const events = (article.resolutionHistory ?? []).filter(item => !['WATCHING', 'DUE'].includes(item.state));
  const corrections = article.corrections ?? [];
  if (events.length === 0 && corrections.length === 0) return '';
  const items = [
    ...events.map(item => `<li><strong>${escapeHtml(item.state)}</strong> · ${escapeHtml(formatDate(item.createdAt, lang))} — ${escapeHtml(item.explanation)}</li>`),
    ...corrections.map(item => `<li><strong>${escapeHtml(item.correctionType)}</strong> · ${escapeHtml(formatDate(item.createdAt, lang))} — ${escapeHtml(item.explanation)}</li>`),
  ].join('');
  return `<section class="gambit-section gambit-resolution-history"><p class="gambit-label">FACT</p><h2>${escapeHtml(OPEN_GAMBIT_COPY[lang].resolutionHistory)}</h2><ol>${items}</ol></section>`;
}

function section(label: string, title: string, content: string): string {
  return `<section class="gambit-section gambit-section-${label.toLowerCase().replace(/\s+/gu, '-')}" data-content-type="${escapeHtml(label)}"><p class="gambit-label gambit-label-${label.toLowerCase().replace(/\s+/gu, '-')}">${escapeHtml(label)}</p><h2>${escapeHtml(title)}</h2>${content}</section>`;
}

function renderOpenGambitHead(options: OpenGambitHeadOptions): string {
  const langAttr = SITE_HTML_LANG[options.lang];
  const locale = options.lang === 'en' ? 'en_US' : options.lang === 'zh' ? 'zh_CN' : options.lang === 'ja' ? 'ja_JP' : options.lang === 'fr' ? 'fr_FR' : 'es_ES';
  const jsonLd = options.structuredData ? `<script type="application/ld+json">${safeJson(options.structuredData)}</script>` : '';
  const alternate = Object.entries(options.alternatePaths).map(([localeKey, path]) => `<link rel="alternate" hreflang="${localeKey === 'zh' ? 'zh-CN' : localeKey}" href="${escapeHtml(path)}">`).join('\n');
  return [
    '<!DOCTYPE html>',
    `<html lang="${escapeHtml(langAttr)}"><head>`,
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<meta name="description" content="${escapeHtml(options.description.slice(0, 300))}">`,
    `<link rel="canonical" href="${escapeHtml(options.canonical)}">`,
    '<meta name="robots" content="index, follow">',
    `<meta property="og:type" content="${options.type || 'website'}"><meta property="og:title" content="${escapeHtml(options.title)}"><meta property="og:description" content="${escapeHtml(options.description.slice(0, 300))}"><meta property="og:url" content="${escapeHtml(options.canonical)}"><meta property="og:site_name" content="${MODELYARD_BRAND}"><meta property="og:locale" content="${locale}">`,
    `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(options.title)}"><meta name="twitter:description" content="${escapeHtml(options.description.slice(0, 300))}">`,
    options.publishedAt ? `<meta property="article:published_time" content="${escapeHtml(options.publishedAt)}">` : '',
    options.modifiedAt ? `<meta property="article:modified_time" content="${escapeHtml(options.modifiedAt)}">` : '',
    alternate,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(options.alternatePaths.en)}">`,
    jsonLd,
    '<link rel="stylesheet" href="/style.css"><link rel="icon" href="/favicon.svg">',
    '</head>',
  ].join('\n');
}

function localizedLandingPaths(siteUrl: string): Record<SiteLocale, string> {
  return Object.fromEntries(Object.entries(OPEN_GAMBIT_PATHS).map(([locale, path]) => [locale, `${siteUrl}${path}`])) as Record<SiteLocale, string>;
}

function localizedArticlePaths(slug: string, siteUrl: string): Record<SiteLocale, string> {
  return Object.fromEntries(Object.keys(OPEN_GAMBIT_PATHS).map(locale => [locale, `${siteUrl}${articleUrl(slug, locale as SiteLocale)}`])) as Record<SiteLocale, string>;
}

function localizedDisclosurePaths(siteUrl: string): Record<SiteLocale, string> {
  return Object.fromEntries(Object.entries(AI_DISCLOSURE_PATHS).map(([locale, path]) => [locale, `${siteUrl}${path}`])) as Record<SiteLocale, string>;
}

function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/u, '') || OPEN_GAMBIT_SITE_URL;
}

function articleUrl(slug: string, lang: SiteLocale): string {
  return localePath(`/open-gambit/${encodeURIComponent(slug)}/`, lang);
}

function formatDate(value: string | null | undefined, lang: SiteLocale): string {
  if (!value) return lang === 'zh' ? '日期未知' : lang === 'ja' ? '日付不明' : lang === 'fr' ? 'Date inconnue' : lang === 'es' ? 'Fecha desconocida' : 'Date unknown';
  return formatDateShortForLocale(value, lang) || value;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e').replace(/&/gu, '\\u0026');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}
