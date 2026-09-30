import { test, expect } from '@playwright/test';
import { calculatePricing, type PricingInput } from '@ppi/shared';

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
const market = () => ({ propertyId: id,
  recordedSales: { kind: 'RECORDED_SALES', candidates: [{ id: 'recorded_sale:one', evidenceType: 'RECORDED_SALE', providerId: 'one', address: '125 Main St, Austin, TX 78701', latitude: 30.11, longitude: -97.11, propertyType: 'Condo', bedrooms: 2, bathrooms: 2, livingAreaSqft: 1180, lotSizeSqft: null, yearBuilt: null, price: 410000, eventDate: '2026-06-01T00:00:00.000Z', distanceMiles: 0.91, source: 'RENTCAST' }], source: 'RENTCAST', freshness: 'FRESH', cacheStatus: 'MISS', fetchedAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-10-06T12:00:00.000Z', query: { latitude: 30.1, longitude: -97.1, radiusMiles: 2, limit: 25, saleDateRangeDays: 365 }, errorCode: null },
  activeListings: { kind: 'ACTIVE_LISTINGS', candidates: [{ id: 'active_asking_price:two', evidenceType: 'ACTIVE_ASKING_PRICE', providerId: 'two', address: '130 Main St, Austin, TX 78701', latitude: 30.12, longitude: -97.12, propertyType: 'Condo', bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, lotSizeSqft: null, yearBuilt: null, price: 450000, eventDate: '2026-09-01T00:00:00.000Z', distanceMiles: 1.2, source: 'RENTCAST' }], source: 'RENTCAST', freshness: 'FRESH', cacheStatus: 'MISS', fetchedAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-09-30T12:00:00.000Z', query: { latitude: 30.1, longitude: -97.1, radiusMiles: 2, limit: 25, saleDateRangeDays: null }, errorCode: null } });
const pricing = (): PricingInput => ({ subject: { id, propertyType: 'Condo', livingAreaSqft: 1200, bedrooms: 2, bathrooms: 2, currentListPrice: null, overrideFields: [] },
  recordedSales: [], activeListings: [], mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: null, asOf: '2026-09-29T12:00:00.000Z',
  metadata: { propertyFreshness: 'FRESH', salesFreshness: 'FRESH', listingsFreshness: 'FRESH', salesSource: 'RENTCAST', listingsSource: 'RENTCAST', searchRadiusMiles: 2, saleDateRangeDays: 365 } });

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
    else if (url.pathname.endsWith('/market-context')) body = market();
    else if (url.pathname.endsWith('/assigned-schools')) body = { propertyId: id, status: 'ASSIGNMENT_UNAVAILABLE', schools: [], assignmentSource: null };
    else if (url.pathname.endsWith('/nearby-places')) body = { propertyId: id, status: 'AVAILABLE', places: [{ id: 'grocery-1', name: 'Market One', category: 'Grocery Store', latitude: 30.11, longitude: -97.11, distanceMiles: 0.62, source: 'ARCGIS_PLACES' }], source: 'ARCGIS_PLACES', radiusMeters: 1600 };
    else if (url.pathname.endsWith('/wildfire-context')) body = { propertyId: id, status: 'INSIDE_DISPLAYED_ZONE', classification: 'High', responsibilityArea: 'SRA', sourceName: 'CAL FIRE Fire Hazard Severity Zones', sourceVersion: 'effective 2024-04-01', checkedAt: '2026-09-29T12:00:00.000Z' };
    else if (url.pathname.endsWith('/fault-context')) body = { propertyId: id, contextType: 'FAULT_TRACE', status: 'NEAREST_MAPPED_FAULT', nearestFeatureName: 'Serra fault', distanceMiles: 7.13, searchRadiusMiles: 20, sourceName: 'California Geological Survey 2010 Fault Activity Map — Quaternary Faults', sourceVersion: '2010 map', checkedAt: '2026-09-29T12:00:00.000Z' };
    else if (url.pathname.endsWith('/pricing/preview')) body = calculatePricing(pricing());
    else if (url.pathname.endsWith('/refresh') && method === 'POST') { record.cache.cacheStatus = 'REFRESHED'; body = record; }
    else if (method === 'PATCH') { record.property.notes = (route.request().postDataJSON() as { notes: string }).notes; body = record; }
    else if (method === 'DELETE') { saved = false; status = 204; body = null; }
    else if (url.pathname.endsWith('/properties')) body = { items: saved ? [record] : [], total: saved ? 1 : 0, page: 1, pageSize: 5 };
    else body = record;
    await route.fulfill({ status, contentType: 'application/json', body: body === null ? '' : JSON.stringify(body) });
  });
  await page.goto('/dashboard?mapTestMode=1');
  await expect(page.getByText('No property selected')).toBeVisible();
  await expect(page.getByText('API: available')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search a property address' }).fill(address);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: address })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Sold Price' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Asking Price' })).toBeVisible();
  await page.getByRole('button', { name: /Select recorded sale 125 Main/ }).click();
  await expect(page.getByRole('button', { name: /Recorded sale marker: 125 Main/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Active listing marker: 130 Main/ }).click();
  await expect(page.getByRole('row', { name: /130 Main St/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Schools', exact: true }).click();
  await expect(page.getByText('Assigned school information is unavailable for this property.')).toBeVisible();
  await page.getByRole('button', { name: 'Grocery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Schools', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Grocery marker: Market One' }).click();
  await expect(page.getByRole('button', { name: 'Select grocery Market One' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Grocery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grocery marker: Market One' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Recorded sale marker: 125 Main/ })).toBeVisible();
  await page.getByRole('button', { name: 'Wildfire', exact: true }).click();
  await expect(page.getByText('Subject point intersects a displayed High Fire Hazard Severity Zone.')).toBeVisible();
  await expect(page.getByTestId('government-overlay')).toHaveCount(2);
  await page.getByRole('button', { name: 'Faults', exact: true }).click();
  await expect(page.getByText('Serra fault')).toBeVisible();
  await expect(page.getByTestId('government-overlay')).toHaveCount(1);
  await page.getByRole('button', { name: 'Faults', exact: true }).click();
  await expect(page.getByTestId('government-overlay')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Recorded sale marker: 125 Main/ })).toBeVisible();
  await page.getByRole('button', { name: 'Offer Price' }).click();
  const pricingDialog = page.getByRole('dialog', { name: 'Offer Price Analysis' });
  await expect(pricingDialog.getByText('Insufficient evidence', { exact: true })).toBeVisible();
  await expect(pricingDialog.getByText('Not available', { exact: true }).first()).toBeVisible();
  await pricingDialog.getByRole('button', { name: 'Close dialog' }).click();
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
