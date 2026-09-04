import { test, expect } from '@playwright/test';

test.describe('ModelYard Community production surface', () => {
  test('renders the bilingual feed controls and keeps filtered API responses public', async ({ page, baseURL }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('/community/');
    await expect(page.locator('h1')).toHaveText('ModelYard Community');
    await expect(page.locator('#communitySearch')).toBeVisible();
    await expect(page.locator('#communityTopicFilter')).toBeVisible();
    await expect(page.locator('#communityTopic option[value="ai-coding"]')).toHaveText('AI coding');
    await expect(page.getByRole('link', { name: 'Featured' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'GitHub repos' })).toBeVisible();

    const filtered = await page.request.get(new URL('/api/community/posts?topic=ai-coding&featured=1', baseURL).toString());
    expect(filtered.status()).toBe(200);
    await expect(filtered).toBeOK();
    const payload = await filtered.json();
    expect(payload.filters).toMatchObject({ topic: 'ai-coding', featuredOnly: true });

    const invalid = await page.request.get(new URL('/api/community/posts?topic=not-a-topic', baseURL).toString());
    expect(invalid.status()).toBe(400);

    await page.goto('/zh/community/?topic=ai-coding');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('h1')).toHaveText('ModelYard 社区');
    await expect(page.locator('#communityTopicFilter')).toHaveValue('ai-coding');
    expect(pageErrors).toEqual([]);
  });

  test('renders Japanese, Spanish, and French Community routes', async ({ page }) => {
    for (const [path, language, title] of [
      ['/ja/community/', 'ja', 'ModelYard コミュニティ'],
      ['/es/community/', 'es', 'Comunidad de ModelYard'],
      ['/fr/community/', 'fr', 'Communauté ModelYard'],
    ] as const) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('h1')).toHaveText(title);
      await expect(page.locator('.language-menu')).toBeVisible();
      await page.locator('.language-menu summary').click();
      await expect(page.getByRole('link', { name: '日本語' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Español' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Français' })).toBeVisible();
    }
  });
});
