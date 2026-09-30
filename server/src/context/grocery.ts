import { GroceryPlace, type GroceryResponse } from '@ppi/shared';
import type { PropertyRepository } from '../properties/repository.js';
import { PropertyError } from '../properties/service.js';

const origin = 'https://places-api.arcgis.com/arcgis/rest/services/places-service/v1';
const categoryNames = new Set(['grocery store', 'supermarket']);
const categoryIdPattern = /^[a-f0-9]{24}$/i;
const maxResponseBytes = 1_000_000;

export type GroceryPolicy = { radiusMeters: number; resultLimit: number };
export function parseGroceryPolicy(env: NodeJS.ProcessEnv): GroceryPolicy {
  const bounded = (value: string | undefined, fallback: number, min: number, max: number, name: string) => {
    if (value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Invalid configuration: ${name}`);
    return number;
  };
  return { radiusMeters: bounded(env.GROCERY_RADIUS_METERS, 1600, 1, 10_000, 'GROCERY_RADIUS_METERS'),
    resultLimit: bounded(env.GROCERY_RESULT_LIMIT, 10, 1, 20, 'GROCERY_RESULT_LIMIT') };
}

export type PlacesFailure = 'CREDENTIAL_UNAVAILABLE' | 'RATE_LIMIT' | 'PROVIDER_ERROR';
export class PlacesError extends Error { constructor(readonly code: PlacesFailure) { super(code); } }
export interface GroceryProvider { nearby(latitude: number, longitude: number, policy: GroceryPolicy): Promise<GroceryPlace[]>; }

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null;
const nonempty = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const coordinate = (value: unknown, limit: number) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;

export function resolveGroceryCategoryIds(payload: unknown): string[] {
  const categories = object(payload)?.categories;
  if (!Array.isArray(categories)) throw new PlacesError('PROVIDER_ERROR');
  const ids = new Set<string>();
  for (const value of categories) {
    const item = object(value);
    if (!item) continue;
    const name = nonempty(item.label) ?? (Array.isArray(item.fullLabel) ? nonempty(item.fullLabel.at(-1)) : null);
    const id = nonempty(item.categoryId);
    if (name && categoryNames.has(name.toLowerCase()) && id && categoryIdPattern.test(id)) ids.add(id);
  }
  return [...ids].slice(0, 10);
}

export function normalizeGroceryPlaces(payload: unknown, limit: number): GroceryPlace[] {
  const results = object(payload)?.results;
  if (!Array.isArray(results)) throw new PlacesError('PROVIDER_ERROR');
  const places: GroceryPlace[] = [];
  const seen = new Set<string>();
  for (const value of results.slice(0, limit)) {
    const item = object(value), location = object(item?.location);
    const id = nonempty(item?.placeId), name = nonempty(item?.name);
    const longitude = coordinate(location?.x, 180), latitude = coordinate(location?.y, 90);
    if (!id || !name || longitude === null || latitude === null || seen.has(id)) continue;
    seen.add(id);
    const categories = item?.categories;
    const category = Array.isArray(categories) ? nonempty(object(categories[0])?.label) : null;
    const distance = typeof item?.distance === 'number' && Number.isFinite(item.distance) && item.distance >= 0 ? Math.round(item.distance / 1609.344 * 100) / 100 : null;
    places.push(GroceryPlace.parse({ id, name, category, latitude, longitude, distanceMiles: distance, source: 'ARCGIS_PLACES' }));
  }
  return places;
}

export class ArcGisPlacesProvider implements GroceryProvider {
  constructor(private readonly key: string, private readonly transport: typeof fetch = fetch) {}
  private async get(path: string, query: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.transport(`${origin}${path}?${query}`, { headers: { Authorization: `Bearer ${this.key}` }, signal: controller.signal, redirect: 'error' });
      if ([401, 403, 498, 499].includes(response.status)) throw new PlacesError('CREDENTIAL_UNAVAILABLE');
      if (response.status === 429) throw new PlacesError('RATE_LIMIT');
      if (!response.ok) throw new PlacesError('PROVIDER_ERROR');
      const raw = await response.text();
      if (raw.length > maxResponseBytes) throw new PlacesError('PROVIDER_ERROR');
      return JSON.parse(raw) as unknown;
    } catch (error) { throw error instanceof PlacesError ? error : new PlacesError('PROVIDER_ERROR'); }
    finally { clearTimeout(timeout); }
  }
  async nearby(latitude: number, longitude: number, policy: GroceryPolicy): Promise<GroceryPlace[]> {
    if (!this.key.trim()) throw new PlacesError('CREDENTIAL_UNAVAILABLE');
    const categoryIds = resolveGroceryCategoryIds(await this.get('/categories', new URLSearchParams({ filter: 'grocery', f: 'json' })));
    if (categoryIds.length === 0) throw new PlacesError('PROVIDER_ERROR');
    const payload = await this.get('/places/near-point', new URLSearchParams({ x: String(longitude), y: String(latitude), radius: String(policy.radiusMeters), pageSize: String(policy.resultLimit), categoryIds: categoryIds.join(','), f: 'json' }));
    return normalizeGroceryPlaces(payload, policy.resultLimit);
  }
}

export class GroceryContextService {
  constructor(private readonly properties: PropertyRepository, private readonly provider: GroceryProvider, private readonly policy: GroceryPolicy) {}
  async get(propertyId: string): Promise<GroceryResponse> {
    const record = await this.properties.findById(propertyId);
    if (!record) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
    const base = { propertyId, source: 'ARCGIS_PLACES' as const, radiusMeters: this.policy.radiusMeters };
    const { latitude, longitude } = record.property;
    if (latitude === null || longitude === null) return { ...base, status: 'NO_COORDINATES', places: [] };
    try {
      const places = await this.provider.nearby(latitude, longitude, this.policy);
      return { ...base, status: places.length ? 'AVAILABLE' : 'NO_RESULTS', places };
    } catch (error) { return { ...base, status: error instanceof PlacesError ? error.code : 'PROVIDER_ERROR', places: [] }; }
  }
}
