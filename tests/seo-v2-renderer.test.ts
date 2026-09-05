import { describe, expect, it } from 'vitest';
import type { ManualResetReportPublic, MonitorEvent } from '../src/types';
import {
  evaluateEventIndexEligibility,
  isEventIndexEligible,
} from '../src/utils/index-policy';
import {
  render404,
  renderEventPage,
  renderHomepage,
  renderLandingPage,
  renderRssFeed,
  renderSitemap,
} from '../src/renderer';
import { formatDateTimeForLocale } from '../src/utils/timezone';

function event(overrides: Partial<MonitorEvent> = {}): MonitorEvent {
  return {
    id: 25,
    source_post_id: 100,
    source_account: 'thsottiaux',
    category: 'POLICY_CHANGE',
    title_en: 'A public Codex policy update',
    title_zh: '一条公开的 Codex 政策更新',
    summary_en: 'A sufficiently detailed public source summary is visible on the event page for review and historical context.',
    summary_zh: '页面展示了可供复核的公开来源摘要和历史上下文。',
    confidence: 0.92,
    published_at: '2026-08-26T12:00:00.000Z',
    effective_at: null,
    reset_at: null,
    source_url: 'https://x.com/thsottiaux/status/100',
    source_text: 'The original public source text is retained here so the indexed evidence can be reviewed.',
    source_quality: 'DIRECT',
    evidence_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
    first_discovered_via: 'x_api',
    last_verified_via: 'x_api',
    verified_at: '2026-08-27T12:00:00.000Z',
    observed_at: '2026-08-26T12:05:00.000Z',
    created_at: '2026-08-26T12:06:00.000Z',
    updated_at: '2026-08-27T12:01:00.000Z',
    ...overrides,
  };
}

function jsonLdBlocks(html: string): Array<Record<string, any>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1].trim()));
}

