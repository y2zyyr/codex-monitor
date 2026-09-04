/**
 * The public site currently supports five interface locales.  Keeping the
 * locale list in one small module prevents route, SSR, and client-side
 * language switches from drifting apart.
 */
export const SITE_LOCALES = ['en', 'zh', 'ja', 'es', 'fr'] as const;
export type SiteLocale = typeof SITE_LOCALES[number];

export const SITE_HTML_LANG: Record<SiteLocale, string> = {
  en: 'en',
  zh: 'zh-CN',
  ja: 'ja',
  es: 'es',
  fr: 'fr',
};

export const SITE_LOCALE_LABELS: Record<SiteLocale, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  es: 'Español',
  fr: 'Français',
};

export function localePrefix(locale: SiteLocale): string {
  return locale === 'en' ? '' : `/${locale}`;
}

export function localePath(path: string, locale: SiteLocale): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const withoutLocale = normalized.replace(/^\/(?:zh|ja|es|fr)(?=\/|$)/u, '') || '/';
  return localePrefix(locale) + (withoutLocale === '/' ? '/' : withoutLocale);
}

export function localeFromPath(pathname: string): SiteLocale {
  const match = pathname.match(/^\/(zh|ja|es|fr)(?:\/|$)/u);
  return match?.[1] as SiteLocale || 'en';
}

export function localeFromHtmlLang(value: string | null | undefined): SiteLocale {
  const normalized = (value || '').toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('es')) return 'es';
  if (normalized.startsWith('fr')) return 'fr';
  return 'en';
}
