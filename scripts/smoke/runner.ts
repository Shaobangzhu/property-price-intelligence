import type { AppConfig } from '../../server/src/config/env.js';
import { CAPS, RequestBudget, type Operation } from './budget.js';
import { inspectCategories, inspectList, inspectPlaces, selectProperty } from './normalize.js';
import { checkOpenAI } from './openai.js';

type FetchLike = typeof fetch;
type Entry = { provider: string; operation: string; status: 'NOT_RUN' | 'SKIPPED' | 'SUCCESS' | 'ERROR' | 'DEFERRED'; httpStatus?: number; durationMs?: number; count?: number; note?: string; fields?: Record<string, string>; usage?: { inputTokens: number; outputTokens: number } };
const rentcast = 'https://api.rentcast.io';
const arcgis = 'https://places-api.arcgis.com';
const placesRoot = `${arcgis}/arcgis/rest/services/places-service/v1`;

async function getJson(budget: RequestBudget, operation: Operation, url: URL, key: string, transport: FetchLike) {
  const allowed = operation === 'categories' || operation === 'places' ? arcgis : rentcast;
  if (url.origin !== allowed) throw new Error('Unexpected provider origin');
  const started = performance.now();
  const response = await budget.attempt(operation, () => transport(url, { headers: operation === 'categories' || operation === 'places' ? { Authorization: `Bearer ${key}` } : { 'X-Api-Key': key }, redirect: 'error', signal: AbortSignal.timeout(8000) }));
  const durationMs = Math.round(performance.now() - started);
  if (!response.ok) return { httpStatus: response.status, durationMs, body: null };
  const bodyText = await response.text();
  if (bodyText.length > 1_000_000) return { httpStatus: response.status, durationMs, body: null };
  try { return { httpStatus: response.status, durationMs, body: JSON.parse(bodyText) as unknown }; }
  catch { return { httpStatus: response.status, durationMs, body: null }; }
}

