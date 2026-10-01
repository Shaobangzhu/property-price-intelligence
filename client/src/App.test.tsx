// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { calculatePricing, type AnalysisRun, type PricingInput, type PropertyEnvelope } from '@ppi/shared';
import { App } from './App.js';
import { PricingAnalysisDialog } from './features/pricing/PricingAnalysisDialog.js';
import { AssignedSchoolsService } from '../../server/src/context/schools.js';
import type { PropertyRepository } from '../../server/src/properties/repository.js';

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
const analysisSummary = (run: AnalysisRun) => ({
  id: run.id, propertyId: run.propertyId, mode: run.mode, status: run.status, strategyProfile: run.strategyProfile,
  engineVersion: run.engineVersion, promptVersion: run.promptVersion, model: run.model, reasoningEffort: run.reasoningEffort,
  createdAt: run.createdAt, completedAt: run.completedAt, failureCode: run.failureCode,
  suggestedPrice: run.mode === 'OFFER' ? run.engineResult.offerResult?.suggestedPrice ?? null : run.engineResult.listingResult?.suggestedPrice ?? null
});
const analysisPage = (runs: AnalysisRun[], total = runs.length, page = 1) => ({ items: runs.map(analysisSummary), total, page, pageSize: 20, latestOffer: runs.find(run => run.mode === 'OFFER') ? analysisSummary(runs.find(run => run.mode === 'OFFER')!) : null, latestListing: runs.find(run => run.mode === 'LISTING') ? analysisSummary(runs.find(run => run.mode === 'LISTING')!) : null });
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
  it('starts with subject only, keeps independent market toggles, and preserves evidence and pricing', async () => {
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('button', { name: /Select recorded sale 125 Main/ });
    const sales = screen.getByRole('button', { name: 'Recorded Sales' });
    const listings = screen.getByRole('button', { name: 'Active Listings' });
    const legend = screen.getByRole('group', { name: 'Visible map layers' });
    expect(sales.getAttribute('aria-pressed')).toBe('false');
    expect(listings.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: /Recorded sale marker/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Active listing marker/ })).toBeNull();
    expect(legend.textContent).toBe('Map markersSubject Property');
    fireEvent.click(screen.getByRole('button', { name: /Select recorded sale 125 Main/ }));
    expect(sales.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('row', { name: /125 Main/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(sales);
    expect(screen.getByRole('button', { name: /Recorded sale marker/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(listings);
    expect(screen.getByRole('button', { name: /Active listing marker/ })).toBeTruthy();
    fireEvent.click(sales);
    expect(screen.queryByRole('button', { name: /Recorded sale marker/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Active listing marker/ })).toBeTruthy();
    expect(legend.textContent).not.toContain('Recorded Sales');
    fireEvent.click(listings);
    const evidenceCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/market-context')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Offer Price' }));
    const firstDialog = await screen.findByRole('dialog', { name: 'Offer Price Analysis' });
    await within(firstDialog).findByText('$410,000');
    const firstInputs = JSON.parse(String(fetchMock.mock.calls.find(call => String(call[0]).includes('/analyses') && call[1]?.method === 'POST')![1]?.body));
    fireEvent.click(within(firstDialog).getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(sales);
    fireEvent.click(listings);
    expect(screen.getByRole('button', { name: /Select recorded sale 125 Main/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Select active listing 130 Main/ })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/market-context'))).toHaveLength(evidenceCalls);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/analyses') && call[1]?.method === 'POST')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Offer Price' }));
    const secondDialog = await screen.findByRole('dialog', { name: 'Offer Price Analysis' });
    await within(secondDialog).findByText('$410,000');
    const analysisCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/analyses') && call[1]?.method === 'POST');
    const secondInputs = JSON.parse(String(analysisCalls[1]![1]?.body));
    delete firstInputs.requestKey; delete secondInputs.requestKey;
    expect(secondInputs).toEqual(firstInputs);
  });

  it('retains market and context preferences when changing subjects without retaining old graphics', async () => {
    const baseFetch = fetchMock.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/resolve') && String(init?.body).includes('222 Oak')) return Response.json(makeRecord(secondId, '222 Oak Ave, Austin, TX 78701'));
      if (url.includes(`${secondId}/market-context`)) {
        const market = marketResponse(secondId); market.recordedSales.candidates[0]!.id = 'sale-b'; market.recordedSales.candidates[0]!.address = 'Synthetic B Sale';
        return Response.json(market);
      }
      if (url.includes(`${secondId}/assigned-schools`)) return Response.json({ propertyId: secondId, status: 'SOURCE_UNAVAILABLE', schools: [], assignmentSource: null });
      return baseFetch(input, init);
    });
    renderAt();
    const input = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(input, { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recorded Sales' }));
    fireEvent.click(screen.getByRole('button', { name: 'Schools' }));
    await screen.findByText('Assignment unavailable');
    fireEvent.change(input, { target: { value: '222 Oak Ave, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('button', { name: 'Recorded sale marker: Synthetic B Sale' });
    await screen.findByText('School assignments not connected');
    expect(screen.getByRole('button', { name: 'Recorded Sales' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Active Listings' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Schools' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('img', { name: /Subject property marker: 123/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Recorded sale marker: 125 Main/ })).toBeNull();
  });

  it.each(['loading', 'empty', 'failed'] as const)('keeps the subject and toggles usable when market evidence is %s', async scenario => {
    let finish: ((value: Response) => void) | undefined;
    const baseFetch = fetchMock.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      if (!String(input).includes('/market-context')) return baseFetch(input, init);
      if (scenario === 'loading') return new Promise<Response>(resolve => { finish = resolve; });
      if (scenario === 'failed') return Promise.resolve(Response.json({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'failed', requestId: 'synthetic' } }, { status: 502 }));
      const empty = marketResponse(); empty.recordedSales.candidates = []; empty.activeListings.candidates = [];
      return Promise.resolve(Response.json(empty));
    });
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recorded Sales' }));
    fireEvent.click(screen.getByRole('button', { name: 'Active Listings' }));
    expect(screen.getByRole('img', { name: /Subject property marker/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Recorded sale marker/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Active listing marker/ })).toBeNull();
    if (scenario === 'loading') {
      await waitFor(() => expect(finish).toBeDefined());
      await act(async () => { finish!(Response.json(marketResponse())); });
      expect(screen.getByRole('button', { name: /Recorded sale marker/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Active listing marker/ })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Recorded Sales' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Active Listings' }).getAttribute('aria-pressed')).toBe('true');
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'Recorded Sales' }));
    fireEvent.click(screen.getByRole('button', { name: 'Active Listings' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Recorded Sales' }));
    fireEvent.click(schools);
    expect(schools.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Assigned Schools' })).toBeTruthy();
    await screen.findByText('The school-assignment source returned no assignment information for this property.');
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
    // Synthetic internal adapter fixture; RentCast does not document this schema.
    const schools = await new AssignedSchoolsService({ findById: async () => ({ property: makeRecord().property, snapshot: null }) } as unknown as PropertyRepository,
      { get: async () => ({ source: 'SYNTHETIC_VERIFIED_ADAPTER', schools: [{ assignmentLevel: 'ELEMENTARY', sourceSchoolId: 'one', name: 'Oak Elementary', district: 'Austin ISD', city: 'Austin', latitude: 30.11, longitude: -97.11, grades: 'K–5', schoolType: 'Public' }] }) }).get(firstId);
    const baseFetch = fetchMock.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => String(input).includes('/assigned-schools')
      ? Promise.resolve(Response.json(schools))
      : baseFetch(input, init));
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Schools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recorded Sales' }));
    const schoolRow = await screen.findByRole('button', { name: 'Select assigned school Oak Elementary' });
    fireEvent.click(schoolRow);
    expect(screen.getByRole('button', { name: 'Assigned school marker: Oak Elementary' }).getAttribute('aria-pressed')).toBe('true');
    expect(schoolRow.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /Grocery marker/ })).toBeNull();
    expect(await screen.findByRole('button', { name: /Recorded sale marker/ })).toBeTruthy();
  });

  it.each([
    ['source missing', () => Response.json({ propertyId: firstId, status: 'SOURCE_UNAVAILABLE', schools: [], assignmentSource: null }), 'School assignments not connected'],
    ['legacy provider failure', () => Response.json({ propertyId: firstId, status: 'PROVIDER_ERROR', schools: [], assignmentSource: null }), 'School request failed'],
    ['upstream failure', () => Response.json({ error: { code: 'SCHOOL_ASSIGNMENT_PROVIDER_ERROR', message: 'failed', requestId: 'synthetic' } }, { status: 502 }), 'School request failed'],
    ['upstream malformed', () => Response.json({ error: { code: 'SCHOOL_ASSIGNMENT_PROVIDER_MALFORMED', message: 'invalid', requestId: 'synthetic' } }, { status: 502 }), 'School response invalid'],
    ['API schema mismatch', () => Response.json({ propertyId: firstId, status: 'AVAILABLE', schools: {} }), 'School response invalid'],
    ['inconsistent empty success', () => Response.json({ propertyId: firstId, status: 'AVAILABLE', schools: [], assignmentSource: 'SYNTHETIC' }), 'School response invalid'],
    ['invalid JSON', () => new Response('{'), 'School response invalid'],
    ['wrong property', () => Response.json({ propertyId: secondId, status: 'ASSIGNMENT_UNAVAILABLE', schools: [], assignmentSource: null }), 'School response invalid'],
    ['network failure', () => { throw new TypeError('offline'); }, 'School request failed']
  ] as const)('distinguishes %s from a successful empty school result', async (_scenario, response, title) => {
    const baseFetch = fetchMock.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => String(input).includes('/assigned-schools') ? response() : baseFetch(input, init));
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const schools = await screen.findByRole('button', { name: 'Schools' });
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/assigned-schools'))).toBe(false);
    fireEvent.click(schools);
    await screen.findByText(title);
    expect(screen.queryByText('Assignment unavailable')).toBeNull();
    expect(screen.queryByRole('button', { name: /Assigned school marker/ })).toBeNull();
  });

  it('shows school loading and ignores a late school response after switching properties', async () => {
    let resolveSchoolA: ((value: Response) => void) | undefined;
    const source = { get: async () => ({ source: 'SYNTHETIC_VERIFIED_ADAPTER', schools: [{ assignmentLevel: 'HIGH', sourceSchoolId: 'late', name: 'Synthetic Old School', district: null, city: null, latitude: 30.11, longitude: -97.11, grades: null, schoolType: null }] }) };
    const oldSchools = await new AssignedSchoolsService({ findById: async () => ({ property: makeRecord().property, snapshot: null }) } as unknown as PropertyRepository, source).get(firstId);
    const baseFetch = fetchMock.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(`${firstId}/assigned-schools`)) return new Promise<Response>(resolve => { resolveSchoolA = resolve; });
      if (url.includes(`${secondId}/assigned-schools`)) return Promise.resolve(Response.json({ propertyId: secondId, status: 'ASSIGNMENT_UNAVAILABLE', schools: [], assignmentSource: 'SYNTHETIC_VERIFIED_ADAPTER' }));
      if (url.endsWith('/resolve') && String(init?.body).includes('222 Oak')) return Promise.resolve(Response.json(makeRecord(secondId, '222 Oak Ave, Austin, TX 78701')));
      if (url.includes(`${secondId}/market-context`)) return Promise.resolve(Response.json(marketResponse(secondId)));
      return baseFetch(input, init);
    });
    renderAt();
    const input = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(input, { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Schools' }));
    await screen.findByText('Loading context');
    await waitFor(() => expect(resolveSchoolA).toBeDefined());
    fireEvent.change(input, { target: { value: '222 Oak Ave, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: '222 Oak Ave, Austin, TX 78701' });
    expect(screen.getByRole('button', { name: 'Schools' }).getAttribute('aria-pressed')).toBe('true');
    await screen.findByText('The school-assignment source returned no assignment information for this property.');
    await act(async () => { resolveSchoolA!(Response.json(oldSchools)); });
    expect(screen.queryByText('Synthetic Old School')).toBeNull();
    expect(screen.queryByRole('button', { name: /Assigned school marker/ })).toBeNull();
    expect(screen.getByText('Assignment unavailable')).toBeTruthy();
  });

  it('switches official wildfire polygons and fault traces while retaining core candidates', async () => {
    renderAt();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a property address' }), { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recorded Sales' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wildfire' }));
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
      if (url.includes(`/properties/${firstId}/analyses?summary=true`)) return Response.json(analysisPage([offer, listing]));
      if (url.endsWith(`/analyses/${offer.id}`)) return Response.json(offer);
      if (url.endsWith(`/analyses/${listing.id}`)) return Response.json(listing);
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

describe('Milestone 09 client hardening', () => {
  it('starts one analysis transport under StrictMode effect replay', async () => {
    fetchMock.mockResolvedValue(Response.json(analysisResponse('OFFER', 'BALANCED')));
    render(<StrictMode><PricingAnalysisDialog property={makeRecord()} mode="OFFER" onClose={() => {}} /></StrictMode>);
    await screen.findByText('The engine used recorded sales.');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(['OFFER', 'LISTING'] as const)('cancels a pending %s analysis when switching properties', async mode => {
    const baseFetch = fetchMock.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    let finish: ((value: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input).endsWith('/analyses') && init?.method === 'POST') {
        signal = init.signal;
        return new Promise<Response>(resolve => { finish = resolve; });
      }
      if (String(input).endsWith('/properties/resolve') && String(init?.body).includes('222')) return Promise.resolve(Response.json(makeRecord(secondId, '222 Oak Ave, Apt 2, Austin, TX 78701')));
      return baseFetch(input, init);
    });
    renderAt();
    const search = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(search, { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: mode === 'OFFER' ? 'Offer Price' : 'Listing Price' }));
    await screen.findByText('Generating analysis');
    fireEvent.change(search, { target: { value: '222 Oak Ave, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: '222 Oak Ave, Apt 2, Austin, TX 78701' });
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish?.(Response.json(analysisResponse(mode, 'BALANCED'))); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText('Not analyzed', { exact: true })).toHaveLength(2);
  });

  it('ignores late context results after switching layers and properties', async () => {
    const baseFetch = fetchMock.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    let finishGrocery: ((value: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input).includes('/nearby-places')) { signal = init?.signal; return new Promise<Response>(resolve => { finishGrocery = resolve; }); }
      if (String(input).endsWith('/properties/resolve') && String(init?.body).includes('222')) return Promise.resolve(Response.json(makeRecord(secondId, '222 Oak Ave, Apt 2, Austin, TX 78701')));
      return baseFetch(input, init);
    });
    renderAt();
    const search = screen.getByRole('textbox', { name: 'Search a property address' });
    fireEvent.change(search, { target: { value: '123 Main St, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Grocery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wildfire' }));
    expect(signal?.aborted).toBe(true);
    await screen.findByText('Subject point intersects a displayed High Fire Hazard Severity Zone.');
    fireEvent.change(search, { target: { value: '222 Oak Ave, Apt 2, Austin, TX 78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: '222 Oak Ave, Apt 2, Austin, TX 78701' });
    await act(async () => { finishGrocery?.(Response.json({ propertyId: firstId, status: 'AVAILABLE', places: [{ id: 'late-place', name: 'Late synthetic grocery', category: 'Grocery Store', latitude: 30.11, longitude: -97.11, distanceMiles: 0.62, source: 'ARCGIS_PLACES' }], source: 'ARCGIS_PLACES', radiusMeters: 1600 })); });
    expect(screen.queryByText('Late synthetic grocery')).toBeNull();
    expect(screen.getAllByTestId('government-overlay')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Wildfire' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('img', { name: /Subject property marker: 222 Oak/ })).toBeTruthy();
  });

  it('uses one idempotency key after a lost response and ignores duplicate generation clicks', async () => {
    let fail = true;
    fetchMock.mockImplementation(async () => {
      if (fail) { fail = false; throw new Error('lost response'); }
      return Response.json(analysisResponse('OFFER', 'BALANCED'));
    });
    render(<PricingAnalysisDialog property={makeRecord()} mode="OFFER" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry analysis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate analysis' }));
    await screen.findByText('The engine used recorded sales.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(call => (call[1]?.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[1]).toBe(keys[0]);
  });

  it('keeps a historical regeneration retry on the same frozen run and idempotency key', async () => {
    const original = analysisResponse('OFFER', 'BALANCED');
    let fail = true;
    fetchMock.mockImplementation(async () => {
      if (fail) { fail = false; throw new Error('lost response'); }
      return Response.json({ ...original, id: crypto.randomUUID() });
    });
    render(<PricingAnalysisDialog property={makeRecord()} mode="OFFER" historicalRun={original} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate explanation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry analysis' }));
    await waitFor(() => expect(screen.queryByText('Analysis request unavailable')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call => String(call[0]).endsWith(`/analyses/${original.id}/regenerate-explanation`))).toBe(true);
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)['Idempotency-Key']);
  });

  it('retains saved deterministic pricing if a RUNNING status poll fails', async () => {
    vi.useFakeTimers();
    try {
      const run = { ...analysisResponse('OFFER', 'BALANCED'), status: 'RUNNING' as const, aiResult: null, completedAt: null };
      fetchMock.mockRejectedValue(new Error('server unavailable'));
      render(<PricingAnalysisDialog property={makeRecord()} mode="OFFER" historicalRun={run} onClose={() => {}} />);
      expect(screen.getByRole('dialog').textContent).toContain('$410,000');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByText('Analysis request unavailable')).toBeTruthy();
      expect(screen.getByRole('dialog').textContent).toContain('$410,000');
      expect(fetchMock.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('traps modal focus, closes with Escape, and restores the opener', async () => {
    const opener = document.createElement('button');
    document.body.append(opener); opener.focus();
    const close = vi.fn();
    const view = render(<PricingAnalysisDialog property={makeRecord()} mode="OFFER" historicalRun={analysisResponse('OFFER', 'BALANCED')} onClose={close} />);
    const first = screen.getByRole('button', { name: 'Close dialog' });
    const last = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps the exact historical modal open while a property refresh reloads the table', async () => {
    const run = analysisResponse('OFFER', 'BALANCED');
    let refreshDone: ((value: Response) => void) | undefined;
    let listCalls = 0;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health/live')) return Promise.resolve(Response.json({ status: 'live', requestId: 'synthetic' }));
      if (url.includes('/properties?')) { listCalls++; return listCalls === 1 ? Promise.resolve(Response.json({ items: [makeRecord()], total: 1, page: 1, pageSize: 5 })) : new Promise<Response>(() => {}); }
      if (url.includes('/analyses?summary=true')) return Promise.resolve(Response.json(analysisPage([run])));
      if (url.endsWith(`/analyses/${run.id}`)) return Promise.resolve(Response.json(run));
      if (url.endsWith('/refresh') && init?.method === 'POST') return new Promise<Response>(resolve => { refreshDone = resolve; });
      throw new Error('Unexpected mock request');
    });
    renderAt('/history');
    await screen.findByText('Analysis versions');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'View Analysis' })[0]!);
    await screen.findByRole('dialog');
    await act(async () => { refreshDone?.(Response.json(makeRecord())); });
    await screen.findByText('Loading history');
    expect(screen.getByRole('dialog').textContent).toContain(run.id);
    expect(screen.getByRole('dialog').textContent).toContain('123 Main St, Apt 2, Austin, TX 78701');
    expect(screen.getByRole('dialog').textContent).toContain('$410,000');
  });

  it('reports analysis history failure and retries instead of claiming no analyses exist', async () => {
    const run = analysisResponse('OFFER', 'BALANCED');
    let fail = true;
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
      if (url.includes('/properties?')) return Response.json({ items: [makeRecord()], total: 1, page: 1, pageSize: 5 });
      if (fail) { fail = false; throw new Error('analysis read unavailable'); }
      return Response.json(analysisPage([run]));
    });
    renderAt('/history');
    await screen.findByText('Saved analyses could not be loaded. Property details remain available.');
    expect(screen.queryByText('Not analyzed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis history' }));
    await screen.findByText('Analysis versions');
    expect(screen.queryByText('Saved analyses could not be loaded. Property details remain available.')).toBeNull();
  });

  it('loads older analysis summaries on request and preserves keyboard activation of row buttons', async () => {
    const first = analysisResponse('OFFER', 'BALANCED'), older = analysisResponse('LISTING', 'BALANCED');
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
      if (url.includes('/properties?')) return Response.json({ items: [makeRecord()], total: 1, page: 1, pageSize: 5 });
      return Response.json(url.includes('page=2') ? { ...analysisPage([older], 2, 2), latestOffer: analysisSummary(first) } : analysisPage([first], 2));
    });
    renderAt('/history');
    fireEvent.click(await screen.findByRole('button', { name: 'Load older analyses' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'View Analysis' })).toHaveLength(4));
    expect(screen.queryByRole('button', { name: 'Load older analyses' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true);
    const row = screen.getByRole('row', { name: /123 Main St/ });
    expect(fireEvent.keyDown(row, { key: 'Enter' })).toBe(false);
  });
});

it('shows the latest Listing even when it is older than the first summary page', async () => {
  const offer = analysisResponse('OFFER', 'BALANCED'), listing = analysisResponse('LISTING', 'TEST_MARKET');
  fetchMock.mockImplementation(async (input: string) => {
    const url = String(input);
    if (url.endsWith('/health/live')) return Response.json({ status: 'live', requestId: 'synthetic' });
    if (url.includes('/properties?')) return Response.json({ items: [makeRecord()], total: 1, page: 1, pageSize: 5 });
    if (url.endsWith(`/analyses/${listing.id}`)) return Response.json(listing);
    return Response.json({ ...analysisPage([offer], 21), latestListing: analysisSummary(listing) });
  });
  renderAt('/history');
  await screen.findByText('Analysis versions');
  const detail = screen.getByRole('complementary');
  const latestListing = within(detail).getByText('Latest Listing Analysis').closest('.detail-analysis') as HTMLElement;
  expect(latestListing.textContent).toContain('$420,000');
  fireEvent.click(within(latestListing).getByRole('button', { name: 'View Analysis' }));
  expect((await screen.findByRole('dialog', { name: 'Listing Price Analysis' })).textContent).toContain(listing.id);
});

it('cancels a delayed historical reopen when another property is selected', async () => {
  const run = analysisResponse('OFFER', 'BALANCED');
  let finish: ((value: Response) => void) | undefined;
  let signal: AbortSignal | null | undefined;
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/health/live')) return Promise.resolve(Response.json({ status: 'live', requestId: 'synthetic' }));
    if (url.includes('/properties?')) return Promise.resolve(Response.json({ items: [makeRecord(), makeRecord(secondId, '222 Oak Ave, Apt 2, Austin, TX 78701')], total: 2, page: 1, pageSize: 5 }));
    if (url.includes(`/properties/${firstId}/analyses?`)) return Promise.resolve(Response.json(analysisPage([run])));
    if (url.endsWith(`/analyses/${run.id}`)) { signal = init?.signal; return new Promise<Response>(resolve => { finish = resolve; }); }
    return Promise.resolve(Response.json(analysisPage([])));
  });
  renderAt('/history');
  await screen.findByText('Analysis versions');
  fireEvent.click(screen.getAllByRole('button', { name: 'View Analysis' })[0]!);
  fireEvent.click(screen.getByRole('row', { name: /222 Oak Ave/ }));
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish?.(Response.json(run)); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('complementary').textContent).toContain('222 Oak Ave');
});
