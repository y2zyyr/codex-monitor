import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SITE_HTML_LANG, SITE_LOCALES, localePath, type SiteLocale } from '../src/i18n';
import { COMMUNITY_TOPIC_LABELS, COMMUNITY_TOPICS } from '../src/community/topics';
import { renderCommunityPage, renderEventPage, renderHomepage, renderLandingPage, renderRssFeed, renderSitemap } from '../src/renderer';
import { renderAiDisclosurePage, renderOpenGambitArticle, renderOpenGambitLanding } from '../src/open-gambit/renderer';
import { MODELYARD_BRAND, PRIMARY_NAV_LABELS, RSS_PATHS, SITE_BRAND_COPY } from '../src/site-shell';
import type { MonitorEvent } from '../src/types';
import type { GambitPublicArticle } from '../src/open-gambit/types';

const BROWSER_LOCALE_KEYS: Record<SiteLocale, string> = {
  en: 'en',
  zh: 'zh-CN',
  ja: 'ja',
  es: 'es',
  fr: 'fr',
};

function browserMessages(): Record<string, Record<string, string>> {
  // Evaluate only the dictionary prefix. The remainder of app.js needs a
  // browser DOM; the prefix is deliberately side-effect free and exposes the
  // actual production dictionaries for a deterministic completeness check.
  const source = readFileSync(new URL('../static/app.js', import.meta.url), 'utf8')
    .split('// --- Category Config ---')[0]
    + '\nthis.__localeMessages = messages;';
  const context: { window: { TiboLocaleTime: null }; __localeMessages?: Record<string, Record<string, string>> } = {
    window: { TiboLocaleTime: null },
  };
  runInNewContext(source, context);
  return context.__localeMessages || {};
}

const representativeEvent: MonitorEvent = {
  id: 65,
  source_post_id: 2096035437299237298,
  source_account: 'thsottiaux',
  category: 'RESET_PLANNED',
  title_en: 'Full banked reset planned for Plus, Pro and Business',
  title_zh: 'Plus、Pro 和 Business 将进行完整 banked reset',
  summary_en: 'A full banked reset was announced for Plus, Pro and Business users at the end of the day.',
  summary_zh: '公开消息称 Plus、Pro 和 Business 用户将在当天结束前进行完整 banked reset。',
  confidence: 0.95,
  published_at: '2026-09-05T08:00:00.000Z',
  effective_at: null,
  reset_at: '2026-09-05T23:59:00.000Z',
  source_url: 'https://x.com/thsottiaux/status/2096035437299237298',
  source_text: 'we will do the full banked reset today too for all Plus, Pro and Business users. Lands end of day.',
  observed_at: '2026-09-05T08:05:00.000Z',
  source_quality: 'DIRECT',
  evidence_quality: 'DIRECT',
  verification_status: 'DIRECT_VERIFIED',
  first_discovered_via: 'x_api',
  last_verified_via: 'x_api',
  verified_at: '2026-09-05T08:06:00.000Z',
  updated_at: '2026-09-05T08:06:00.000Z',
};

const representativeArticle = {
  articleId: 7,
  candidateId: 9,
  revisionId: 3,
  slug: 'locale-parity-strategy',
  headline: 'A compatibility standard becomes a distribution wedge',
  surfaceEvent: 'A public compatibility standard changes how developers choose a platform.',
  facts: ['The standard is publicly documented.', 'The compatibility layer is available to developers.'],
  obviousLogic: 'Compatibility lowers the cost of trying the platform.',
  thesis: 'The standard can become a distribution wedge.',
  mechanism: 'Compatibility creates a path from adoption to dependency.',
  beneficiaries: ['Developers gain a lower-friction entry point.'],
  pressuredActors: ['Competing platforms must match the interface.'],
  countercase: 'Developers may adopt the standard without becoming dependent on its sponsor.',
  trajectories: [{
    id: 't1',
    predictionStatement: 'At least one major integration will adopt the standard.',
    targetEntity: 'A major integration',
    probability: 60,
    deadline: '2027-03-31',
    reasoning: 'Adoption reduces compatibility costs for the ecosystem.',
    evidenceCriteria: 'A public integration announcement names the standard.',
    falsifier: 'No major integration adopts it by the deadline.',
    status: 'WATCHING',
  }],
  falsifier: 'No major integration adopts the standard by the deadline.',
  evidence: [{
    id: 4,
    snapshotId: 5,
    sourceId: 'official-standard',
    sourceTier: 'PRIMARY_OFFICIAL',
    canonicalUrl: 'https://example.com/standard',
    title: 'Compatibility standard documentation',
    publisher: 'Example',
    publishedAt: '2026-09-05T08:00:00.000Z',
    quote: 'The standard is publicly documented.',
    role: 'FACT',
    contentHash: 'hash',
  }],
  uncertainty: 'The pace of ecosystem adoption remains uncertain.',
  politicalTopic: false,
  critic: {
    accepted: true,
    rejectionReasons: [],
    simplerExplanation: '',
    motiveConcern: false,
    causalConcern: false,
    politicalFraming: false,
    sensationalismConcern: false,
    falsifiabilityConcern: false,
    notes: '',
  },
  modelRoleProvenance: {},
  modelPromptVersion: 'v1',
  aiDisclosureVersion: 'v1',
  draftVersion: 1,
  createdAt: '2026-09-05T08:10:00.000Z',
  status: 'PUBLISHED',
  publishedAt: '2026-09-05T08:15:00.000Z',
  modifiedAt: '2026-09-05T08:15:00.000Z',
  translations: {},
} as GambitPublicArticle;

