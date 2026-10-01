import { test, expect, type Locator, type Page } from '@playwright/test';
import { DEMO_ADDRESS, DEMO_ID, DEMO_SUMMARY, SECOND_ADDRESS, installMockApi } from './support/mock-api.js';

async function search(page: Page, address = DEMO_ADDRESS) {
  await page.getByRole('textbox', { name: 'Search a property address' }).fill(address);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}
async function assertPrice(dialog: Locator, expected = '$800,000') {
  await expect(dialog.locator('.highlight-summary strong')).toHaveText(expected);
  await expect(dialog.locator('.analysis-summary-row').getByText('$780,000 – $820,000', { exact: true })).toBeVisible();
}
async function assertCoreMarkers(page: Page) {
  await expect(page.getByRole('img', { name: `Subject property marker: ${DEMO_ADDRESS}` })).toBeVisible();
  await expect(page.getByRole('button', { name: /Recorded sale marker: 1801 Synthetic/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Active listing marker: 1804 Synthetic/ })).toBeVisible();
}

test('complete synthetic core workflow: contexts, deterministic Offer and Listing, exact History reopen, and CRUD', async ({ page }) => {
  const mock = await installMockApi(page);
  await test.step('1–3: Dashboard search and persisted subject summary', async () => {
    await page.goto('/dashboard?mapTestMode=1');
    await expect(page.getByText('No property selected')).toBeVisible();
    await search(page);
    await expect(page.getByRole('heading', { name: DEMO_ADDRESS })).toBeVisible();
    await expect(page.getByText('2,000 sqft', { exact: true }).first()).toBeVisible();
  });
  await test.step('4–6: recorded sales and bidirectional table/map selection', async () => {
    await expect(page.getByRole('columnheader', { name: 'Sold Price' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Asking Price' })).toBeVisible();
    await page.getByRole('button', { name: /Select recorded sale 1801 Synthetic/ }).click();
    await expect(page.getByRole('button', { name: /Recorded sale marker: 1801 Synthetic/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /Active listing marker: 1804 Synthetic/ }).click();
    await expect(page.getByRole('row', { name: /1804 Synthetic/ })).toHaveAttribute('aria-selected', 'true');
  });
  await test.step('7–11: all four exclusive contexts preserve core markers', async () => {
    await page.getByRole('button', { name: 'Schools', exact: true }).click();
    await expect(page.getByText('The school-assignment source returned no assignment information for this property.')).toBeVisible();
    await page.getByRole('button', { name: 'Grocery', exact: true }).click();
    await page.getByRole('button', { name: 'Grocery marker: Synthetic Demo Grocery' }).click();
    await expect(page.getByRole('button', { name: 'Select grocery Synthetic Demo Grocery' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Wildfire', exact: true }).click();
    await expect(page.getByText('Subject point intersects a displayed High Fire Hazard Severity Zone.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grocery marker: Synthetic Demo Grocery' })).toHaveCount(0);
    await expect(page.getByTestId('government-overlay')).toHaveCount(2);
    await page.getByRole('button', { name: 'Faults', exact: true }).click();
    await expect(page.getByText('Synthetic mapped fault trace', { exact: true })).toBeVisible();
    await expect(page.getByTestId('government-overlay')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Map context' }).locator('[aria-pressed="true"]')).toHaveCount(1);
    await assertCoreMarkers(page);
    await page.getByRole('button', { name: 'Faults', exact: true }).click();
    await expect(page.getByTestId('government-overlay')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Map context' }).locator('[aria-pressed="true"]')).toHaveCount(0);
  });
  let offerId: string;
  let listingId: string;
  await test.step('12–15: saved Offer, deterministic numbers, prepared explanation, Escape/focus restoration', async () => {
    const opener = page.getByRole('button', { name: 'Offer Price', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Offer Price Analysis' });
    await assertPrice(dialog);
    await expect(dialog.getByText(DEMO_SUMMARY)).toBeVisible();
    await expect(dialog.getByText(/Price calculated by PPI pricing engine; explanation AI-assisted/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    offerId = mock.runs.find(run => run.mode === 'OFFER')!.id;
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  });
  await test.step('16: saved Listing analysis', async () => {
    await page.getByRole('button', { name: 'Listing Price', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Listing Price Analysis' });
    await assertPrice(dialog);
    await expect(dialog.getByText(DEMO_SUMMARY)).toBeVisible();
    listingId = mock.runs.find(run => run.mode === 'LISTING')!.id;
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
  });
  await test.step('17–20: History selects subject and reopens frozen Offer and Listing after source refresh', async () => {
    await page.getByRole('link', { name: 'History', exact: true }).click();
    const row = page.getByRole('row', { name: /1847 Synthetic Alder/ });
    await row.getByRole('button', { name: 'View', exact: true }).click();
    const detail = page.getByRole('complementary', { name: 'Selected Record Details' });
    await expect(detail.getByText('Analysis versions', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(detail.getByText('2,400 sqft', { exact: true })).toBeVisible();
    for (const [mode, id] of [['Offer', offerId], ['Listing', listingId]] as const) {
      await detail.locator('.detail-analysis').filter({ hasText: `Latest ${mode} Analysis` }).getByRole('button', { name: 'View Analysis' }).click();
      const dialog = page.getByRole('dialog', { name: `${mode} Price Analysis` });
      await assertPrice(dialog);
      await expect(dialog.getByText(DEMO_SUMMARY)).toBeVisible();
      await expect(dialog.getByText(`Run ${id}`, { exact: false })).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: 'Strategy profile' })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Close dialog' }).click();
    }
    expect(mock.stats.analysisGenerations).toBe(2);
    expect(mock.stats.analysisRequests).toBe(2);
  });
  await test.step('21: return Dashboard; then edit/delete only the selected saved property', async () => {
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'History', exact: true }).click();
    const detail = page.getByRole('complementary', { name: 'Selected Record Details' });
    const fetchedAt = mock.records.get(DEMO_ID)!.cache.fetchedAt;
    await detail.getByRole('textbox', { name: 'Notes', exact: true }).fill('Synthetic demo: review disclosures');
    await detail.getByRole('button', { name: 'Save changes' }).click();
    await expect(detail.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(mock.records.get(DEMO_ID)!.cache.fetchedAt).toBe(fetchedAt);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('row', { name: /1847 Synthetic Alder/ }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('History empty')).toBeVisible();
    expect(mock.runs).toHaveLength(0);
  });
  expect(mock.stats.blockedExternalRequests).toBe(0);
  expect(mock.stats.unhandledApiRequests).toEqual([]);
});

test('context and explanation outages preserve deterministic pricing and the core map', async ({ page }) => {
  const mock = await installMockApi(page, { contextFailures: true, aiFailure: true });
  await page.goto('/dashboard?mapTestMode=1');
  await search(page);
  for (const [layer, message] of [['Schools', 'School request failed'], ['Grocery', 'Grocery unavailable'], ['Wildfire', 'Data unavailable from CAL FIRE.'], ['Faults', 'Data unavailable from California Geological Survey.']]) {
    await page.getByRole('button', { name: layer!, exact: true }).click();
    await expect(page.getByText(message!, { exact: true })).toBeVisible();
    await assertCoreMarkers(page);
  }
  await page.getByRole('button', { name: 'Offer Price', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Offer Price Analysis' });
  await assertPrice(dialog);
  await expect(dialog.getByText('Explanation unavailable. The deterministic price remains available.')).toBeVisible();
  expect(mock.stats.blockedExternalRequests).toBe(0);
});

test('insufficient evidence and unavailable basemap preserve useful property UI', async ({ page }) => {
  await installMockApi(page, { insufficient: true });
  await page.goto('/dashboard?mapUnavailableMode=1');
  await search(page);
  await expect(page.getByText('Map unavailable. Property and market evidence remain available.')).toBeVisible();
  await page.getByRole('button', { name: 'Offer Price', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Offer Price Analysis' });
  await expect(dialog.getByText('Insufficient evidence', { exact: true })).toBeVisible();
  await expect(dialog.locator('.highlight-summary strong')).toHaveText('Not available');
});

for (const code of ['PROVIDER_UNAVAILABLE', 'PROVIDER_MALFORMED', 'DATABASE_UNAVAILABLE'] as const) {
  test(`${code} displays a recoverable search error with no fixture substitution`, async ({ page }) => {
    const mock = await installMockApi(page, { resolveFailure: code });
    await page.goto('/dashboard?mapTestMode=1');
    await search(page);
    await expect(page.getByRole('heading', { name: DEMO_ADDRESS })).toHaveCount(0);
    await expect(page.getByRole('alert')).toBeVisible();
    expect(mock.records.size).toBe(0);
    expect(mock.stats.resolveRequests).toBe(1);
  });
}

test('late subject A and rapid context switching cannot replace subject B or current context', async ({ page }) => {
  let releaseFirst: (() => void) | undefined;
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  let delayFirst = true;
  const mock = await installMockApi(page, { beforeResponse: async (path, payload) => {
    if (path.endsWith('/resolve') && (payload as { address: string }).address === DEMO_ADDRESS && delayFirst) { delayFirst = false; await first; }
  } });
  await page.goto('/dashboard?mapTestMode=1');
  await search(page);
  await search(page, SECOND_ADDRESS);
  await expect(page.getByRole('heading', { name: SECOND_ADDRESS })).toBeVisible();
  releaseFirst!();
  await expect.poll(() => mock.stats.completedApiRequests.filter(path => path.endsWith('/resolve')).length).toBe(2);
  await expect(page.getByRole('heading', { name: DEMO_ADDRESS })).toHaveCount(0);
  await page.getByRole('button', { name: 'Grocery', exact: true }).click();
  await page.getByRole('button', { name: 'Wildfire', exact: true }).click();
  await page.getByRole('button', { name: 'Faults', exact: true }).click();
  await expect(page.getByText('Synthetic mapped fault trace', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grocery marker: Synthetic Demo Grocery' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Map context' }).locator('[aria-pressed="true"]')).toHaveCount(1);
});

function deferred() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('late comparable evidence and context responses are discarded when the selected property changes', async ({ page }) => {
  const market = deferred(), grocery = deferred();
  let marketStarted = false, groceryStarted = false;
  const mock = await installMockApi(page, { beforeResponse: async path => {
    if (path === `/api/properties/${DEMO_ID}/market-context`) { marketStarted = true; await market.promise; }
    if (path === `/api/properties/${DEMO_ID}/nearby-places`) { groceryStarted = true; await grocery.promise; }
  } });
  await page.goto('/dashboard');
  await search(page);
  await expect(page.getByRole('heading', { name: DEMO_ADDRESS })).toBeVisible();
  await expect.poll(() => marketStarted).toBe(true);
  await page.getByRole('button', { name: 'Grocery', exact: true }).click();
  await expect.poll(() => groceryStarted).toBe(true);
  await search(page, SECOND_ADDRESS);
  await expect(page.getByRole('heading', { name: SECOND_ADDRESS })).toBeVisible();
  await expect(page.getByRole('button', { name: /Recorded sale marker: 2801 Synthetic/ })).toBeVisible();
  await page.getByRole('button', { name: 'Grocery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grocery marker: Synthetic Crescent Grocery' })).toBeVisible();
  market.release(); grocery.release();
  await expect.poll(() => mock.stats.completedApiRequests.includes(`/api/properties/${DEMO_ID}/market-context`)).toBe(true);
  await expect.poll(() => mock.stats.completedApiRequests.includes(`/api/properties/${DEMO_ID}/nearby-places`)).toBe(true);
  await expect(page.getByRole('button', { name: /Recorded sale marker: 1801 Synthetic/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Grocery marker: Synthetic Demo Grocery' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Grocery marker: Synthetic Crescent Grocery' })).toBeVisible();
});

for (const mode of ['Offer', 'Listing']) {
  test(`late ${mode} analysis cannot reopen over a newly selected property`, async ({ page }) => {
    const analysis = deferred();
    let analysisStarted = false;
    const mock = await installMockApi(page, { beforeResponse: async path => {
      if (path === `/api/properties/${DEMO_ID}/analyses`) { analysisStarted = true; await analysis.promise; }
    } });
    await page.goto('/dashboard');
    await search(page);
    await page.getByRole('button', { name: `${mode} Price`, exact: true }).click();
    await expect.poll(() => analysisStarted).toBe(true);
    await page.getByRole('dialog', { name: `${mode} Price Analysis` }).getByRole('button', { name: 'Close dialog' }).click();
    await search(page, SECOND_ADDRESS);
    await expect(page.getByRole('heading', { name: SECOND_ADDRESS })).toBeVisible();
    analysis.release();
    await expect.poll(() => mock.stats.completedApiRequests.includes(`/api/properties/${DEMO_ID}/analyses`)).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: SECOND_ADDRESS })).toBeVisible();
    expect(mock.stats.analysisRequests).toBe(1);
  });
}
