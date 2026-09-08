// ============================================================
// Shared header status — single source of truth regression
// ============================================================
// The global ModelYard/Tibo monitor header badge must render the SAME
// per-locale status copy on every public route family. The canonical locale
// dictionary lives in src/site-shell.ts (SITE_BRAND_COPY) and is rendered
// into data-state-* attributes on #liveBadge; the client-side updater in
// static/app.js reads those attributes rather than a second dictionary.
//
// These tests fail CI if any page family renders different header status
// copy for the same locale (the 2026-09-08 "正常监控 vs 监控中" regression).
// ============================================================

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderAiDisclosurePage } from '../src/open-gambit/renderer';
import { renderOpenGambitLanding } from '../src/open-gambit/renderer';
import { renderCommunityPage, renderHomepage, renderLandingPage } from '../src/renderer';
import { SITE_BRAND_COPY } from '../src/site-shell';
import { SITE_LOCALES, type SiteLocale } from '../src/i18n';

function homepageHtml(locale: SiteLocale): string {
  return renderHomepage({
    events: [],
    latestEvent: null,
    lastReset: null,
    lastPolicy: null,
    lastCheckedAt: null,
    totalEvents: 0,
  }, locale);
}

function faqHtml(locale: SiteLocale): string {
  return renderLandingPage({ page: 'faq', events: [] }, locale);
}

function communityHtml(locale: SiteLocale): string {
  return renderCommunityPage({
    posts: [], nextCursor: null, total: 0, postingEnabled: false,
    turnstileSiteKey: null, maxNicknameLength: 32, maxContentLength: 2000,
  }, locale);
}

function openGambitHtml(locale: SiteLocale): string {
  return renderOpenGambitLanding([], locale);
}

function disclosureHtml(locale: SiteLocale): string {
  return renderAiDisclosurePage(locale);
}

/** Extract every data-state-* attribute value from the shared header badge. */
function badgeStateLabels(html: string): Record<string, string> {
  const badgeMatch = html.match(/<span class="live-badge" id="liveBadge"[^>]*>/u);
  const labels: Record<string, string> = {};
  if (!badgeMatch) return labels;
  const attrs = badgeMatch[0].matchAll(/data-state-([a-z-]+)="([^"]*)"/gu);
  for (const match of attrs) labels[match[1]] = match[2];
  return labels;
}

function badgeSsrLabel(html: string): string {
  const match = html.match(/<span id="lastCheckedLabel">([^<]*)<\/span>/u);
  return match ? match[1] : '';
}

const PAGE_FAMILIES = [
  ['homepage', homepageHtml],
  ['faq', faqHtml],
  ['community', communityHtml],
  ['open-gambit', openGambitHtml],
  ['disclosure', disclosureHtml],
] as const;

describe('shared header status single source of truth', () => {
  it.each(SITE_LOCALES)('renders identical badge state copy across page families (%s)', locale => {
    const pages = PAGE_FAMILIES.map(([name, render]) => [name, render(locale)] as const);
    const first = badgeStateLabels(pages[0][1]);
    // The badge element must carry the canonical state labels from site-shell.
    expect(Object.keys(first).length).toBeGreaterThanOrEqual(6);
    for (const [name, html] of pages.slice(1)) {
      expect(badgeStateLabels(html), `${name} page badge state copy`).toEqual(first);
    }
  });

  it.each(SITE_LOCALES)('badge state copy equals the canonical site-shell dictionary (%s)', locale => {
    const canonical = SITE_BRAND_COPY[locale];
    const sample = badgeStateLabels(homepageHtml(locale));
    expect(sample.live).toBe(canonical.live);
    expect(sample.monitoring).toBe(canonical.monitoring);
    expect(sample['awaiting-first-run']).toBe(canonical.awaitingFirstRun);
    expect(sample['not-configured']).toBe(canonical.notConfigured);
    expect(sample['source-not-configured']).toBe(canonical.sourceNotConfigured);
    expect(sample['classifier-not-configured']).toBe(canonical.classifierNotConfigured);
    expect(sample.degraded).toBe(canonical.degraded);
    expect(sample.stale).toBe(canonical.stale);
    expect(sample.unknown).toBe(canonical.unknown);
  });
});

describe('Chinese canonical header status 监控中', () => {
  it.each(['homepage', 'faq', 'community', 'open-gambit', 'disclosure'] as const)(
    'renders 监控中 as the canonical shared live badge on %s',
    page => {
      const render = {
        homepage: homepageHtml,
        faq: faqHtml,
        community: communityHtml,
        'open-gambit': openGambitHtml,
        disclosure: disclosureHtml,
      }[page];
      const html = render('zh');
      // Single source of truth: the SSR data-state-live attribute is 监控中.
      expect(badgeStateLabels(html).live).toBe('监控中');
      // Every page family must agree.
      for (const [, renderer] of PAGE_FAMILIES) {
        expect(badgeStateLabels(renderer('zh')).live).toBe('监控中');
      }
      expect(SITE_BRAND_COPY.zh.live).toBe('监控中');
    },
  );

  it('never renders the legacy 正常监控 header status anywhere', () => {
    const appJs = readFileSync(new URL('../static/app.js', import.meta.url), 'utf8');
    expect(appJs).not.toContain('正常监控');
    for (const locale of SITE_LOCALES) {
      expect(badgeStateLabels(homepageHtml(locale))).not.toHaveProperty('live', '正常监控');
    }
    expect(SITE_BRAND_COPY.zh.live).not.toBe('正常监控');
  });
});

describe('all public locales share one header status per locale', () => {
  it.each(SITE_LOCALES)('has one canonical live badge value per locale (%s)', locale => {
    const liveValues = new Set(PAGE_FAMILIES.map(([, render]) => badgeSsrLabel(render(locale))));
    // Non-interactive families render the canonical live value directly.
    // The homepage SSR label is intentionally awaitingFirstRun before the
    // client updater applies the same canonical data-state copy.
    for (const [name, render] of PAGE_FAMILIES) {
      if (name !== 'homepage') {
        expect(badgeSsrLabel(render(locale)), `${name} SSR label`).toBe(SITE_BRAND_COPY[locale].live);
      }
    }
    expect(liveValues.size).toBeGreaterThan(0);
  });
});

// The five site locales and the five Gambit locales must stay in lockstep.
describe('locale list coherence', () => {
  it('site locales cover the expected set', () => {
    expect([...SITE_LOCALES].sort()).toEqual(['en', 'fr', 'ja', 'zh', 'es'].sort());
  });
});
