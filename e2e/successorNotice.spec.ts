import { expect, test } from '@playwright/test';
import { start } from './helpers';

test('legacy app clearly points to Repertoire 2 without redirecting or touching the active workspace', async ({ page }) => {
  await page.goto('/');
  const notice = page.getByRole('complementary', { name: 'Newer version of Repertoire available' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('remains available');
  await expect(notice).toContainText('will no longer receive updates');
  await expect(notice).toContainText('data is not moved automatically');
  const link = notice.getByRole('link', { name: 'Open Repertoire 2' });
  await expect(link).toHaveAttribute('href', 'https://zeddyfree-art.github.io/repertoire2/');
  await expect(link).toHaveAttribute('target', '_blank');
  await start(page);
  await expect(notice).toBeVisible();
  await expect(page.locator('.topbar')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
