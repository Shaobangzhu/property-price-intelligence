import { createHash, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { AnalysisRun, calculatePricing, PricingPreviewRequest, PropertyPatchInput, type MarketComparableCandidate, type MarketContextResponse, type PricingInput, type PropertyEnvelope } from '@ppi/shared';

/** Hand-authored synthetic records only. This adapter is never imported by the application. */
export const DEMO_ADDRESS = '1847 Synthetic Alder Lane, Apt 2, Demo City, CA 90000';
export const SECOND_ADDRESS = '26 Synthetic Crescent Court, Demo City, CA 90000';
export const DEMO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SECOND_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const DEMO_NOW = '2026-09-30T12:00:00.000Z';
export const DEMO_SUMMARY = 'Prepared synthetic explanation: eligible recorded sales support the deterministic range. Review condition and disclosures before deciding.';

export function demoRecord(id = DEMO_ID): PropertyEnvelope {
  const second = id === SECOND_ID;
  return {
    property: { id, provider: 'RENTCAST', providerPropertyId: `synthetic-${id}`, normalizedAddressKey: `synthetic-${id}`,
      formattedAddress: second ? SECOND_ADDRESS : DEMO_ADDRESS, addressLine1: second ? '26 Synthetic Crescent Court' : '1847 Synthetic Alder Lane', unit: second ? null : 'Apt 2',
      city: 'Demo City', state: 'CA', zipCode: '90000', latitude: 37.85, longitude: -122.2,
      propertyType: 'Single Family', bedrooms: 3, bathrooms: 2, livingAreaSqft: 2000, lotSizeSqft: 6000, yearBuilt: 1988,
      currentListPrice: null, refreshFailedAt: null, notes: null, userOverrides: {},
      effectiveValues: { bedrooms: 3, bathrooms: 2, livingAreaSqft: 2000, yearBuilt: 1988 }, createdAt: DEMO_NOW, updatedAt: DEMO_NOW },
    cache: { source: 'RENTCAST', fetchedAt: DEMO_NOW, expiresAt: '2026-10-14T12:00:00.000Z', freshness: 'FRESH', cacheStatus: 'MISS' }
  };
}

export function demoMarket(propertyId = DEMO_ID, insufficient = false): MarketContextResponse {
  const candidate = (index: number, asking = false): MarketComparableCandidate => ({
    id: `${asking ? 'active_asking_price' : 'recorded_sale'}:synthetic-${index}`, providerId: `synthetic-${index}`,
    evidenceType: asking ? 'ACTIVE_ASKING_PRICE' : 'RECORDED_SALE', address: `${(propertyId === SECOND_ID ? 2800 : 1800) + index} Synthetic Alder Lane, Demo City, CA 90000`,
    latitude: 37.85 + index * 0.001, longitude: -122.2 + index * 0.001,
    propertyType: 'Single Family', bedrooms: 3, bathrooms: 2, livingAreaSqft: 2000, lotSizeSqft: 6000, yearBuilt: 1990,
    price: asking ? 850000 : 760000 + index * 20000, eventDate: '2026-08-15T00:00:00.000Z', distanceMiles: 0.4, source: 'RENTCAST'
  });
  const common = { source: 'RENTCAST' as const, freshness: 'FRESH' as const, cacheStatus: 'HIT' as const, fetchedAt: DEMO_NOW, expiresAt: '2026-10-07T12:00:00.000Z', errorCode: null };
  const query = { latitude: 37.85, longitude: -122.2, radiusMiles: 2, limit: 25, saleDateRangeDays: 365 };
  return { propertyId,
    recordedSales: { ...common, kind: 'RECORDED_SALES', query, candidates: (insufficient ? [1] : [1, 2, 3]).map(index => candidate(index)) },
    activeListings: { ...common, kind: 'ACTIVE_LISTINGS', query: { ...query, saleDateRangeDays: null }, candidates: [candidate(4, true)] }
  };
}

export type MockOptions = {
  resolveFailure?: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_MALFORMED' | 'DATABASE_UNAVAILABLE';
  contextFailures?: boolean; aiFailure?: boolean; insufficient?: boolean;
  beforeResponse?: (pathname: string, requestBody: unknown) => Promise<void>;
};

/** The browser is denied all external HTTP traffic and every API path is explicitly handled. */
export async function installMockApi(page: Page, options: MockOptions = {}, origin = 'http://127.0.0.1:4173') {
  const records = new Map<string, PropertyEnvelope>();
  const runs: AnalysisRun[] = [];
  const stats = { analysisRequests: 0, analysisGenerations: 0, analysisReads: 0, resolveRequests: 0, blockedExternalRequests: 0, unhandledApiRequests: [] as string[], completedApiRequests: [] as string[] };
  const error = (code: string) => ({ error: { code, message: 'Synthetic failure', requestId: 'synthetic-test' } });
  const makeRun = (record: PropertyEnvelope, request: PricingPreviewRequest, previous?: AnalysisRun) => {
    const market = demoMarket(record.property.id, options.insufficient);
    const input: PricingInput = previous ? structuredClone(previous.inputSnapshot) as PricingInput : {
      subject: { id: record.property.id, propertyType: record.property.propertyType, ...record.property.effectiveValues,
        currentListPrice: record.property.currentListPrice, overrideFields: Object.keys(record.property.userOverrides) },
      recordedSales: market.recordedSales.candidates.map(candidate => ({ ...candidate, evidenceType: 'RECORDED_SALE' as const })),
      activeListings: market.activeListings.candidates.map(candidate => ({ ...candidate, evidenceType: 'ACTIVE_ASKING_PRICE' as const })),
      mode: request.mode, strategyProfile: request.strategyProfile, maxBudget: request.mode === 'OFFER' ? request.maxBudget ?? null : null, asOf: DEMO_NOW,
      metadata: { propertyFreshness: 'FRESH', salesFreshness: 'FRESH', listingsFreshness: 'FRESH', salesSource: 'RENTCAST', listingsSource: 'RENTCAST', searchRadiusMiles: 2, saleDateRangeDays: 365,
        propertyFetchedAt: record.cache.fetchedAt, salesFetchedAt: DEMO_NOW, listingsFetchedAt: DEMO_NOW }
    };
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const reused = !previous && runs.find(run => run.inputHash === hash && run.status === 'SUCCEEDED');
    if (reused) return reused;
    stats.analysisGenerations++;
    const engineResult = previous?.engineResult ?? calculatePricing(input);
    const run = AnalysisRun.parse({ id: randomUUID(), propertyId: record.property.id, mode: request.mode, status: options.aiFailure ? 'FAILED' : 'SUCCEEDED',
      strategyProfile: request.strategyProfile, engineVersion: engineResult.engineVersion, promptVersion: 'synthetic-demo-v1', model: 'prepared-synthetic-explanation', reasoningEffort: 'none',
      userInputs: request, inputSnapshot: input, engineResult, aiResult: options.aiFailure ? null : {
        summary: DEMO_SUMMARY, reasons: [{ claim: 'The recorded sales supply the pricing evidence; active asks are competition context.', evidenceIds: [market.recordedSales.candidates[0]!.id] }],
        strategySteps: ['Review property condition and disclosures before choosing a final strategy.'], assumptions: ['Prepared synthetic data for local demonstration.'], unknowns: ['Condition and seller motivation are unknown.'], warnings: ['This is a prototype, not an appraisal.'] },
      inputHash: hash, createdAt: new Date(Date.parse(DEMO_NOW) + runs.length * 1000).toISOString(), completedAt: DEMO_NOW,
      failureCode: options.aiFailure ? 'MODEL_UNAVAILABLE' : null, tokenUsage: null, latencyMs: 0 });
    runs.unshift(run);
    return run;
  };

  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { stats.blockedExternalRequests++; await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    const method = route.request().method();
    const payload: unknown = route.request().postData() ? route.request().postDataJSON() : null;
    let status = 200;
    let body: unknown;
    const id = url.pathname.split('/')[3] ?? '';
    const record = records.get(id);
    if (url.pathname === '/api/health/live') body = { status: 'live', requestId: 'synthetic-test' };
    else if (url.pathname === '/api/properties/resolve' && method === 'POST') {
      stats.resolveRequests++;
      if (options.resolveFailure) { status = 503; body = error(options.resolveFailure); }
      else {
        const address = (payload as { address: string }).address;
        const propertyId = address === SECOND_ADDRESS ? SECOND_ID : address === DEMO_ADDRESS ? DEMO_ID : null;
        if (!propertyId) { status = 404; body = error('PROPERTY_NOT_FOUND'); }
        else { const existing = records.get(propertyId); body = structuredClone(existing ?? demoRecord(propertyId)); if (existing) (body as PropertyEnvelope).cache.cacheStatus = 'HIT'; records.set(propertyId, body as PropertyEnvelope); }
      }
    } else if (url.pathname === '/api/properties' && method === 'GET') {
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const items = [...records.values()].filter(item => item.property.formattedAddress.toLowerCase().includes(search));
      body = { items, total: items.length, page: 1, pageSize: 5 };
    } else if (url.pathname.startsWith('/api/analyses/')) {
      const found = runs.find(run => run.id === id);
      if (!found) { status = 404; body = error('ANALYSIS_NOT_FOUND'); }
      else if (url.pathname.endsWith('/regenerate-explanation') && method === 'POST') { stats.analysisRequests++; body = makeRun(records.get(found.propertyId)!, found.userInputs, found); }
      else { stats.analysisReads++; body = found; }
    } else if (!record) { status = 404; body = error('PROPERTY_NOT_FOUND'); }
    else if (url.pathname.endsWith('/market-context')) body = demoMarket(id, options.insufficient);
    else if (url.pathname.endsWith('/assigned-schools')) body = { propertyId: id, status: options.contextFailures ? 'PROVIDER_ERROR' : 'ASSIGNMENT_UNAVAILABLE', schools: [], assignmentSource: null };
    else if (url.pathname.endsWith('/nearby-places')) body = { propertyId: id, status: options.contextFailures ? 'PROVIDER_ERROR' : 'AVAILABLE', source: 'ARCGIS_PLACES', radiusMeters: 1600,
      places: options.contextFailures ? [] : [{ id: 'synthetic-grocery', name: id === SECOND_ID ? 'Synthetic Crescent Grocery' : 'Synthetic Demo Grocery', category: 'Grocery Store', latitude: 37.853, longitude: -122.203, distanceMiles: 0.4, source: 'ARCGIS_PLACES' }] };
    else if (url.pathname.endsWith('/wildfire-context')) body = { propertyId: id, status: options.contextFailures ? 'UNAVAILABLE' : 'INSIDE_DISPLAYED_ZONE', classification: options.contextFailures ? null : 'High', responsibilityArea: options.contextFailures ? null : 'SRA', sourceName: 'CAL FIRE Fire Hazard Severity Zones', sourceVersion: 'Synthetic scenario; not a real parcel result', checkedAt: DEMO_NOW };
    else if (url.pathname.endsWith('/fault-context')) body = { propertyId: id, contextType: 'FAULT_TRACE', status: options.contextFailures ? 'UNAVAILABLE' : 'NEAREST_MAPPED_FAULT', nearestFeatureName: options.contextFailures ? null : 'Synthetic mapped fault trace', distanceMiles: options.contextFailures ? null : 7.13, searchRadiusMiles: 20, sourceName: 'California Geological Survey Quaternary Faults', sourceVersion: 'Synthetic scenario; not a real parcel result', checkedAt: DEMO_NOW };
    else if (url.pathname.endsWith('/analyses') && method === 'POST') { stats.analysisRequests++; body = makeRun(record, PricingPreviewRequest.parse(payload)); }
    else if (url.pathname.endsWith('/analyses') && method === 'GET') {
      const items = runs.filter(run => run.propertyId === id);
      const summaries = items.map(run => ({
        id: run.id, propertyId: run.propertyId, mode: run.mode, status: run.status, strategyProfile: run.strategyProfile,
        engineVersion: run.engineVersion, promptVersion: run.promptVersion, model: run.model, reasoningEffort: run.reasoningEffort,
        createdAt: run.createdAt, completedAt: run.completedAt, failureCode: run.failureCode,
        suggestedPrice: (run.mode === 'OFFER' ? run.engineResult.offerResult : run.engineResult.listingResult)?.suggestedPrice ?? null
      }));
      body = { items: url.searchParams.get('summary') === 'true' ? summaries : items, total: items.length, page: 1, pageSize: 20,
        latestOffer: summaries.find(run => run.mode === 'OFFER') ?? null, latestListing: summaries.find(run => run.mode === 'LISTING') ?? null };
    } else if (url.pathname.endsWith('/refresh') && method === 'POST') {
      record.property.livingAreaSqft = 2400; record.property.effectiveValues.livingAreaSqft = 2400;
      record.property.updatedAt = '2026-10-01T12:00:00.000Z'; record.cache.fetchedAt = record.property.updatedAt; record.cache.cacheStatus = 'REFRESHED'; body = record;
    } else if (url.pathname === `/api/properties/${id}` && method === 'PATCH') {
      const patch = PropertyPatchInput.parse(payload);
      if (patch.notes !== undefined) record.property.notes = patch.notes;
      for (const [field, value] of Object.entries(patch.overrides ?? {})) {
        const key = field as keyof typeof record.property.effectiveValues;
        if (value === null) { delete record.property.userOverrides[key]; record.property.effectiveValues[key] = record.property[key]; }
        else { record.property.userOverrides[key] = { value, source: 'USER', updatedAt: DEMO_NOW }; record.property.effectiveValues[key] = value; }
      }
      body = record;
    } else if (url.pathname === `/api/properties/${id}` && method === 'DELETE') {
      records.delete(id); for (let index = runs.length - 1; index >= 0; index--) if (runs[index]!.propertyId === id) runs.splice(index, 1); status = 204; body = null;
    } else if (url.pathname === `/api/properties/${id}` && method === 'GET') body = record;
    else { stats.unhandledApiRequests.push(`${method} ${url.pathname}`); status = 501; body = error('UNHANDLED_DEMO_ROUTE'); }
    // Freeze the payload before delaying it to model a genuine late response.
    const responseBody = body === null ? '' : JSON.stringify(body);
    await options.beforeResponse?.(url.pathname, payload);
    await route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: responseBody });
    stats.completedApiRequests.push(url.pathname);
  });
  return { records, runs, stats };
}
