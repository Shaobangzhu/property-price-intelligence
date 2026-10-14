import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { NearbySchoolsResponse } from '@ppi/shared';
import { createApp } from '../server/src/app.js';
import type { PropertyService } from '../server/src/properties/service.js';
import type { PropertyRepository, StoredRecord } from '../server/src/properties/repository.js';
import { NearbySchoolsService, createSchoolProvider } from '../server/src/context/schools.js';
import { ZillapiClient } from '../server/src/context/zillapi.js';
import { NcesSchoolLocations, type SchoolLocationSource } from '../server/src/context/school-locations.js';
import { ArcGisPlacesProvider, GroceryContextService, PlacesError, normalizeGroceryPlaces, parseGroceryPolicy, resolveGroceryCategoryIds } from '../server/src/context/grocery.js';
import { getContextMarkers } from '../client/src/features/map/contextMarkers.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const address = '123 Example Street Apt 4, Sample City, CA 90000';
const subject = { property: { id, formattedAddress: address, latitude: 30.1, longitude: -97.1 }, snapshot: null } as unknown as StoredRecord;
function repository(record: StoredRecord | null = subject) {
  return { findById: vi.fn(async () => record), saveProfile: vi.fn(), patch: vi.fn(), delete: vi.fn(), markRefreshFailed: vi.fn() } as unknown as PropertyRepository;
}
const property = { zpid: '123456', address: { streetAddress: '123 Example St #4', city: 'Sample City', state: 'CA', zipcode: '90000' } };
const nearby = { name: 'Synthetic Nearby School', level: 'Elementary', rating: 7, distance: 0.4, type: 'public' };
function schoolApp(provider: ZillapiClient | null, repo = repository(), log = vi.fn(), locations?: SchoolLocationSource) {
  return createApp({ checkDatabase: async () => true, origins: [], propertyService: {} as PropertyService,
    schoolsService: new NearbySchoolsService(repo, provider, locations), log });
}