export async function runSmoke(config: AppConfig, options: { live: boolean; browserKeyConfigured: boolean; transport?: FetchLike; openaiTransport?: (options: { model: string; effort: AppConfig['OPENAI_REASONING_EFFORT'] }) => Promise<unknown> }) {
  const budget = new RequestBudget();
  const credentials = { rentcast: !!config.RENTCAST_API_KEY, arcgisPlaces: !!config.ARCGIS_PLACES_API_KEY, arcgisBasemap: options.browserKeyConfigured, openai: !!config.OPENAI_API_KEY };
  const inputs = { propertyAddress: !!config.SMOKE_TEST_ADDRESS, coordinates: !!config.smokeCoordinates, groceryCategoryId: !!config.SMOKE_GROCERY_CATEGORY_ID };
  const plan = { caps: CAPS, maximumTotal: 6, credentials, inputs };
  if (!options.live) return { mode: 'DRY_RUN' as const, plan, requests: budget.snapshot(), reports: Object.keys(CAPS).map(operation => ({ provider: operation === 'openai' ? 'OpenAI' : operation === 'places' || operation === 'categories' ? 'ArcGIS' : 'RentCast', operation, status: 'NOT_RUN' as const })), basemap: 'DEFERRED' as const };
  if (!config.ALLOW_LIVE_API_TESTS) throw new Error('Live smoke requires ALLOW_LIVE_API_TESTS=true and --live');
  const transport = options.transport ?? fetch;
  const reports: Entry[] = [];
  let coords: { latitude: number; longitude: number } | null = null;
  if (!config.RENTCAST_API_KEY || !config.SMOKE_TEST_ADDRESS) reports.push({ provider: 'RentCast', operation: 'property', status: 'SKIPPED', note: 'key or address missing' });
  else {
    const url = new URL('/v1/properties', rentcast); url.searchParams.set('address', config.SMOKE_TEST_ADDRESS); url.searchParams.set('limit', '5');
    try {
      const response = await getJson(budget, 'property', url, config.RENTCAST_API_KEY, transport);
      const selected = selectProperty(response.body, config.SMOKE_TEST_ADDRESS);
      if ('error' in selected || response.httpStatus !== 200) reports.push({ provider: 'RentCast', operation: 'property', status: 'ERROR', httpStatus: response.httpStatus, durationMs: response.durationMs, note: response.httpStatus !== 200 ? 'HTTP_ERROR' : 'error' in selected ? selected.error.toUpperCase() : 'MALFORMED' });
      else {
        reports.push({ provider: 'RentCast', operation: 'property', status: 'SUCCESS', httpStatus: response.httpStatus, durationMs: response.durationMs, count: 1, note: `school:${selected.schoolObservation}; assigned-school meaning unverified`, fields: selected.fields });
        if (selected.summary.latitude !== null && selected.summary.longitude !== null) coords = { latitude: selected.summary.latitude, longitude: selected.summary.longitude };
      }
    } catch { reports.push({ provider: 'RentCast', operation: 'property', status: 'ERROR', note: 'REQUEST_FAILED' }); }
  }
  for (const [operation, path, query, priceField] of [
    ['recordedSales', '/v1/properties', { saleDateRange: '365' }, 'lastSalePrice'],
    ['activeListings', '/v1/listings/sale', { status: 'Active' }, 'price']
  ] as const) {
    if (!config.RENTCAST_API_KEY || !coords) { reports.push({ provider: 'RentCast', operation, status: 'SKIPPED', note: 'key or verified property coordinates missing' }); continue; }
    const url = new URL(path, rentcast);
    Object.entries({ latitude: String(coords.latitude), longitude: String(coords.longitude), radius: '1', limit: '5', ...query }).forEach(([key, value]) => url.searchParams.set(key, value));
    try {
      const response = await getJson(budget, operation, url, config.RENTCAST_API_KEY, transport);
      const shape = inspectList(response.body, priceField);
      reports.push({ provider: 'RentCast', operation, status: response.httpStatus === 200 && shape ? 'SUCCESS' : 'ERROR', httpStatus: response.httpStatus, durationMs: response.durationMs, count: shape?.count, note: shape ? `${priceField} present in ${shape.priceFieldCount} of ${shape.count}; no valuation implied` : response.httpStatus !== 200 ? 'HTTP_ERROR' : 'MALFORMED' });
    } catch { reports.push({ provider: 'RentCast', operation, status: 'ERROR', note: 'REQUEST_FAILED' }); }
  }
  let categoryId: string | null = null;
  if (!config.ARCGIS_PLACES_API_KEY || !(coords ?? config.smokeCoordinates)) reports.push({ provider: 'ArcGIS', operation: 'categories', status: 'SKIPPED', note: 'key or coordinates missing' });
  else {
    const url = new URL(`${placesRoot}/categories`); url.searchParams.set('filter', 'grocery');
    try {
      const response = await getJson(budget, 'categories', url, config.ARCGIS_PLACES_API_KEY, transport);
      categoryId = inspectCategories(response.body, config.SMOKE_GROCERY_CATEGORY_ID || undefined);
      reports.push({ provider: 'ArcGIS', operation: 'categories', status: response.httpStatus === 200 && categoryId ? 'SUCCESS' : 'ERROR', httpStatus: response.httpStatus, durationMs: response.durationMs, note: categoryId ? 'single grocery/supermarket category resolved' : response.httpStatus !== 200 ? 'HTTP_ERROR' : 'CATEGORY_AMBIGUOUS_OR_MISSING' });
    } catch { reports.push({ provider: 'ArcGIS', operation: 'categories', status: 'ERROR', note: 'REQUEST_FAILED' }); }
  }
  const placeCoords = coords ?? config.smokeCoordinates;
  if (!config.ARCGIS_PLACES_API_KEY || !categoryId || !placeCoords) reports.push({ provider: 'ArcGIS', operation: 'places', status: 'SKIPPED', note: 'key, verified category, or coordinates missing' });
  else {
    const url = new URL(`${placesRoot}/places/near-point`);
    Object.entries({ x: String(placeCoords.longitude), y: String(placeCoords.latitude), radius: '1000', pageSize: '3', categoryIds: categoryId }).forEach(([key, value]) => url.searchParams.set(key, value));
    try {
      const response = await getJson(budget, 'places', url, config.ARCGIS_PLACES_API_KEY, transport);
      const count = inspectPlaces(response.body);
      reports.push({ provider: 'ArcGIS', operation: 'places', status: response.httpStatus === 200 && count !== null ? 'SUCCESS' : 'ERROR', httpStatus: response.httpStatus, durationMs: response.durationMs, count: count ?? undefined, note: count !== null ? 'shape validated; records discarded' : response.httpStatus !== 200 ? 'HTTP_ERROR' : 'MALFORMED' });
    } catch { reports.push({ provider: 'ArcGIS', operation: 'places', status: 'ERROR', note: 'REQUEST_FAILED' }); }
  }
  const ai = await checkOpenAI(config, budget, options.openaiTransport);
  reports.push({ provider: 'OpenAI', operation: 'openai', ...ai });
  return { mode: 'LIVE' as const, plan, requests: budget.snapshot(), reports, basemap: 'DEFERRED' as const };
}
