import { SITE_LOCALES, SITE_LOCALE_LABELS, localePath, type SiteLocale } from './i18n';

export const MODELYARD_BRAND = 'ModelYard';

export const SITE_BRAND_COPY: Record<SiteLocale, {
  monitor: string;
  home: string;
  homeAria: string;
  monitoring: string;
  live: string;
  awaitingFirstRun: string;
  notConfigured: string;
  sourceNotConfigured: string;
  classifierNotConfigured: string;
  degraded: string;
  stale: string;
  unknown: string;
  footer: string;
  footerNavigation: string;
  rssTitle: string;
  helpfulNavigation: string;
  pageNotFoundTitle: string;
  pageNotFound: string;
  pageDoesNotExist: string;
}> = {
  en: {
    monitor: 'Tibo Codex Monitor',
    home: 'Home',
    homeAria: 'Go to homepage',
    monitoring: 'Monitoring',
    live: 'Monitor',
    awaitingFirstRun: 'Awaiting first run',
    notConfigured: 'Not configured',
    sourceNotConfigured: 'Source not configured',
    classifierNotConfigured: 'Classifier not configured',
    degraded: 'Degraded',
    stale: 'Stale',
    unknown: 'Unknown',
    footer: 'Independent monitor · Not affiliated with OpenAI.',
    footerNavigation: 'Footer navigation',
    rssTitle: 'ModelYard · Tibo Codex Monitor RSS',
    helpfulNavigation: 'Helpful navigation',
    pageNotFoundTitle: 'Page Not Found',
    pageNotFound: 'Page not found',
    pageDoesNotExist: 'The requested page does not exist.',
  },
  zh: {
    monitor: 'Tibo Codex 监控',
    home: '首页',
    homeAria: '返回首页',
    monitoring: '正在监控',
    live: '监控中',
    awaitingFirstRun: '等待首次运行',
    notConfigured: '尚未配置',
    sourceNotConfigured: '数据源未配置',
    classifierNotConfigured: '分类器未配置',
    degraded: '服务降级',
    stale: '数据过期',
    unknown: '未知',
    footer: '非官方监控站 · 与 OpenAI 无隶属关系。',
    footerNavigation: '页脚导航',
    rssTitle: 'ModelYard · Tibo Codex 监控 RSS',
    helpfulNavigation: '帮助导航',
    pageNotFoundTitle: '页面未找到',
    pageNotFound: '页面未找到',
    pageDoesNotExist: '请求的页面不存在。',
  },
  ja: {
    monitor: 'Tibo Codex Monitor',
    home: 'ホーム',
    homeAria: 'ホームページへ移動',
    monitoring: '監視中',
    live: 'モニター',
    awaitingFirstRun: '初回実行を待っています',
    notConfigured: '未設定',
    sourceNotConfigured: 'ソース未設定',
    classifierNotConfigured: '分類器未設定',
    degraded: '低下',
    stale: '古いデータ',
    unknown: '不明',
    footer: '非公式モニター · OpenAI とは提携していません。',
    footerNavigation: 'フッターナビゲーション',
    rssTitle: 'ModelYard · Tibo Codex Monitor RSS',
    helpfulNavigation: '便利なナビゲーション',
    pageNotFoundTitle: 'ページが見つかりません',
    pageNotFound: 'ページが見つかりません',
    pageDoesNotExist: '指定されたページは存在しません。',
  },
  es: {
    monitor: 'Monitor Tibo Codex',
    home: 'Inicio',
    homeAria: 'Ir a la página de inicio',
    monitoring: 'Supervisando',
    live: 'Monitor',
    awaitingFirstRun: 'Esperando la primera ejecución',
    notConfigured: 'No configurado',
    sourceNotConfigured: 'Fuente no configurada',
    classifierNotConfigured: 'Clasificador no configurado',
    degraded: 'Degradado',
    stale: 'Desactualizado',
    unknown: 'Desconocido',
    footer: 'Monitor independiente · No afiliado a OpenAI.',
    footerNavigation: 'Navegación del pie de página',
    rssTitle: 'ModelYard · Monitor Tibo Codex RSS',
    helpfulNavigation: 'Navegación útil',
    pageNotFoundTitle: 'Página no encontrada',
    pageNotFound: 'Página no encontrada',
    pageDoesNotExist: 'La página solicitada no existe.',
  },
  fr: {
    monitor: 'Tibo Codex Monitor',
    home: 'Accueil',
    homeAria: 'Aller à la page d’accueil',
    monitoring: 'Surveillance en cours',
    live: 'Moniteur',
    awaitingFirstRun: 'En attente de la première exécution',
    notConfigured: 'Non configuré',
    sourceNotConfigured: 'Source non configurée',
    classifierNotConfigured: 'Classificateur non configuré',
    degraded: 'Dégradé',
    stale: 'Obsolète',
    unknown: 'Inconnu',
    footer: 'Moniteur indépendant · Non affilié à OpenAI.',
    footerNavigation: 'Navigation du pied de page',
    rssTitle: 'ModelYard · Tibo Codex Monitor RSS',
    helpfulNavigation: 'Navigation utile',
    pageNotFoundTitle: 'Page introuvable',
    pageNotFound: 'Page introuvable',
    pageDoesNotExist: 'La page demandée n’existe pas.',
  },
};