describe('nearby school context', () => {
  it('selects Zillapi without making requests on startup, and retains unavailable config', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    const provider = createSchoolProvider({ SCHOOL_ASSIGNMENT_PROVIDER: 'zillapi', ZILLAPI_API_KEY: 'synthetic-key' });
    expect(provider).toBeInstanceOf(ZillapiClient);
    expect(transport).not.toHaveBeenCalled();
    const response = await request(schoolApp(createSchoolProvider({ SCHOOL_ASSIGNMENT_PROVIDER: 'unavailable', ZILLAPI_API_KEY: '' })))
      .get(`/api/properties/${id}/nearby-schools`);
    expect(NearbySchoolsResponse.parse(response.body)).toEqual({ propertyId: id, status: 'SOURCE_UNAVAILABLE', schools: [], source: null });
    expect(transport).not.toHaveBeenCalled();
  });

  it('loads the saved subject and exposes only nearby metadata through the renamed HTTP contract', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: { ...property, schools: [nearby, { ...nearby, name: 'Second Nearby School' }], owner: 'discard' } }));
    const repo = repository();
    const app = schoolApp(new ZillapiClient('synthetic-key', transport), repo);
    const response = await request(app).get(`/api/properties/${id}/nearby-schools`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    const result = NearbySchoolsResponse.parse(response.body);
    expect(result).toMatchObject({ propertyId: id, status: 'AVAILABLE', source: 'ZILLAPI', schools: [
      { name: nearby.name, level: 'ELEMENTARY', schoolType: 'public', rating: 7, distanceMiles: 0.4, latitude: null, longitude: null },
      { name: 'Second Nearby School' }
    ] });
    expect(new URL(String(transport.mock.calls[0]![0])).searchParams.get('address')).toBe(address);
    expect(getContextMarkers('schools', result, null)).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/assignment|discard|synthetic-key/);
    expect(repo.saveProfile).not.toHaveBeenCalled();
    expect(repo.patch).not.toHaveBeenCalled();
    expect((await request(app).get(`/api/properties/${id}/nearby-schools`)).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await request(app).get(`/api/properties/${id}/assigned-schools`)).status).toBe(404);
  });

  it('requires a saved subject and never spends credits for an invalid or missing property', async () => {
    const transport = vi.fn<typeof fetch>();
    const app = schoolApp(new ZillapiClient('synthetic-key', transport), repository(null));
    expect((await request(app).get(`/api/properties/${id}/nearby-schools`)).status).toBe(404);
    expect((await request(app).get('/api/properties/invalid/nearby-schools')).status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });

  it('enriches the provider list with official school locations through HTTP and produces only matched markers', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: { ...property, schools: [nearby, { ...nearby, name: 'Unmatched School' }] } }));
    const locationTransport = vi.fn<typeof fetch>(async () => Response.json({ spatialReference: { wkid: 4326 }, features: [{
      attributes: { NCESSCH: 'synthetic-nces', NAME: nearby.name, CITY: 'Synthetic City', STATE: 'CA', SCHOOLYEAR: '2024-2025' },
      geometry: { x: -97.1, y: 30.105 }
    }] }));
    const locatedSubject = { ...subject, property: { ...subject.property, city: 'Synthetic City', state: 'CA' } };
    const app = schoolApp(new ZillapiClient('synthetic-key', transport), repository(locatedSubject), vi.fn(), new NcesSchoolLocations(locationTransport));
    const response = await request(app).get(`/api/properties/${id}/nearby-schools`);
    expect(response.status).toBe(200);
    const result = NearbySchoolsResponse.parse(response.body);
    expect(result.schools).toHaveLength(2);
    expect(result.schools[0]).toMatchObject({ latitude: 30.105, longitude: -97.1, locationSource: 'NCES_EDGE_2024_25' });
    expect(result.schools[1]?.latitude).toBeNull();
    expect(getContextMarkers('schools', result, null)).toMatchObject([{ label: nearby.name, latitude: 30.105, longitude: -97.1 }]);
    await request(app).get(`/api/properties/${id}/nearby-schools`);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(locationTransport).toHaveBeenCalledTimes(1);
  });

  it('keeps nearby schools available when optional school locations fail', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: { ...property, schools: [nearby] } }));
    const locations = { locate: vi.fn(async () => { throw new Error('synthetic-secret'); }) };
    const response = await request(schoolApp(new ZillapiClient('synthetic-key', transport), repository(), vi.fn(), locations))
      .get(`/api/properties/${id}/nearby-schools`);
    expect(response.status).toBe(200);
    const result = NearbySchoolsResponse.parse(response.body);
    expect(result.status).toBe('AVAILABLE');
    expect(result.schools[0]?.latitude).toBeNull();
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });

  it('distinguishes an explicit empty list from missing school data', async () => {
    for (const [data, status] of [[{ ...property, schools: [] }, 'NO_RESULTS'], [{ address: property.address }, 'DATA_UNAVAILABLE']] as const) {
      const transport = vi.fn<typeof fetch>(async () => Response.json({ data }));
      const result = await new NearbySchoolsService(repository(), new ZillapiClient('synthetic-key', transport)).get(id);
      expect(NearbySchoolsResponse.parse(result).status).toBe(status);
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it('does not spend credits when a saved unit conflicts with the formatted address', async () => {
    const transport = vi.fn<typeof fetch>();
    const conflicting = { ...subject, property: { ...subject.property, unit: 'Apt 5' } };
    const response = await request(schoolApp(new ZillapiClient('synthetic-key', transport), repository(conflicting)))
      .get(`/api/properties/${id}/nearby-schools`);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('SCHOOL_PROVIDER_SUBJECT_MISMATCH');
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects untrusted origins before any paid school lookup', async () => {
    const transport = vi.fn<typeof fetch>();
    const response = await request(schoolApp(new ZillapiClient('synthetic-key', transport)))
      .get(`/api/properties/${id}/nearby-schools`).set('Origin', 'https://untrusted.example');
    expect(response.status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([401, 402, 429, 500])('preserves sanitized HTTP %s failure instead of reporting no schools', async status => {
    const transport = vi.fn<typeof fetch>(async () => new Response('synthetic-secret', { status }));
    const log = vi.fn();
    const response = await request(schoolApp(new ZillapiClient('synthetic-key', transport), repository(), log)).get(`/api/properties/${id}/nearby-schools`);
    expect(response.status).toBe(status === 429 ? 503 : 502);
    expect(response.body.error.code).toBe(`SCHOOL_PROVIDER_${status === 401 ? 'AUTH' : status === 402 ? 'CREDITS_EXHAUSTED' : status === 429 ? 'RATE_LIMIT' : 'UPSTREAM'}`);
    expect(JSON.stringify([response.body, log.mock.calls])).not.toMatch(/synthetic-secret|synthetic-key/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects address mismatch and malformed responses observably', async () => {
    for (const [data, code] of [[{ ...property, address: { ...property.address, streetAddress: '124 Example St #4' } }, 'SUBJECT_MISMATCH'], [{ schools: [] }, 'MALFORMED']] as const) {
      const response = await request(schoolApp(new ZillapiClient('synthetic-key', vi.fn<typeof fetch>(async () => Response.json({ data })))))
        .get(`/api/properties/${id}/nearby-schools`);
      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe(`SCHOOL_PROVIDER_${code}`);
    }
  });
});

describe('transient grocery context', () => {
  const categoryId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const place = { placeId: 'place-1', name: 'Market One', location: { x: -97.11, y: 30.11 }, categories: [{ label: 'Grocery Store' }], distance: 1000, rawContact: 'discard me' };

  it('resolves exact grocery categories and allows only display fields through normalization', () => {
    expect(resolveGroceryCategoryIds({ categories: [{ categoryId, fullLabel: ['Shopping', 'Grocery Store'] }, { categoryId: 'bbbbbbbbbbbbbbbbbbbbbbbb', label: 'Restaurant' }] })).toEqual([categoryId]);
    const normalized = normalizeGroceryPlaces({ results: [place] }, 10);
    expect(normalized).toEqual([{ id: 'place-1', name: 'Market One', category: 'Grocery Store', latitude: 30.11, longitude: -97.11, distanceMiles: 0.62, source: 'ARCGIS_PLACES' }]);
    expect(JSON.stringify(normalized)).not.toContain('rawContact');
  });

  it('sends the server key only in Authorization, uses two bounded requests, and never writes Places data', async () => {
    const calls: { url: URL; init: RequestInit }[] = [];
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init: init! });
      return Response.json(calls.length === 1 ? { categories: [{ categoryId, fullLabel: ['Shopping', 'Supermarket'] }] } : { results: [place] });
    }) as unknown as typeof fetch;
    const repo = repository();
    const service = new GroceryContextService(repo, new ArcGisPlacesProvider('synthetic-server-only-key', transport), parseGroceryPolicy({}));
    const result = await service.get(id);
    expect(result.status).toBe('AVAILABLE');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.pathname.endsWith('/categories')).toBe(true);
    expect(calls[1]!.url.searchParams.get('x')).toBe('-97.1');
    expect(calls[1]!.url.searchParams.get('y')).toBe('30.1');
    expect(calls[1]!.url.searchParams.get('pageSize')).toBe('10');
    expect(calls[1]!.url.searchParams.get('categoryIds')).toBe(categoryId);
    expect(calls.every(call => call.init.headers && (call.init.headers as Record<string, string>).Authorization === 'Bearer synthetic-server-only-key')).toBe(true);
    expect(calls.every(call => !call.url.href.includes('synthetic-server-only-key'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('synthetic-server-only-key');
    expect(repo.saveProfile).not.toHaveBeenCalled();
    expect(repo.patch).not.toHaveBeenCalled();
    expect(repo.markRefreshFailed).not.toHaveBeenCalled();
    expect(getContextMarkers('grocery', null, result)).toHaveLength(1);
    expect(getContextMarkers('schools', null, result)).toEqual([]);
    expect(getContextMarkers(null, null, result)).toEqual([]);
    expect(getContextMarkers('grocery', null, { ...result, status: 'PROVIDER_ERROR' })).toEqual([]);
  });

  it('separates missing credential, rate limit, API error, and no coordinates', async () => {
    const policy = parseGroceryPolicy({});
    const unavailable = new GroceryContextService(repository(), new ArcGisPlacesProvider(''), policy);
    expect((await unavailable.get(id)).status).toBe('CREDENTIAL_UNAVAILABLE');
    const rate = new GroceryContextService(repository(), { nearby: async () => { throw new PlacesError('RATE_LIMIT'); } }, policy);
    expect((await rate.get(id)).status).toBe('RATE_LIMIT');
    const error = new GroceryContextService(repository(), { nearby: async () => { throw new Error('opaque'); } }, policy);
    expect((await error.get(id)).status).toBe('PROVIDER_ERROR');
    const noCoords = { property: { id, latitude: null, longitude: null }, snapshot: null } as unknown as StoredRecord;
    expect((await new GroceryContextService(repository(noCoords), { nearby: vi.fn() }, policy).get(id)).status).toBe('NO_COORDINATES');
  });
});
