import { test, expect } from '@playwright/test';

test.describe('Tibo Monitor frontend states', () => {
  test('keeps server-rendered data visible when the refresh API fails', async ({ page }) => {
    await page.route('**/api/events**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'test failure', data: [], nextCursor: null, total: 0 }),
      })
    );

    await page.goto('/');
    await expect(page.locator('.timeline-item').first()).toBeVisible();
    await expect(page.locator('#eventHighlight')).not.toContainText('Unable to load monitoring data.');
    await page.getByRole('button', { name: 'Policy' }).click();
    await expect(page.locator('#filterPolicyChange')).toHaveClass(/active/);
    await page.getByRole('button', { name: 'Switch language to Simplified Chinese' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('.timeline-item').first()).toBeVisible();
  });

  test('renders a loaded-empty state instead of a permanent loader', async ({ page }) => {
    await page.route('**/api/events**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], nextCursor: null, total: 0 }),
      })
    );

    await page.goto('/');
    await expect(page.locator('#timeline')).toContainText('No events to display.');
    await expect(page.locator('#eventHighlight')).toContainText('No events recorded yet.');
    await expect(page.locator('#timelineLoading')).toBeHidden();
  });

  test('keeps server-rendered data visible while events refresh is pending', async ({ page }) => {
    let releaseEvents!: () => void;
    const eventGate = new Promise<void>((resolve) => { releaseEvents = resolve; });
    await page.route('**/api/events**', async (route) => {
      await eventGate;
      await route.continue();
    });

    await page.goto('/');
    await expect(page.locator('.timeline-item').first()).toBeVisible();
    await expect(page.locator('#timelineLoading')).toHaveCount(0);
    await expect(page.locator('#timeline')).not.toContainText('Loading events...');
    releaseEvents();
    await expect(page.locator('.timeline-item').first()).toBeVisible();
  });
});