export const PRIMARY_NAV_LABELS: Record<SiteLocale, {
  latest: string;
  'reset-history': string;
  'rate-limit-updates': string;
  faq: string;
  methodology: string;
  community: string;
  openGambit: string;
  aiDisclosure: string;
}> = {
  en: {
    latest: 'Latest',
    'reset-history': 'Reset History',
    'rate-limit-updates': 'Rate Limit Updates',
    faq: 'FAQ',
    methodology: 'Methodology',
    community: 'ModelYard Community',
    openGambit: 'Open Gambit',
    aiDisclosure: 'AI',
  },
  zh: {
    latest: '最新动态',
    'reset-history': '重置历史',
    'rate-limit-updates': '限额更新',
    faq: '常见问题',
    methodology: '方法论',
    community: 'ModelYard 社区',
    openGambit: '阳谋',
    aiDisclosure: 'AI 说明',
  },
  ja: {
    latest: '最新情報',
    'reset-history': 'リセット履歴',
    'rate-limit-updates': 'レート制限の更新',
    faq: 'FAQ',
    methodology: '方法論',
    community: 'ModelYard コミュニティ',
    openGambit: 'Open Gambit',
    aiDisclosure: 'AI',
  },
  es: {
    latest: 'Últimas novedades',
    'reset-history': 'Historial de restablecimientos',
    'rate-limit-updates': 'Actualizaciones de límites',
    faq: 'Preguntas frecuentes',
    methodology: 'Metodología',
    community: 'Comunidad ModelYard',
    openGambit: 'Open Gambit',
    aiDisclosure: 'IA',
  },
  fr: {
    latest: 'Dernières infos',
    'reset-history': 'Historique des réinitialisations',
    'rate-limit-updates': 'Mises à jour des limites',
    faq: 'FAQ',
    methodology: 'Méthodologie',
    community: 'Communauté ModelYard',
    openGambit: 'Open Gambit',
    aiDisclosure: 'IA',
  },
};

const LANDING_PATHS = {
  latest: '/latest/',
  'reset-history': '/reset-history/',
  'rate-limit-updates': '/rate-limit-updates/',
  faq: '/faq/',
  methodology: '/methodology/',
} as const;

const COMMUNITY_PATHS: Record<SiteLocale, string> = {
  en: '/community/',
  zh: '/zh/community/',
  ja: '/ja/community/',
  es: '/es/community/',
  fr: '/fr/community/',
};

export const OPEN_GAMBIT_PATHS: Record<SiteLocale, string> = {
  en: '/open-gambit/',
  zh: '/zh/open-gambit/',
  ja: '/ja/open-gambit/',
  fr: '/fr/open-gambit/',
  es: '/es/open-gambit/',
};

export const AI_DISCLOSURE_PATHS: Record<SiteLocale, string> = {
  en: '/about/ai/',
  zh: '/zh/about/ai/',
  ja: '/ja/about/ai/',
  fr: '/fr/about/ai/',
  es: '/es/about/ai/',
};

export const RSS_PATHS: Record<SiteLocale, string> = {
  en: '/feed.xml',
  zh: '/zh/feed.xml',
  ja: '/ja/feed.xml',
  fr: '/fr/feed.xml',
  es: '/es/feed.xml',
};

function escapeHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function homePath(lang: SiteLocale): string {
  return localePath('/', lang);
}

function landingPath(page: keyof typeof LANDING_PATHS, lang: SiteLocale): string {
  return localePath(LANDING_PATHS[page], lang);
}

function communityPath(lang: SiteLocale): string {
  return COMMUNITY_PATHS[lang];
}

export interface SharedHeaderOptions {
  accounts?: string[];
  interactive?: boolean;
  alternatePath?: string | null;
}