describe('SEO V2 renderer and index policy', () => {
  it('uses the fixed language timezone for SSR reset-history grouping', () => {
    const boundaryEvent = event({ published_at: '2026-08-01T03:30:00.000Z' });
    const english = renderLandingPage({ page: 'reset-history', events: [boundaryEvent] }, 'en');
    const chinese = renderLandingPage({ page: 'reset-history', events: [boundaryEvent] }, 'zh');

    // The instant is July 31 in New York but August 1 in Beijing.
    expect(english).toContain('<h4>July</h4>');
    expect(chinese).toContain('<h4>8月</h4>');
  });

  it('renders canonical locale timezones in SSR timestamp markup', () => {
    const current = event({ published_at: '2026-08-31T02:42:44.000Z' });
    const rawZones = ['America/New_York', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/Paris', 'Europe/Madrid'];

    for (const locale of ['en', 'zh', 'ja', 'fr', 'es'] as const) {
      const html = renderHomepage({
        events: [current],
        latestEvent: current,
        lastReset: current,
        lastPolicy: current,
        lastCheckedAt: null,
        totalEvents: 1,
      }, locale);
      const timeText = [...html.matchAll(/<time[^>]*>([\s\S]*?)<\/time>/g)]
        .map(match => match[1])
        .join(' ');

      expect(timeText).toContain(formatDateTimeForLocale(current.published_at, locale));
      for (const zone of rawZones) expect(timeText).not.toContain(zone);
    }
  });

  it('keeps homepage visible event markup and ItemList in sync', () => {
    const events = [event(), event({ id: 24, source_post_id: 99, title_en: 'Earlier event', title_zh: '更早事件' })];
    const html = renderHomepage({
      events,
      latestEvent: events[0],
      lastReset: null,
      lastPolicy: events[0],
      lastCheckedAt: '2026-08-27T12:00:00.000Z',
      sourceLastFetchedAt: '2026-08-27T11:59:00.000Z',
      sourceMode: 'x_direct',
      totalEvents: events.length,
      accounts: ['thsottiaux'],
    }, 'en');
    const itemList = jsonLdBlocks(html).find(schema => schema['@type'] === 'ItemList');

    expect(html).toContain('<main class="homepage-main">');
    expect(html).not.toContain('class="seo-intro" style="display:none"');
    expect((html.match(/<li class="timeline-item/g) || []).length).toBe(events.length);
    expect(itemList?.itemListElement).toHaveLength(events.length);
    expect(html).toContain('href="/latest/"');
    expect(html).toContain('id="eventSearchInput"');
    expect(html).not.toContain('id="historyChart"');
    expect(html).not.toContain('History trend');
    expect(html).toContain('id="countdownHistoryReference"');
    expect(html).toContain('id="sourceStatusValue">X Direct</div>');
    expect(html).toContain('href="https://tibo.modelyard.dev/feed.xml"');
    expect(html).toContain('every event includes its source and status.');
    expect(html).toContain('OpenAI Codex');
    expect(html).toContain('ChatGPT Work');
    expect(html).toContain('GPT/Codex');
    expect(html).not.toContain('Last successful monitor check:');
    expect(html).not.toContain('Last source fetch:');
    expect(html).not.toContain('Data comes from public sources and is labelled');
  });

  it('renders an escaped, source-linked RSS feed', () => {
    const feed = renderRssFeed([event({
      title_en: 'A & policy <update>',
      source_text: 'source & evidence <excerpt>',
    })], 'en');

    expect(feed).toContain('<rss version="2.0"');
    expect(feed).toContain('A &amp; policy &lt;update&gt;');
    expect(feed).toContain('source &amp; evidence &lt;excerpt&gt;');
    expect(feed).not.toContain('A & policy <update>');
    expect(feed).toContain('https://tibo.modelyard.dev/events/25');
  });

  it('renders a system reset report without faking X provenance', () => {
    const manualReset: ManualResetReportPublic = {
      id: 7,
      resetAt: '2026-08-28T06:30:00.000Z',
      reportedAt: '2026-08-28T06:31:00.000Z',
      note: 'verified in the account',
      source: 'telegram_manual',
    };
    const html = renderHomepage({
      events: [],
      latestEvent: null,
      lastReset: null,
      manualReset,
      lastPolicy: null,
      lastCheckedAt: null,
      totalEvents: 0,
    }, 'zh');
    const feed = renderRssFeed([], 'zh', manualReset);

    expect(html).toContain('服务器重置报告');
    expect(html).toContain('服务器报告额度已重置。');
    const expectedTime = formatDateTimeForLocale(manualReset.resetAt, 'zh');
    expect(html).toContain('>' + expectedTime + '</time>');
    expect(html).toContain('系统自动报告。');
    expect(html).not.toContain('Telegram');
    expect(html).toContain('verified in the account');
    expect(html).toContain('window.__SSR_MANUAL_RESET__');
    expect(feed).toContain('服务器报告：额度已重置');
    expect(feed).toContain('服务器报告额度已重置。 ' + expectedTime);
    expect(feed).toContain('系统自动报告。');
    expect(feed).toContain('system-reset-report:7');
  });

  it('injects only the configured Tibo GA4 tag and Search Console marker', () => {
    const data = {
      events: [],
      latestEvent: null,
      lastReset: null,
      lastPolicy: null,
      lastCheckedAt: null,
      totalEvents: 0,
    };
    const configured = renderHomepage(data, 'en', {
      googleAnalyticsId: 'G-FV8BHY6E9V',
      googleSiteVerification: 'EfJyXGVCtaAcX-j12S5h2Sauw7rcVTZHOegr4QUCuzc',
    });
    const unconfigured = renderHomepage(data, 'en');

    expect(configured).toContain('https://www.googletagmanager.com/gtag/js?id=G-FV8BHY6E9V');
    expect(configured).toContain("gtag('config', 'G-FV8BHY6E9V',");
    expect(configured).toContain('"page_language":"en"');
    expect(configured).toContain('"page_type":"home"');
    expect(configured).toMatch(/<script src="\/analytics\.js\?v=[^"]+" defer><\/script>/);
    expect(configured).toContain('<meta name="google-site-verification" content="EfJyXGVCtaAcX-j12S5h2Sauw7rcVTZHOegr4QUCuzc">');
    expect(unconfigured).not.toContain('googletagmanager.com/gtag/js');
    expect(unconfigured).not.toContain('google-site-verification');
  });

  it('uses the English default timezone for the English system report', () => {
    const manualReset: ManualResetReportPublic = {
      id: 8,
      resetAt: '2026-08-28T06:30:00.000Z',
      reportedAt: '2026-08-28T06:31:00.000Z',
      note: null,
      source: 'telegram_manual',
    };
    const html = renderHomepage({
      events: [],
      latestEvent: null,
      lastReset: null,
      manualReset,
      lastPolicy: null,
      lastCheckedAt: null,
      totalEvents: 0,
    }, 'en');
    const feed = renderRssFeed([], 'en', manualReset);

    expect(html).toContain('Server reported a usage reset.');
    const expectedTime = formatDateTimeForLocale(manualReset.resetAt, 'en');
    expect(html).toContain('>' + expectedTime + '</time>');
    expect(html).toContain('Automated report.');
    expect(feed).toContain(expectedTime);
  });

  it('emits Article data that is visible and source-linked on event pages', () => {
    const current = event({
      effective_at: '2026-08-27T12:30:00.000Z',
      reset_at: '2026-08-27T13:00:00.000Z',
    });
    const html = renderEventPage({
      event: current,
      prevEvent: null,
      nextEvent: null,
      relatedEvents: [],
    }, 'en');
    const article = jsonLdBlocks(html).find(schema => schema['@type'] === 'Article');

    expect(article).toBeDefined();
    expect(article?.headline).toContain(current.title_en);
    expect(article?.headline).toContain('2026');
    expect(article?.description).toBe(current.summary_en);
    expect(article?.datePublished).toBe(current.published_at);
    expect(article?.dateModified).toBe(current.updated_at);
    expect(article?.isBasedOn).toBe(current.source_url);
    expect(article).not.toHaveProperty('author');
    expect(article).not.toHaveProperty('publisher');
    expect(html.match(/<h1[^>]*>/g)).toHaveLength(1);
    expect(html).toContain('Observed');
    expect(html).toContain('Effective');
    expect(html).toContain('Reset time');
    expect(html).toContain('What does this mean?');
    expect(html).toContain('class="event-answer-panel"');
    expect(html).toContain('At a glance');
    expect(html).not.toContain('Who is affected?');
    expect(html).toContain('DIRECT_VERIFIED');
    expect(html).toContain(current.source_url);
  });

  it('uses cached event translations and omits untranslated alternates from index signals', () => {
    const localized = event({
      translations: {
        ja: {
          language: 'ja',
          title: 'Codex ポリシー更新',
          summary: '日本語で確認できる十分なイベント概要です。',
          status: 'translated',
          provider: 'test',
          translated_at: '2026-08-31T01:00:00.000Z',
        },
        es: {
          language: 'es',
          title: 'Actualización de política de Codex',
          summary: 'Un resumen del evento disponible en español.',
          status: 'translated',
          provider: 'test',
          translated_at: '2026-08-31T01:00:00.000Z',
        },
        fr: {
          language: 'fr',
          title: 'Mise à jour de la politique Codex',
          summary: 'Un résumé de l’événement disponible en français.',
          status: 'translated',
          provider: 'test',
          translated_at: '2026-08-31T01:00:00.000Z',
        },
      },
    });
    const japanese = renderEventPage({ event: localized, prevEvent: null, nextEvent: null, relatedEvents: [] }, 'ja');
    const article = jsonLdBlocks(japanese).find(schema => schema['@type'] === 'Article');

    expect(japanese).toContain('<title>Codex ポリシー更新 · 2026年8月26日 — ModelYard · Tibo Codex Monitor</title>');
    expect(japanese).toContain('日本語で確認できる十分なイベント概要です。');
    expect(japanese).toContain('<meta name="robots" content="index, follow">');
    expect(japanese).toContain('hreflang="ja" href="https://tibo.modelyard.dev/ja/events/25"');
    expect(japanese).toContain('hreflang="es" href="https://tibo.modelyard.dev/es/events/25"');
    expect(japanese).toContain('hreflang="fr" href="https://tibo.modelyard.dev/fr/events/25"');
    expect(article?.headline).toBe('Codex ポリシー更新 · 2026年8月26日');
    expect(article?.description).toBe('日本語で確認できる十分なイベント概要です。');
    expect(article?.inLanguage).toBe('ja');

    const missingSpanish = renderEventPage({ event: event(), prevEvent: null, nextEvent: null, relatedEvents: [] }, 'es');
    expect(missingSpanish).toContain('<meta name="robots" content="noindex, follow">');
    expect(missingSpanish).not.toContain('hreflang="es" href="https://tibo.modelyard.dev/es/events/25"');

    const sitemapBeforeBackfill = renderSitemap([event()], '2026-08-31T01:00:00.000Z');
    expect(sitemapBeforeBackfill).not.toContain('/ja/events/25');
    const sitemapAfterBackfill = renderSitemap([localized], '2026-08-31T01:00:00.000Z');
    expect(sitemapAfterBackfill).toContain('/ja/events/25');
    expect(sitemapAfterBackfill).toContain('/es/events/25');
    expect(sitemapAfterBackfill).toContain('/fr/events/25');
  });

  it('renders a branded 404 without a homepage canonical', () => {
    const html = render404('en');
    expect(html).toContain('noindex, nofollow');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('hreflang=');
    expect(html.match(/<h1[^>]*>/g)).toHaveLength(1);
    expect(html).toContain('href="/latest/"');
    expect(html).toContain('href="/reset-history/"');
    expect(html).toContain('href="/faq/"');
  });

  it('keeps English and Chinese landing-page hreflang reciprocal', () => {
    const en = renderLandingPage({ page: 'reset-history', events: [event()] }, 'en');
    const zh = renderLandingPage({ page: 'reset-history', events: [event()] }, 'zh');
    expect(en).toContain('hreflang="en" href="https://tibo.modelyard.dev/reset-history/"');
    expect(en).toContain('hreflang="zh-CN" href="https://tibo.modelyard.dev/zh/reset-history/"');
    expect(zh).toContain('hreflang="en" href="https://tibo.modelyard.dev/reset-history/"');
    expect(zh).toContain('hreflang="zh-CN" href="https://tibo.modelyard.dev/zh/reset-history/"');
  });

  it('separates verification quality from index eligibility', () => {
    const direct = event();
    const indexed = event({
      id: 24,
      source_post_id: 99,
      verification_status: 'INDEXED_ONLY',
      source_quality: 'INDEXED',
      evidence_quality: 'INDEXED',
      last_verified_via: null,
      verified_at: null,
      first_discovered_via: 'web_search',
    });
    const thinIndexed = event({
      ...indexed,
      id: 23,
      source_post_id: 98,
      summary_en: 'Short summary',
      summary_zh: '短摘要',
      source_text: 'short',
    });

    expect(isEventIndexEligible(direct)).toBe(true);
    expect(evaluateEventIndexEligibility(indexed).indexable).toBe(true);
    expect(evaluateEventIndexEligibility(indexed).reasons.join(' ')).toContain('indexed evidence');
    expect(isEventIndexEligible(thinIndexed)).toBe(false);

    const sitemap = renderSitemap([direct, indexed, thinIndexed], '2026-08-27T12:00:00.000Z', [
      { page: 'latest', indexable: true },
      { page: 'reset-history', indexable: false },
      { page: 'faq', indexable: true },
    ]);
    expect(sitemap).toContain('/events/25');
    expect(sitemap).toContain('/events/24');
    expect(sitemap).not.toContain('/events/23');
    expect(sitemap).toContain('/latest/');
    expect(sitemap).toContain('/faq/');
    expect(sitemap).not.toContain('/reset-history/');

    const emptySitemap = renderSitemap([], null, [{ page: 'faq', indexable: true }]);
    expect(emptySitemap).not.toContain('<lastmod>null</lastmod>');
  });

  it('does not infer direct provenance when verification fields are missing', () => {
    const pending = event({
      source_quality: undefined,
      evidence_quality: undefined,
      verification_status: undefined,
      first_discovered_via: null,
      last_verified_via: null,
      verified_at: null,
    });
    const html = renderEventPage({ event: pending, prevEvent: null, nextEvent: null, relatedEvents: [] }, 'en');

    expect(html).toContain('PENDING');
    expect(html).toContain('Unknown source type');
    expect(html).toContain('Pending verification');
    expect(html).not.toContain('Directly verified');
    expect(isEventIndexEligible(pending)).toBe(false);
  });
});