describe('first-class locale parity', () => {
  it('keeps the browser dictionary complete for all supported locales', () => {
    const messages = browserMessages();
    const baseKeys = Object.keys(messages.en).sort();
    expect(Object.keys(messages)).toEqual(expect.arrayContaining(Object.values(BROWSER_LOCALE_KEYS)));

    for (const locale of SITE_LOCALES) {
      const key = BROWSER_LOCALE_KEYS[locale];
      expect(Object.keys(messages[key]).sort(), `${locale} dictionary`).toEqual(baseKeys);
      expect(Object.values(messages[key]).some(value => value === undefined)).toBe(false);
    }
  });

  it('keeps the shared server dictionaries complete across the five locales', () => {
    for (const locale of SITE_LOCALES) {
      expect(SITE_BRAND_COPY[locale].monitor).toBeTruthy();
      expect(SITE_BRAND_COPY[locale].footer).toBeTruthy();
      expect(PRIMARY_NAV_LABELS[locale]).toEqual(expect.objectContaining({
        latest: expect.any(String),
        'reset-history': expect.any(String),
        'rate-limit-updates': expect.any(String),
        faq: expect.any(String),
        methodology: expect.any(String),
        community: expect.any(String),
        openGambit: expect.any(String),
        aiDisclosure: expect.any(String),
      }));
      for (const topic of COMMUNITY_TOPICS) {
        expect(COMMUNITY_TOPIC_LABELS[topic][locale]).toBeTruthy();
      }
    }
  });

  it('generates a locale counterpart for every public content route', () => {
    const routeBases = [
      '/', '/latest/', '/reset-history/', '/rate-limit-updates/', '/faq/', '/methodology/',
      '/community/', '/open-gambit/', '/about/ai/', '/events/65',
      '/open-gambit/locale-parity-strategy/', '/feed.xml',
    ];
    for (const route of routeBases) {
      const paths = SITE_LOCALES.map(locale => localePath(route, locale));
      expect(new Set(paths).size).toBe(SITE_LOCALES.length);
      for (const locale of SITE_LOCALES) {
        expect(paths).toContain(localePath(route, locale));
      }
    }
  });

  it('keeps RSS references and feeds locale-aware', () => {
    const languageTags: Record<SiteLocale, string> = { en: 'en', zh: 'zh-CN', ja: 'ja', es: 'es', fr: 'fr' };
    for (const locale of SITE_LOCALES) {
      const feed = renderRssFeed([representativeEvent], locale);
      expect(feed).toContain(`<language>${languageTags[locale]}</language>`);
      expect(feed).toContain(`<atom:link href="https://tibo.modelyard.dev${RSS_PATHS[locale]}"`);
      expect(feed).toContain(`https://tibo.modelyard.dev${localePath('/events/65', locale)}`);
    }
  });

  it('includes first-class locale pages in sitemap and disclosure alternates', () => {
    const sitemap = renderSitemap([], null);
    for (const locale of SITE_LOCALES) {
      const disclosure = renderAiDisclosurePage(locale);
      expect(sitemap).toContain(`https://tibo.modelyard.dev${localePath('/about/ai/', locale)}`);
      expect(disclosure).toContain(`hreflang="${locale === 'zh' ? 'zh-CN' : locale}"`);
      expect(disclosure).toContain(`https://tibo.modelyard.dev${localePath('/about/ai/', locale)}`);
    }
  });

  it('keeps feature and semantic content parity while marking controlled fallbacks', () => {
    for (const locale of SITE_LOCALES) {
      const home = renderHomepage({
        events: [representativeEvent],
        latestEvent: representativeEvent,
        lastReset: representativeEvent,
        lastPolicy: null,
        lastCheckedAt: '2026-09-05T08:06:00.000Z',
        totalEvents: 1,
      }, locale);
      const faq = renderLandingPage({ page: 'faq', events: [] }, locale);
      const community = renderCommunityPage({
        posts: [], nextCursor: null, total: 0, postingEnabled: false,
        turnstileSiteKey: null, maxNicknameLength: 32, maxContentLength: 2000,
      }, locale);
      const event = renderEventPage({ event: representativeEvent, prevEvent: null, nextEvent: null, relatedEvents: [] }, locale);
      const gambitLanding = renderOpenGambitLanding([representativeArticle], locale);
      const gambitArticle = renderOpenGambitArticle(representativeArticle, locale);
      const disclosure = renderAiDisclosurePage(locale);

      for (const html of [home, faq, community, event, gambitLanding, gambitArticle, disclosure]) {
        expect(html).toContain(`<html lang="${SITE_HTML_LANG[locale]}">`);
        expect(html).toContain('<header class="header">');
        expect(html).toContain('<footer class="footer">');
        expect(html).toContain(MODELYARD_BRAND);
      }
      expect(home).toContain('2096035437299237298');
      expect(event).toContain('full banked reset');
      expect(event).toContain(representativeEvent.source_url);
      expect(gambitArticle).toContain('At least one major integration will adopt the standard.');
      expect(disclosure).toContain('Claude Fable 5');
      expect(disclosure).toContain('GPT-5.6 Sol');
      expect(disclosure).toContain('DeepSeek V4 Pro');
      if (locale === 'ja' || locale === 'fr' || locale === 'es') {
        expect(event).toContain('data-locale-fallback="en"');
        expect(gambitArticle).toContain('data-locale-fallback="en"');
      }
    }
  });
});