/** Canonical public shell header shared by monitor, community, Gambit, and disclosure pages. */
export function renderSharedHeader(lang: SiteLocale, options: SharedHeaderOptions = {}): string {
  const copy = SITE_BRAND_COPY[lang];
  const labels = PRIMARY_NAV_LABELS[lang];
  const accounts = (options.accounts ?? ['thsottiaux'])
    .filter(account => account.trim())
    .map(account => '@' + account.trim())
    .join(', ');
  const alternatePath = options.alternatePath === undefined
    ? (lang === 'zh' ? '/' : '/zh/')
    : options.alternatePath;
  const languageMenuLabel = lang === 'zh' ? '语言' : lang === 'ja' ? '言語' : lang === 'es' ? 'Idiomas' : lang === 'fr' ? 'Langues' : 'Languages';
  const languageBasePath = alternatePath || homePath(lang);
  const languageMenu = '<details class="language-menu"><summary class="lang-switch" id="langSwitch" aria-label="' + escapeHtml(languageMenuLabel) + '">' + escapeHtml(SITE_LOCALE_LABELS[lang]) + '</summary><div class="language-menu-options" aria-label="' + escapeHtml(languageMenuLabel) + '">'
    + SITE_LOCALES.map(locale => '<a href="' + escapeHtml(localePath(languageBasePath, locale)) + '"' + (locale === lang ? ' aria-current="page"' : '') + '>' + escapeHtml(SITE_LOCALE_LABELS[locale]) + '</a>').join('')
    + '</div></details>';
  const moduleName = copy.monitor;
  const openGambitPath = OPEN_GAMBIT_PATHS[lang];
  // Single source of truth for the global header status badge: the canonical
  // SITE_BRAND_COPY dictionary is rendered once into data-state-* attributes.
  // The client-side updater reads these attributes instead of a second
  // dictionary, so every public route shows the same per-locale status copy.
  const badgeStates = [
    ['live', copy.live],
    ['monitoring', copy.monitoring],
    ['awaiting-first-run', copy.awaitingFirstRun],
    ['not-configured', copy.notConfigured],
    ['source-not-configured', copy.sourceNotConfigured],
    ['classifier-not-configured', copy.classifierNotConfigured],
    ['degraded', copy.degraded],
    ['stale', copy.stale],
    ['unknown', copy.unknown],
  ].map(([state, label]) => ' data-state-' + state + '="' + escapeHtml(label) + '"').join('');
  return [
    '    <header class="header">',
    '      <div class="header-left">',
    '        <a class="logo logo-home-link" href="' + escapeHtml(homePath(lang)) + '" aria-label="' + escapeHtml(copy.homeAria) + '">',
    '          <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">',
    '            <path d="M12 2L2 7l10 5 10-5-10-5z"/>',
    '            <path d="M2 17l10 5 10-5"/>',
    '            <path d="M2 12l10 5 10-5"/>',
    '          </svg>',
    '          <div>',
    '            <div class="logo-title" id="siteTitle">' + MODELYARD_BRAND + '</div>',
    '            <p class="logo-subtitle"><span class="logo-module-name">' + escapeHtml(moduleName) + '</span><span class="logo-module-separator"> · </span><span id="monitoringLabel">' + escapeHtml(copy.monitoring) + '</span> <span id="monitoredAccounts">' + escapeHtml(accounts) + '</span></p>',
    '          </div>',
    '        </a>',
    '      </div>',
    '      <div class="header-right">',
    '        <span class="live-badge" id="liveBadge"' + badgeStates + '><span class="live-dot" style="background:#606070;animation:none"></span><span id="lastCheckedLabel">' + escapeHtml(options.interactive ? copy.awaitingFirstRun : copy.live) + '</span></span>',
    '        <a class="header-gambit-link" href="' + escapeHtml(openGambitPath) + '">' + escapeHtml(labels.openGambit) + '</a>',
    '        <a class="header-community-link" href="' + escapeHtml(communityPath(lang)) + '">' + escapeHtml(labels.community) + '</a>',
    '        ' + languageMenu,
    '      </div>',
    '    </header>',
  ].join('\n');
}

/** Canonical public shell footer shared by every public page type. */
export function renderSharedFooter(lang: SiteLocale): string {
  const labels = PRIMARY_NAV_LABELS[lang];
  const copy = SITE_BRAND_COPY[lang];
  return [
    '    <footer class="footer">',
    '      <div class="footer-content">',
    '        <p id="footerText">' + escapeHtml(copy.footer) + '</p>',
    '        <nav class="footer-links" aria-label="' + escapeHtml(copy.footerNavigation) + '">',
    '          <a href="' + escapeHtml(homePath(lang)) + '">' + escapeHtml(copy.home) + '</a>',
    '          <a href="' + escapeHtml(landingPath('latest', lang)) + '">' + escapeHtml(labels.latest) + '</a>',
    '          <a href="' + escapeHtml(landingPath('reset-history', lang)) + '">' + escapeHtml(labels['reset-history']) + '</a>',
    '          <a href="' + escapeHtml(landingPath('rate-limit-updates', lang)) + '">' + escapeHtml(labels['rate-limit-updates']) + '</a>',
    '          <a href="' + escapeHtml(landingPath('faq', lang)) + '">' + escapeHtml(labels.faq) + '</a>',
    '          <a href="' + escapeHtml(landingPath('methodology', lang)) + '">' + escapeHtml(labels.methodology) + '</a>',
    '          <a href="' + escapeHtml(communityPath(lang)) + '">' + escapeHtml(labels.community) + '</a>',
    '          <a href="' + escapeHtml(OPEN_GAMBIT_PATHS[lang]) + '">' + escapeHtml(labels.openGambit) + '</a>',
    '          <a href="' + escapeHtml(AI_DISCLOSURE_PATHS[lang]) + '">' + escapeHtml(labels.aiDisclosure) + '</a>',
    '          <a href="https://modelyard.dev" target="_blank" rel="noopener noreferrer">ModelYard</a>',
    '          <a href="' + escapeHtml(RSS_PATHS[lang]) + '">RSS</a>',
    '        </nav>',
    '      </div>',
    '    </footer>',
  ].join('\n');
}
