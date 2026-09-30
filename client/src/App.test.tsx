// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { calculatePricing, type AnalysisRun, type PricingInput, type PropertyEnvelope } from '@ppi/shared';
import { App } from './App.js';

const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const makeRecord = (id = firstId, address = '123 Main St, Apt 2, Austin, TX 78701'): PropertyEnvelope => ({
  property: {
    id, provider: 'RENTCAST', providerPropertyId: `provider-${id}`, normalizedAddressKey: address.toLowerCase().replace(/[^a-z0-9]/g, ''),
    formattedAddress: address, addressLine1: address.split(',')[0]!, unit: 'Apt 2', city: 'Austin', state: 'TX', zipCode: '78701',
    latitude: 30.1, longitude: -97.1, propertyType: 'Condo', bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200,
    lotSizeSqft: null, yearBuilt: 2001, currentListPrice: null, refreshFailedAt: null, notes: null, userOverrides: {},
    effectiveValues: { bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, yearBuilt: 2001 },
    createdAt: '2026-09-29T12:00:00.000Z', updatedAt: '2026-09-29T12:00:00.000Z'
  },
  cache: { source: 'RENTCAST', fetchedAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-10-13T12:00:00.000Z', freshness: 'FRESH', cacheStatus: null }
});
const marketResponse = (propertyId = firstId) => ({
  propertyId,
  recordedSales: { kind: 'RECORDED_SALES', candidates: [{ id: 'recorded_sale:sale1', evidenceType: 'RECORDED_SALE', providerId: 'sale1', address: '125 Main St, Austin, TX 78701', latitude: 30.11, longitude: -97.11, propertyType: 'Condo', bedrooms: 2, bathrooms: null, livingAreaSqft: 1180, lotSizeSqft: null, yearBuilt: null, price: 410000, eventDate: '2026-06-01T00:00:00.000Z', distanceMiles: 0.91, source: 'RENTCAST' }], source: 'RENTCAST', freshness: 'FRESH', cacheStatus: 'MISS', fetchedAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-10-06T12:00:00.000Z', query: { latitude: 30.1, longitude: -97.1, radiusMiles: 2, limit: 25, saleDateRangeDays: 365 }, errorCode: null },
  activeListings: { kind: 'ACTIVE_LISTINGS', candidates: [{ id: 'active_asking_price:listing1', evidenceType: 'ACTIVE_ASKING_PRICE', providerId: 'listing1', address: '130 Main St, Austin, TX 78701', latitude: 30.12, longitude: -97.12, propertyType: 'Condo', bedrooms: null, bathrooms: 2, livingAreaSqft: null, lotSizeSqft: null, yearBuilt: null, price: 450000, eventDate: '2026-09-01T00:00:00.000Z', distanceMiles: 1.2, source: 'RENTCAST' }], source: 'RENTCAST', freshness: 'FRESH', cacheStatus: 'MISS', fetchedAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-09-30T12:00:00.000Z', query: { latitude: 30.1, longitude: -97.1, radiusMiles: 2, limit: 25, saleDateRangeDays: null }, errorCode: null }
});
const pricingResponse = (mode: 'OFFER' | 'LISTING', strategyProfile: PricingInput['strategyProfile'], maxBudget: number | null = null) => {
  const sale = (id: string, price: number, age: number, distance: number) => ({ id, providerId: id, address: `${id} Main St`,
    evidenceType: 'RECORDED_SALE' as const, propertyType: 'Condo', price, eventDate: new Date(Date.parse('2026-09-29T00:00:00.000Z') - age * 86_400_000).toISOString(),
    distanceMiles: distance, livingAreaSqft: 1200, bedrooms: 2, bathrooms: 2 });
  const input: PricingInput = { subject: { id: firstId, propertyType: 'Condo', livingAreaSqft: 1200, bedrooms: 2, bathrooms: 2,
    currentListPrice: null, overrideFields: [] }, recordedSales: [sale('a', 400000, 30, 0), sale('b', 420000, 60, 0.5), sale('c', 440000, 90, 1)],
    activeListings: [], mode, strategyProfile, maxBudget, asOf: '2026-09-29T00:00:00.000Z',
    metadata: { propertyFreshness: 'FRESH', salesFreshness: 'FRESH', listingsFreshness: 'FRESH', salesSource: 'RENTCAST',
      listingsSource: 'RENTCAST', searchRadiusMiles: 2, saleDateRangeDays: 365 } };
  return calculatePricing(input);
};
const analysisResponse = (mode: 'OFFER' | 'LISTING', strategyProfile: PricingInput['strategyProfile'], maxBudget: number | null = null): AnalysisRun => ({
  id: crypto.randomUUID(), propertyId: firstId, mode, status: 'SUCCEEDED', strategyProfile, engineVersion: 'ppi-pricing-v1',
  promptVersion: 'ppi-explanation-v1', model: 'gpt-5.6-luna', reasoningEffort: 'low',
  userInputs: mode === 'OFFER' ? { mode, strategyProfile: strategyProfile as 'BALANCED', maxBudget } : { mode, strategyProfile: strategyProfile as 'BALANCED' },
  inputSnapshot: {}, engineResult: pricingResponse(mode, strategyProfile, maxBudget),
  aiResult: { summary: 'The engine used recorded sales.', reasons: [{ claim: 'The recorded sales support the reference.', evidenceIds: ['ENGINE'] }],
    strategySteps: ['Review the range.'], assumptions: [], unknowns: [], warnings: [] },
  inputHash: 'a'.repeat(64), createdAt: '2026-09-29T12:00:00.000Z', completedAt: '2026-09-29T12:00:01.000Z',
  failureCode: null, tokenUsage: { inputTokens: 100, outputTokens: 50 }, latencyMs: 1000
});
const renderAt = (path = '/dashboard') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
    if (url.includes('/properties?')) return Response.json({ items: [], total: 0, page: 1, pageSize: 5 });
    if (url.includes('/market-context')) return Response.json(marketResponse());
    if (url.includes('/analyses') && init?.method === 'POST') { const body = JSON.parse(String(init?.body)); return Response.json(analysisResponse(body.mode, body.strategyProfile, body.maxBudget ?? null)); }
    if (url.includes('/pricing/preview')) { const body = JSON.parse(String(init?.body)); return Response.json(pricingResponse(body.mode, body.strategyProfile, body.maxBudget ?? null)); }
    if (url.includes('/assigned-schools')) return Response.json({ propertyId: firstId, status: 'ASSIGNMENT_UNAVAILABLE', schools: [], assignmentSource: null });
    if (url.includes('/nearby-places')) return Response.json({ propertyId: firstId, status: 'AVAILABLE', places: [{ id: 'grocery-1', name: 'Market One', category: 'Grocery Store', latitude: 30.11, longitude: -97.11, distanceMiles: 0.62, source: 'ARCGIS_PLACES' }], source: 'ARCGIS_PLACES', radiusMeters: 1600 });
    if (url.includes('/wildfire-context')) return Response.json({ propertyId: firstId, status: 'INSIDE_DISPLAYED_ZONE', classification: 'High', responsibilityArea: 'SRA', sourceName: 'CAL FIRE Fire Hazard Severity Zones', sourceVersion: 'effective 2024-04-01', checkedAt: '2026-09-29T12:00:00.000Z' });
    if (url.includes('/fault-context')) return Response.json({ propertyId: firstId, contextType: 'FAULT_TRACE', status: 'NEAREST_MAPPED_FAULT', nearestFeatureName: 'Serra fault', distanceMiles: 7.13, searchRadiusMiles: 20, sourceName: 'California Geological Survey 2010 Fault Activity Map — Quaternary Faults', sourceVersion: '2010 map', checkedAt: '2026-09-29T12:00:00.000Z' });
    if (url.endsWith('/properties/resolve') && init?.method === 'POST') return Response.json(makeRecord());
    return Response.json({ error: { code: 'PROPERTY_NOT_FOUND', message: 'not found', requestId: 'synthetic' } }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('Dashboard', () => {
  it('navigates to History and starts with no selected property or fixture prices', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText('No property selected')).toBeTruthy();
    expect(screen.queryByText('1847 Alder View Lane')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'History' }));
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('History empty')).toBeTruthy());
  });

  it('renders separate sale and asking evidence and synchronizes row and map selection', async () => {
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '123 Main St, Apt 2, Austin, TX 78701' })).toBeTruthy());
    await screen.findByRole('heading', { name: 'Recorded Sales' });
    expect(screen.getByRole('heading', { name: 'Active Listings' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Sold Price' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Asking Price' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Select recorded sale 125 Main/ }));
    expect(screen.getByRole('button', { name: /Recorded sale marker: 125 Main/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Active listing marker: 130 Main/ }));
    expect(screen.getByRole('row', { name: /130 Main/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Offer Price' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getAllByText('Not analyzed', { exact: true }).length).toBe(2);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/properties/resolve'))).toHaveLength(1);
  });

  it('opens saved Offer and Listing analyses with user strategy controls', async () => {
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('button', { name: 'Offer Price' });
    fireEvent.click(screen.getByRole('button', { name: 'Offer Price' }));
    const dialog = await screen.findByRole('dialog', { name: 'Offer Price Analysis' });
    await within(dialog).findByText('ppi-pricing-v1', { exact: false });
    expect(dialog.textContent).toContain('$410,000');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Strategy profile' }), { target: { value: 'COMPETITIVE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate analysis' }));
    await waitFor(() => expect(dialog.textContent).toContain('$420,000'));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Maximum budget' }), { target: { value: '415000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate analysis' }));
    await waitFor(() => expect(dialog.textContent).toContain('$415,000'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Listing Price' }));
    const listing = await screen.findByRole('dialog', { name: 'Listing Price Analysis' });
    fireEvent.change(within(listing).getByRole('combobox', { name: 'Strategy profile' }), { target: { value: 'TEST_MARKET' } });
    fireEvent.click(within(listing).getByRole('button', { name: 'Generate analysis' }));
    await waitFor(() => expect(listing.textContent).toContain('$420,000'));
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/analyses')).length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the engine price visible when the AI explanation fails', async () => {
    const baseFetch = fetchMock.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/analyses') && init?.method === 'POST') return Promise.resolve(Response.json({
        ...analysisResponse('OFFER', 'BALANCED'), status: 'FAILED', aiResult: null, failureCode: 'MODEL_TIMEOUT'
      }));
      return baseFetch(input, init);
    });
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Offer Price' }));
    const dialog = await screen.findByRole('dialog', { name: 'Offer Price Analysis' });
    await within(dialog).findByText('Explanation unavailable. The deterministic price remains available.');
    expect(dialog.textContent).toContain('$410,000');
    expect(dialog.textContent).toContain('failed');
  });

  it('switches one map context at a time and turns the active layer off', async () => {
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const schools = await screen.findByRole('button', { name: 'Schools' });
    const grocery = screen.getByRole('button', { name: 'Grocery' });
    fireEvent.click(schools);
    expect(schools.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Assigned Schools' })).toBeTruthy();
    await screen.findByText('Assigned school information is unavailable for this property.');
    expect(screen.queryByRole('button', { name: /Assigned school marker/ })).toBeNull();
    fireEvent.click(grocery);
    expect(schools.getAttribute('aria-pressed')).toBe('false');
    expect(grocery.getAttribute('aria-pressed')).toBe('true');
    const groceryMarker = await screen.findByRole('button', { name: 'Grocery marker: Market One' });
    fireEvent.click(groceryMarker);
    expect(groceryMarker.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Select grocery Market One' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(grocery);
    expect(grocery.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Grocery marker: Market One' })).toBeNull();
    expect(screen.getByRole('button', { name: /Recorded sale marker: 125 Main/ })).toBeTruthy();
  });

  it('synchronizes verified assigned-school list and marker selection without using nearby schools', async () => {
    const baseFetch = fetchMock.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => String(input).includes('/assigned-schools')
      ? Promise.resolve(Response.json({ propertyId: firstId, status: 'AVAILABLE', assignmentSource: 'VERIFIED_PROVIDER', schools: [{ id: 'school:one', assignmentLevel: 'ELEMENTARY', sourceSchoolId: 'one', name: 'Oak Elementary', district: 'Austin ISD', city: 'Austin', latitude: 30.11, longitude: -97.11, grades: 'K–5', schoolType: 'Public', distanceMiles: 0.9, assignmentSource: 'VERIFIED_PROVIDER', metadataSource: 'REFERENCE', matchStatus: 'EXACT_ID' }] }))
      : baseFetch(input, init));
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Schools' }));
    const schoolRow = await screen.findByRole('button', { name: 'Select assigned school Oak Elementary' });
    fireEvent.click(schoolRow);
    expect(screen.getByRole('button', { name: 'Assigned school marker: Oak Elementary' }).getAttribute('aria-pressed')).toBe('true');
    expect(schoolRow.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /Grocery marker/ })).toBeNull();
  });

  it('switches official wildfire polygons and fault traces while retaining core candidates', async () => {
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Wildfire' }));
    await screen.findByText('Subject point intersects a displayed High Fire Hazard Severity Zone.');
    expect(screen.getByText('effective 2024-04-01')).toBeTruthy();
    expect(screen.getAllByTestId('government-overlay')).toHaveLength(2);
    expect(screen.getByText('Map context is informational and is not an engineering, insurance, or hazard assessment.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Faults' }));
    await screen.findByText('Serra fault');
    expect(screen.getByText('7.13 mi')).toBeTruthy();
    expect(screen.getAllByTestId('government-overlay')).toHaveLength(1);
    expect(screen.getByText('CGS mapped Quaternary fault traces, 2010')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Recorded sale marker: 125 Main/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Faults' }));
    expect(screen.queryByTestId('government-overlay')).toBeNull();
  });

  it('keeps the Dashboard usable when map coordinates are unavailable', async () => {
    window.history.replaceState({}, '', '/dashboard?mapUnavailableMode=1');
    fetchMock.mockImplementation(async (input: string) => {
      if (String(input).endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
      if (String(input).includes('/market-context')) return Response.json(marketResponse());
      const value = makeRecord();
      value.property.latitude = null;
      value.property.longitude = null;
      return Response.json(value);
    });
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Map unavailable. Property and market evidence remain available.');
    expect(screen.getByRole('heading', { name: '123 Main St, Apt 2, Austin, TX 78701' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Comparable Candidates' })).toBeTruthy();
  });

  it('keeps a late A response from replacing the newer B search', async () => {
    let resolveA: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input).endsWith('/health/live')) return Promise.resolve(Response.json({ status: 'live', requestId: 'synthetic' }));
      const address = JSON.parse(String(init?.body)).address as string;
      if (address.startsWith('111')) return new Promise<Response>(resolve => { resolveA = resolve; });
      return Promise.resolve(Response.json(makeRecord(secondId, '222 Oak Ave, Apt 2, Austin, TX 78701')));
    });
    renderAt();
    const input = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(input, { target: { value: '111 Pine St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText('Loading property')).toBeTruthy();
    fireEvent.change(input, { target: { value: '222 Oak Ave, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: '222 Oak Ave, Apt 2, Austin, TX 78701' });
    resolveA?.(Response.json(makeRecord(firstId, '111 Pine St, Apt 2, Austin, TX 78701')));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '111 Pine St, Apt 2, Austin, TX 78701' })).toBeNull());
  });

  it('does not attach late A market evidence to B after switching subjects', async () => {
    let resolveMarketA: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health/live')) return Promise.resolve(Response.json({ status: 'live', requestId: 'synthetic' }));
      if (url.includes(`${firstId}/market-context`)) return new Promise<Response>(resolve => { resolveMarketA = resolve; });
      if (url.includes(`${secondId}/market-context`)) {
        const response = marketResponse(secondId);
        response.recordedSales.candidates[0]!.address = 'B Comparable, Austin, TX 78701';
        return Promise.resolve(Response.json(response));
      }
      const address = JSON.parse(String(init?.body)).address as string;
      return Promise.resolve(Response.json(address.startsWith('111') ? makeRecord(firstId, '111 Pine St, Apt 2, Austin, TX 78701') : makeRecord(secondId, '222 Oak Ave, Apt 2, Austin, TX 78701')));
    });
    renderAt();
    const input = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(input, { target: { value: '111 Pine St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: '111 Pine St, Apt 2, Austin, TX 78701' });
    await waitFor(() => expect(resolveMarketA).toBeDefined());
    fireEvent.change(input, { target: { value: '222 Oak Ave, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: '222 Oak Ave, Apt 2, Austin, TX 78701' });
    await screen.findByRole('button', { name: /Select recorded sale B Comparable/ });
    const late = marketResponse(firstId);
    late.recordedSales.candidates[0]!.address = 'A Comparable, Austin, TX 78701';
    resolveMarketA?.(Response.json(late));
    await waitFor(() => expect(screen.queryByText('A Comparable, Austin, TX 78701')).toBeNull());
    expect(screen.getByRole('button', { name: /Select recorded sale B Comparable/ })).toBeTruthy();
  });

  it('shows server and property errors without substituting demo data', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (String(input).endsWith('/health/live')) throw new Error('server down');
      throw new Error('server down');
    });
    renderAt();
    await screen.findByText('API: unavailable');
    const input = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(input, { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Search failed');
    expect(screen.queryByText('1847 Alder View Lane')).toBeNull();
  });
});

describe('History', () => {
  it('shows separate Offer and Listing versions and opens a frozen run without regeneration', async () => {
    const offer = analysisResponse('OFFER', 'BALANCED');
    const listing = analysisResponse('LISTING', 'BALANCED');
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
      if (url.includes('/properties?')) return Response.json({ items: [makeRecord()], total: 1, page: 1, pageSize: 5 });
      if (url.endsWith(`/properties/${firstId}/analyses`)) return Response.json({ items: [offer, listing], total: 2 });
      return Response.json({ error: { code: 'REQUEST_FAILED', message: 'failed', requestId: 'synthetic' } }, { status: 500 });
    });
    renderAt('/history');
    await screen.findByText('Analysis versions');
    const detail = screen.getByRole('complementary', { name: 'Selected Record Details' });
    expect(detail.textContent).toContain('Latest Offer Analysis');
    expect(detail.textContent).toContain('Latest Listing Analysis');
    fireEvent.click(within(detail).getAllByRole('button', { name: 'View Analysis' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Offer Price Analysis' });
    expect(dialog.textContent).toContain(offer.id);
    expect(dialog.textContent).toContain('$410,000');
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST' && String(call[0]).includes('/analyses'))).toBe(false);
  });

  it('shows loading, then empty, and handles list errors', async () => {
    let complete: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation((input: string) => String(input).endsWith('/health/live') ? Promise.resolve(Response.json({ status: 'live', requestId: 'synthetic' })) : new Promise<Response>(resolve => { complete = resolve; }));
    const view = renderAt('/history');
    expect(screen.getByText('Loading history')).toBeTruthy();
    complete?.(Response.json({ items: [], total: 0, page: 1, pageSize: 5 }));
    await screen.findByText('History empty');
    view.unmount();
    fetchMock.mockImplementation(async (input: string) => String(input).endsWith('/health/live') ? Response.json({ status: 'live', requestId: 'synthetic' }) : Response.json({ error: { code: 'REQUEST_FAILED', message: 'failed', requestId: 'synthetic' } }, { status: 503 }));
    renderAt('/history');
    await screen.findByText('History unavailable');
  });

  it('selects a saved row and sends only edited notes and overrides', async () => {
    const first = makeRecord();
    const second = makeRecord(secondId, '222 Oak Ave, Apt 2, Austin, TX 78701');
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (String(input).endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
      if (String(input).includes('/properties?')) return Response.json({ items: [first, second], total: 2, page: 1, pageSize: 5 });
      if (init?.method === 'PATCH') return Response.json(second);
      return Response.json({ error: { code: 'REQUEST_FAILED', message: 'failed', requestId: 'synthetic' } }, { status: 500 });
    });
    renderAt('/history');
    const row = await screen.findByRole('row', { name: /222 Oak Ave/ });
    fireEvent.click(within(row).getByRole('button', { name: 'View' }));
    const detail = screen.getByRole('complementary', { name: 'Selected Record Details' });
    expect(detail.textContent).toContain('222 Oak Ave');
    fireEvent.change(within(detail).getByRole('textbox', { name: 'Notes' }), { target: { value: 'Check disclosures' } });
    fireEvent.change(within(detail).getByRole('spinbutton', { name: /Living area/ }), { target: { value: '1300' } });
    fireEvent.click(within(detail).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === 'PATCH')).toBe(true));
    const patchCall = fetchMock.mock.calls.find(call => call[1]?.method === 'PATCH');
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ notes: 'Check disclosures', overrides: { livingAreaSqft: 1300 } });
  });
});
