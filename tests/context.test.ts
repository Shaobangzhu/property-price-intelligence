import { describe, expect, it, vi } from 'vitest';
import type { PropertyRepository, StoredRecord } from '../server/src/properties/repository.js';
import { AssignedSchoolsService, UnavailableAssignmentSource, matchSchool, type SchoolReference, type VerifiedAssignment } from '../server/src/context/schools.js';
import { ArcGisPlacesProvider, GroceryContextService, PlacesError, normalizeGroceryPlaces, parseGroceryPolicy, resolveGroceryCategoryIds } from '../server/src/context/grocery.js';
import { getContextMarkers } from '../client/src/features/map/contextMarkers.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const subject = { property: { id, latitude: 30.1, longitude: -97.1 }, snapshot: null } as unknown as StoredRecord;
const assignment: VerifiedAssignment = { assignmentLevel: 'ELEMENTARY', sourceSchoolId: 'school-1', name: 'Oak Elementary', district: 'Austin ISD', city: 'Austin', latitude: null, longitude: null, grades: null, schoolType: null };
const reference: SchoolReference = { sourceId: 'school-1', name: 'Oak Elementary', district: 'Austin ISD', city: 'Austin', latitude: 30.11, longitude: -97.11, grades: 'K–5', schoolType: 'Public', source: 'REFERENCE' };
function repository(record: StoredRecord | null = subject) {
  return { findById: vi.fn(async () => record), saveProfile: vi.fn(), patch: vi.fn(), delete: vi.fn(), markRefreshFailed: vi.fn() } as unknown as PropertyRepository;
}

describe('assigned school boundary', () => {
  it('shows unavailable when there is no verified assignment source, even with a nearby reference', async () => {
    const refs = { lookup: vi.fn(async () => [reference]) };
    const service = new AssignedSchoolsService(repository(), new UnavailableAssignmentSource(), refs);
    expect(await service.get(id)).toEqual({ propertyId: id, status: 'ASSIGNMENT_UNAVAILABLE', schools: [], assignmentSource: null });
    expect(refs.lookup).not.toHaveBeenCalled();
  });

  it('enriches only verified identities and leaves ambiguous reference matches unmatched', async () => {
    const source = { get: vi.fn(async () => ({ source: 'VERIFIED_PROVIDER', schools: [assignment] })) };
    const refs = { lookup: vi.fn(async () => [reference, { ...reference, sourceId: 'school-2' }]) };
    const service = new AssignedSchoolsService(repository(), source, refs);
    const result = await service.get(id);
    expect(result.schools).toHaveLength(1);
    expect(result.schools[0]).toMatchObject({ name: 'Oak Elementary', assignmentSource: 'VERIFIED_PROVIDER', matchStatus: 'EXACT_ID', metadataSource: 'REFERENCE', latitude: 30.11 });
    const ambiguous = matchSchool({ ...assignment, sourceSchoolId: null }, await refs.lookup());
    expect(ambiguous).toEqual({ reference: null, status: 'UNMATCHED' });
    expect(getContextMarkers('schools', result, null)).toHaveLength(1);
    expect(getContextMarkers('grocery', result, null)).toHaveLength(0);
    expect(getContextMarkers('schools', { ...result, status: 'ASSIGNMENT_UNAVAILABLE' }, null)).toEqual([]);
  });

  it('does not select a nearby but nonmatching school', async () => {
    const refs = { lookup: vi.fn(async () => [{ ...reference, sourceId: 'other', name: 'Pine Elementary' }]) };
    const service = new AssignedSchoolsService(repository(), { get: async () => ({ source: 'VERIFIED_PROVIDER', schools: [assignment] }) }, refs);
    const result = await service.get(id);
    expect(result.status).toBe('UNMATCHED');
    expect(result.schools[0]).toMatchObject({ name: 'Oak Elementary', latitude: null, longitude: null, matchStatus: 'UNMATCHED' });
    expect(getContextMarkers('schools', result, null)).toEqual([]);
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
