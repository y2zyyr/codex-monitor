import { test, expect } from '@playwright/test';

const requiredCategories = ['POLICY_CHANGE', 'RESET_COMPLETED', 'RESET_PLANNED'];

test.describe('Tibo Monitor production frontend', () => {
  test('loads data and supports language, filters, modal, and persistence', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const requestedUrls = new Set<string>();
    const apiResponses: Array<{ url: string; status: number; contentType: string }> = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(request.method() + ' ' + request.url() + ': ' + (request.failure()?.errorText || 'failed'));
    });
    page.on('request', (request) => requestedUrls.add(request.url()));
    page.on('response', (response) => {
      if (/\/api\/(health|status|events|reset\/current)/.test(response.url())) {
        apiResponses.push({
          url: response.url(),
          status: response.status(),
          contentType: response.headers()['content-type'] || '',
        });
      }
    });
    await page.addInitScript(() => {
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
        console.error('Unhandled promise rejection: ' + reason);
      });
    });

    await page.goto('/');
    await page.waitForFunction(() => typeof (window as typeof window & { openModal?: unknown }).openModal === 'function');
    await expect(page.locator('.timeline-item').first()).toBeVisible();

    const renderedCategories = await page.locator('.timeline-item').evaluateAll((items) =>
      items.map((item) => [...item.classList].find((name) =>
        ['POLICY_CHANGE', 'RESET_COMPLETED', 'RESET_PLANNED'].includes(name)
      ) || '')
    );
    for (const category of requiredCategories) {
      expect(renderedCategories).toContain(category);
    }

    await expect(page.locator('#lastResetValue')).not.toHaveText('—');
    await expect(page.locator('#latestChangeValue')).not.toHaveText('—');
    const expectedApiPaths = [
      '/api/status',
      '/api/events?limit=50',
      '/api/events?category=RESET_COMPLETED&limit=100',
      '/api/reset/current',
    ];
    await expect.poll(() => expectedApiPaths.every((path) =>
      apiResponses.some((item) => item.url.includes(path))
    )).toBeTruthy();
    for (const path of expectedApiPaths) {
      expect([...requestedUrls].some((url) => url.includes(path))).toBeTruthy();
      const response = apiResponses.find((item) => item.url.includes(path));
      expect(response).toBeDefined();
      expect(response!.status).toBeGreaterThanOrEqual(200);
      expect(response!.status).toBeLessThan(300);
      expect(response!.contentType).toMatch(/application\/json/);
    }

    // The English modal must not render the alternate Chinese title/summary.
    await page.locator('.timeline-item').first().locator('.timeline-dot').click();
    await expect(page.locator('#eventModal')).toBeVisible();
    const englishModalLabels = await page.locator('#modalContent .modal-label').allTextContents();
    expect(englishModalLabels).not.toContain('中文标题');
    expect(englishModalLabels).not.toContain('中文摘要');
    expect(englishModalLabels).not.toContain('English Title');
    expect(englishModalLabels).not.toContain('English Summary');
    await expect(page.locator('#modalContent .ai-summary')).toHaveCount(1);
    await page.getByRole('button', { name: '×' }).click();
    await expect(page.locator('#eventModal')).toBeHidden();

    await page.locator('#langSwitch').click();
    await page.getByRole('link', { name: '中文' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#timelineTitle')).toHaveText('时间线');
    await expect(page.locator('#cardLabelLastReset')).toHaveText('最近重置');
    await expect(page.getByRole('button', { name: '全部' })).toBeVisible();
    await expect(page.locator('#footerText')).toContainText('非官方');

    await page.getByRole('button', { name: '计划重置' }).click();
    await expect(page.locator('.timeline-item').first()).toBeVisible();
    const plannedClasses = await page.locator('.timeline-item').evaluateAll((items) => items.map((item) => item.className));
    expect(plannedClasses.length).toBeGreaterThan(0);
    expect(plannedClasses.every((className) => className.includes('RESET_PLANNED'))).toBeTruthy();

    await page.getByRole('button', { name: '重置完成' }).click();
    await expect(page.locator('.timeline-item').first()).toBeVisible();
    const completedClasses = await page.locator('.timeline-item').evaluateAll((items) => items.map((item) => item.className));
    expect(completedClasses.length).toBeGreaterThan(0);
    expect(completedClasses.every((className) => className.includes('RESET_COMPLETED'))).toBeTruthy();

    await page.getByRole('button', { name: '政策' }).click();
    await expect(page.locator('.timeline-item').first()).toBeVisible();
    const policyClasses = await page.locator('.timeline-item').evaluateAll((items) => items.map((item) => item.className));
    expect(policyClasses.length).toBeGreaterThan(0);
    expect(policyClasses.every((className) => className.includes('POLICY_CHANGE'))).toBeTruthy();

    await page.getByRole('button', { name: '全部' }).click();
    // The title is a deliberate detail-page link; click the card's dot area
    // to exercise the separate modal action.
    await page.locator('.timeline-item').first().locator('.timeline-dot').click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.locator('#modalContent')).toContainText('原始来源');
    await expect(page.locator('#modalContent')).toContainText('AI 摘要');
    await expect(page.locator('#modalContent a.modal-link')).toHaveAttribute('href', /^https?:\/\//);
    await page.getByRole('button', { name: '×' }).click();
    await expect(page.locator('#eventModal')).toBeHidden();

    await page.locator('#langSwitch').click();
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('#langSwitch').click();
    await page.getByRole('link', { name: '中文' }).click();
    await expect(page).toHaveURL(/\/zh\/$/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#timelineTitle')).toHaveText('时间线');
    await page.locator('#langSwitch').click();
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests.filter((request) => /\/app\.js|\/style\.css|\/api\//.test(request))).toEqual([]);
  });

  test('keeps interactions usable on a 390x844 viewport', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await page.waitForFunction(() => typeof (window as typeof window & { openModal?: unknown }).openModal === 'function');
    await expect(page.locator('.timeline-item').first()).toBeVisible();
    await page.locator('#langSwitch').click();
    await page.getByRole('link', { name: '中文' }).click();
    await page.getByRole('button', { name: '政策' }).click();
    await expect(page.locator('.timeline-item').first()).toBeVisible();
    await page.locator('.timeline-item').first().locator('.timeline-dot').click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByRole('button', { name: '×' }).click();
    await expect(page.locator('#eventModal')).toBeHidden();

    const viewportState = await page.evaluate(() => {
      const button = document.getElementById('langSwitch');
      const rect = button?.getBoundingClientRect();
      const center = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
      return {
        viewport: [window.innerWidth, window.innerHeight],
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        elementAtLanguageButton: center?.id || center?.closest('button')?.id || null,
      };
    });
    expect(viewportState.viewport).toEqual([390, 844]);
    expect(viewportState.horizontalOverflow).toBeFalsy();
    expect(viewportState.elementAtLanguageButton).toBe('langSwitch');
    expect(pageErrors).toEqual([]);
    await context.close();
  });
});
