import { test, expect } from '@playwright/test';
test('navigates placeholders with mocked liveness', async ({ page }) => {
  await page.route('**/api/health/live', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'live', requestId: 'synthetic' }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('available');
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
});
