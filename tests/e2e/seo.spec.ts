import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://tibo.modelyard.dev';

test.describe('SEO: Production smoke tests', () => {
  test('homepage has SSR content in view-source', async ({ page }) => {
    // Fetch the raw HTML without JS execution
    const response = await page.request.get(BASE + '/');
    const html = await response.text();

    // Must have correct title
    expect(html).toContain('<title>Tibo Codex Reset Tracker');
    expect(html).toContain('Usage Limits &amp; Policy Updates');

    // Must have meta description
    expect(html).toContain('meta name="description"');
    expect(html).toContain('OpenAI Codex usage-limit resets');
    expect(html).toContain('GPT/Codex rate-limit changes');

    // Must have canonical
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('https://tibo.modelyard.dev');

    // Must have exactly one H1
    const h1Matches = html.match(/<h1[^>]*>/g);
    expect(h1Matches).not.toBeNull();
    expect(h1Matches!.length).toBe(1);

    // Must have H2
    expect(html).toContain('<h2');

    // Must have real event data (not just "Loading events...")
    expect(html).not.toContain('Loading events...');
    expect(html).toContain('timeline-item');
    expect(html).toContain('class="site-intro"');
    expect(html).not.toContain('class="seo-intro" style="display:none"');

    // Must have JSON-LD structured data
    expect(html).toContain('application/ld+json');
    expect(html).toContain('WebSite');
    expect(html).toContain('ItemList');

    // Must have OG tags
    expect(html).toContain('og:title');
    expect(html).toContain('og:description');
    expect(html).toContain('og:image');
    expect(html).toContain('og:url');

    // Must have Twitter card
    expect(html).toContain('twitter:card');
    expect(html).toContain('summary_large_image');

    // Must have hreflang
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="zh-CN"');
    expect(html).toContain('hreflang="x-default"');

    // Must have favicon
    expect(html).toContain('favicon.svg');

    // Must have OG image
    expect(html).toContain('og-default.png');

    // Must have internal links to events
    expect(html).toContain('href="/events/');
    expect(html).toContain('timeline-title-link');

    // Must have lang="en"
    expect(html).toContain('lang="en"');

    // Should not have "Loading events..." (that's the JS-only fallback)
    expect(html).not.toContain('Loading events');

    // Should have event data in the SSR
    expect(html).toContain('RESET_PLANNED');
    expect(html).toContain('RESET_COMPLETED');
    expect(html).toContain('POLICY_CHANGE');

    const itemList = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(match => JSON.parse(match[1].trim()))
      .find(schema => schema['@type'] === 'ItemList');
    expect(itemList).toBeDefined();
    const renderedItems = html.match(/<li class="timeline-item/g) || [];
    expect(itemList!.itemListElement).toHaveLength(renderedItems.length);
  });

  test('homepage returns 200 with correct headers', async ({ page }) => {
    const response = await page.request.get(BASE + '/');
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('text/html');
  });

  test('/zh/ homepage has Chinese SSR content', async ({ page }) => {
    const response = await page.request.get(BASE + '/zh/');
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('Tibo Codex 监控');
    expect(html).toContain('额度重置');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="zh-CN"');
    expect(html).toContain('timeline-item');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('WebSite');
    expect(html).toContain('class="site-intro"');
    expect(html).toContain('Codex 使用额度');
  });

  test('event pages are accessible and SSR rendered', async ({ page }) => {
    // First get the events from the API
    const apiResponse = await page.request.get(BASE + '/api/events?limit=1');
    const apiData = await apiResponse.json();
    expect(apiData.data.length).toBeGreaterThan(0);
    const eventId = apiData.data[0].id;

    // Fetch the event page
    const response = await page.request.get(BASE + '/events/' + eventId);
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain('event-detail-page');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('BreadcrumbList');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="zh-CN"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('event-detail-title');
    expect(html).toContain('What Changed');
    expect(html).toContain('Summary');
    expect(html).toContain('Original Source');
    expect(html).toContain('og:title');
    expect(html).toContain('og:description');
    expect(html).toContain('twitter:card');
    expect(html).toContain('Observed');
    expect(html).toContain('Verification');
    expect(html).toContain('event-answer-panel');

    const article = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(match => JSON.parse(match[1].trim()))
      .find(schema => schema['@type'] === 'Article');
    expect(article).toBeDefined();
    expect(article.headline).toContain(apiData.data[0].title_en);
    expect(article.description).toBe(apiData.data[0].summary_en);
    expect(article.isBasedOn).toBe(apiData.data[0].source_url);
    expect(article.author).toBeUndefined();
    expect(article.publisher).toBeUndefined();
  });

  test('Chinese event pages are accessible', async ({ page }) => {
    const apiResponse = await page.request.get(BASE + '/api/events?limit=1');
    const apiData = await apiResponse.json();
    expect(apiData.data.length).toBeGreaterThan(0);
    const eventId = apiData.data[0].id;

    const response = await page.request.get(BASE + '/zh/events/' + eventId);
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('event-detail-page');
    expect(html).toContain('BreadcrumbList');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="zh-CN"');
  });

  test('non-existent event returns 404', async ({ page }) => {
    const response = await page.request.get(BASE + '/events/99999');
    expect(response.status()).toBe(404);
    const html = await response.text();
    expect(html).toContain('404');
    expect(html).toContain('Page not found');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('hreflang=');
    expect(html).toContain('href="/latest/"');
    expect(html).toContain('href="/reset-history/"');
    expect(html).toContain('href="/faq/"');
  });

  test('unknown browser route returns branded 404', async ({ page }) => {
    const response = await page.request.get(BASE + '/not-a-real-page');
    expect(response.status()).toBe(404);
    const html = await response.text();
    expect(html).toContain('Page not found');
    expect(html).toContain('noindex, nofollow');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('hreflang=');
  });

  for (const path of ['/latest/', '/reset-history/', '/rate-limit-updates/', '/faq/', '/methodology/']) {
    test(`${path} is an SSR landing page with an explicit index policy`, async ({ page }) => {
      const response = await page.request.get(BASE + path);
      const html = await response.text();
      expect(response.status()).toBe(200);
      expect(html).toContain('<main class="landing-page">');
      expect(html).toContain('<h1');
      expect(html).toContain('rel="canonical"');
      expect(html).toContain('hreflang="en"');
      expect(html).toContain('hreflang="zh-CN"');
      expect(html).not.toContain('preview');
    });
  }

  test('homepage hydrated metadata matches SSR semantic metadata', async ({ page }) => {
    const ssrResponse = await page.request.get(BASE + '/');
    const ssrHtml = await ssrResponse.text();
    const decodeHtml = (value: string) => value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    const ssr = {
      title: decodeHtml((ssrHtml.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''),
      description: decodeHtml((ssrHtml.match(/<meta name="description" content="([^"]*)">/) || [])[1] || ''),
      ogTitle: decodeHtml((ssrHtml.match(/<meta property="og:title" content="([^"]*)">/) || [])[1] || ''),
      ogDescription: decodeHtml((ssrHtml.match(/<meta property="og:description" content="([^"]*)">/) || [])[1] || ''),
      twitterTitle: decodeHtml((ssrHtml.match(/<meta name="twitter:title" content="([^"]*)">/) || [])[1] || ''),
      twitterDescription: decodeHtml((ssrHtml.match(/<meta name="twitter:description" content="([^"]*)">/) || [])[1] || ''),
    };
    await page.goto(BASE + '/');
    await page.waitForSelector('.site-intro');
    const metadata = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content'),
      twitterTitle: document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'),
      twitterDescription: document.querySelector('meta[name="twitter:description"]')?.getAttribute('content'),
    }));
    expect(metadata.title).toBe(ssr.title);
    expect(metadata.description).toBe(ssr.description);
    expect(metadata.ogTitle).toBe(ssr.ogTitle);
    expect(metadata.ogDescription).toBe(ssr.ogDescription);
    expect(metadata.twitterTitle).toBe(ssr.twitterTitle);
    expect(metadata.twitterDescription).toBe(ssr.twitterDescription);
    expect(metadata.description).toBe(metadata.ogDescription);
    expect(metadata.title).toBe(metadata.ogTitle);
    expect(metadata.title).toBe(metadata.twitterTitle);
    expect(metadata.description).toBe(metadata.twitterDescription);
    expect(metadata.title).toContain('Tibo Codex Reset Tracker');
  });

  test('hydrated homepage keeps visible list and ItemList synchronized', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.waitForSelector('.timeline-item', { timeout: 15000 });
    const counts = await page.evaluate(() => {
      const itemList = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(script => {
          try { return JSON.parse(script.textContent || ''); } catch { return null; }
        })
        .find(schema => schema && schema['@type'] === 'ItemList');
      return {
        rendered: document.querySelectorAll('.timeline-item').length,
        structured: itemList?.itemListElement?.length ?? -1,
        highlightHeading: document.querySelector('#eventHighlight h3')?.textContent || '',
      };
    });
    expect(counts.structured).toBe(counts.rendered);
    expect(counts.highlightHeading).not.toBe('');

    await page.locator('#filterPolicyChange').click();
    const filteredCounts = await page.evaluate(() => {
      const itemList = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(script => {
          try { return JSON.parse(script.textContent || ''); } catch { return null; }
        })
        .find(schema => schema && schema['@type'] === 'ItemList');
      return {
        rendered: document.querySelectorAll('.timeline-item.POLICY_CHANGE').length,
        structured: itemList?.itemListElement?.length ?? -1,
      };
    });
    expect(filteredCounts.structured).toBe(filteredCounts.rendered);
  });

  test('robots.txt is correct', async ({ page }) => {
    const response = await page.request.get(BASE + '/robots.txt');
    const text = await response.text();
    expect(response.status()).toBe(200);
    expect(text).toContain('User-agent: OAI-SearchBot');
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Allow: /');
    expect(text).toContain('Disallow: /admin/');
    expect(text).toContain('Disallow: /api/');
    expect(text).toContain('Disallow: /__cron/');
    expect(text).toContain('Sitemap: https://tibo.modelyard.dev/sitemap.xml');
  });

  test('sitemap contains homepage and events', async ({ page }) => {
    const response = await page.request.get(BASE + '/sitemap.xml');
    const text = await response.text();
    expect(response.status()).toBe(200);
    expect(text).toContain('urlset');
    expect(text).toContain('https://tibo.modelyard.dev/');
    expect(text).toContain('https://tibo.modelyard.dev/zh/');
    expect(text).toContain('/events/');

    // Get all event URLs
    const urlMatches = text.match(/https:\/\/tibo\.modelyard\.dev\/events\/\d+/g);
    expect(urlMatches).not.toBeNull();
    expect(urlMatches!.length).toBeGreaterThan(0);
    expect(text).not.toContain('https://tibo.modelyard.dev/api/');
    expect(text).not.toContain('pages.dev');
    expect(text).not.toContain('/events/99999');
  });

  test('API responses have noindex header', async ({ page }) => {
    const response = await page.request.get(BASE + '/api/events?limit=1');
    expect(response.status()).toBe(200);
    const robots = response.headers()['x-robots-tag'] || '';
    expect(robots).toContain('noindex');

    const healthResponse = await page.request.get(BASE + '/api/health');
    expect(healthResponse.headers()['x-robots-tag'] || '').toContain('noindex');

    const headResponse = await page.request.fetch(BASE + '/api/status', { method: 'HEAD' });
    expect(headResponse.headers()['x-robots-tag'] || '').toContain('noindex');
  });

  for (const path of ['/zh/latest/', '/zh/reset-history/', '/zh/rate-limit-updates/', '/zh/faq/', '/zh/methodology/']) {
    test(`${path} is a reciprocal Chinese SSR landing page`, async ({ page }) => {
      const response = await page.request.get(BASE + path);
      const html = await response.text();
      expect(response.status()).toBe(200);
      expect(html).toContain('<html lang="zh-CN">');
      expect(html).toContain('<main class="landing-page">');
      expect(html).toContain('rel="canonical"');
      expect(html).toContain('hreflang="en"');
      expect(html).toContain('hreflang="zh-CN"');
      expect(html).not.toContain('preview');
    });
  }

  test('old domain redirects to new domain', async ({ page }) => {
    test.skip(BASE.startsWith('http://') || BASE.startsWith('https://127.0.0.1'), 'old-domain redirect is production-only');
    const response = await page.request.get('https://codex.modelyard.dev/', {
      maxRedirects: 0,
    });
    // Should be 301 redirect
    expect(response.status()).toBeGreaterThanOrEqual(301);
    expect(response.status()).toBeLessThanOrEqual(308);
    const location = response.headers()['location'] || '';
    expect(location).toContain('tibo.modelyard.dev');
  });

  test('page interacts correctly with JS', async ({ page }) => {
    // Test that the frontend still works with JS
    await page.goto(BASE + '/');
    await page.waitForSelector('.timeline-item', { timeout: 15000 });

    // Click on an event timeline item should open modal
    const modal = page.locator('#eventModal');
    await expect(modal).toBeHidden();

    // Click on the first timeline item
    // The title is a deliberate detail-page link; click the card's dot area
    // to exercise the separate modal action.
    await page.locator('.timeline-item').first().locator('.timeline-dot').click();
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.locator('#modalContent')).toContainText('Original Source');

    // Close modal
    await page.getByRole('button', { name: '×' }).click();
    await expect(modal).toBeHidden();

    // Language switch works
    await page.locator('#langSwitch').click();
    await page.getByRole('link', { name: '中文' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#timelineTitle')).toHaveText('时间线');
  });

  test('structured data JSON-LD is valid on homepage', async ({ page }) => {
    const response = await page.request.get(BASE + '/');
    const html = await response.text();

    // Extract JSON-LD blocks
    const ldMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    expect(ldMatches).not.toBeNull();
    expect(ldMatches!.length).toBeGreaterThanOrEqual(2);

    // Parse and validate each JSON-LD block
    for (const block of ldMatches!) {
      const jsonStr = block.replace('<script type="application/ld+json">', '').replace('</script>', '').trim();
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toHaveProperty('@context');
      expect(parsed['@context']).toBe('https://schema.org');
      expect(parsed).toHaveProperty('@type');
    }
  });
});

// Run with: npx playwright test tests/e2e/seo.spec.ts --project=chromium
