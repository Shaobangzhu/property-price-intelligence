import { test, expect } from '@playwright/test';
test('Dashboard offer dialog and History record selection use fixtures only', async ({ page }) => {
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:5173/') ? route.continue() : route.abort());
  await page.route('**/api/health/live', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'live', requestId: 'synthetic' }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('API: available')).toBeVisible();
  await page.getByRole('button', { name: 'Offer Price' }).click();
  await expect(page.getByRole('dialog', { name: 'Offer Price Analysis' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('row', { name: /901 Cedar Row/ }).click();
  await expect(page.getByRole('complementary', { name: 'Selected Record Details' })).toContainText('901 Cedar Row');
});
