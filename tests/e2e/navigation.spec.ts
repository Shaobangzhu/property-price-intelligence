import { test, expect } from '@playwright/test';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const address = '123 Main St, Apt 2, Austin, TX 78701';
const makeRecord = () => ({
  property: {
    id, provider: 'RENTCAST', providerPropertyId: 'synthetic-provider-id', normalizedAddressKey: '123mainstunit2austintx78701',
    formattedAddress: address, addressLine1: '123 Main St', unit: 'Apt 2', city: 'Austin', state: 'TX', zipCode: '78701',
    latitude: 30.1, longitude: -97.1, propertyType: 'Condo', bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, lotSizeSqft: null,
    yearBuilt: 2001, currentListPrice: null, refreshFailedAt: null, notes: null as string | null, userOverrides: {},
    effectiveValues: { bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, yearBuilt: 2001 },
    createdAt: '2026-09-29T12:00:00.000Z', updatedAt: '2026-09-29T12:00:00.000Z'
  },
  cache: { source: 'RENTCAST', fetchedAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-10-13T12:00:00.000Z', freshness: 'FRESH', cacheStatus: 'MISS' as string | null }
});

test('searches a subject and manages its saved History record without external calls', async ({ page }) => {
  let record = makeRecord();
  let saved = false;
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:5173/') ? route.continue() : route.abort());
  await page.route('**/api/health/live', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'live', requestId: 'synthetic' }) }));
  await page.route(/\/api\/properties(?:\/|\?|$)/, async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let status = 200;
    let body: unknown;
    if (url.pathname.endsWith('/resolve') && method === 'POST') { saved = true; body = record; }
    else if (url.pathname.endsWith('/refresh') && method === 'POST') { record.cache.cacheStatus = 'REFRESHED'; body = record; }
    else if (method === 'PATCH') { record.property.notes = (route.request().postDataJSON() as { notes: string }).notes; body = record; }
    else if (method === 'DELETE') { saved = false; status = 204; body = null; }
    else if (url.pathname.endsWith('/properties')) body = { items: saved ? [record] : [], total: saved ? 1 : 0, page: 1, pageSize: 5 };
    else body = record;
    await route.fulfill({ status, contentType: 'application/json', body: body === null ? '' : JSON.stringify(body) });
  });
  await page.goto('/');
  await expect(page.getByText('No property selected')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search a property address' }).fill(address);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: address })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Offer Price' })).toBeDisabled();
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await page.getByRole('row', { name: /123 Main St/ }).getByRole('button', { name: 'View' }).click();
  const detail = page.getByRole('complementary', { name: 'Selected Record Details' });
  await expect(detail).toContainText(address);
  await detail.getByRole('textbox', { name: 'Notes' }).fill('Check disclosures');
  await detail.getByRole('button', { name: 'Save changes' }).click();
  await expect(detail.getByRole('textbox', { name: 'Notes' })).toHaveValue('Check disclosures');
  await page.getByRole('row', { name: /123 Main St/ }).getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('row', { name: /123 Main St/ })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('row', { name: /123 Main St/ }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('History empty')).toBeVisible();
});
