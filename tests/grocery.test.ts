import { describe, expect, it, vi } from 'vitest';
import { ArcGisPlacesProvider, groceryDistanceMeters, normalizeGroceryDetails, validateGroceryPlaces } from '../server/src/context/grocery.js';
import { getContextMarkers } from '../client/src/features/map/contextMarkers.js';

const subject = { latitude: 37, longitude: -122 };
const policy = { radiusMeters: 1600, resultLimit: 10 };
const detail = (id: string, name = 'Synthetic Bros. Market', latitude = 37.003, street = '100 Synthetic Avenue') => ({ placeDetails: {
  placeId: id, name, location: { x: -122.001, y: latitude }, categories: [{ label: 'Grocery Store' }],
  address: { streetAddress: street, locality: 'Sample', region: 'CA', postcode: '90000' }, contactInfo: { telephone: 'discard' }
} });
const place = (id: string, name?: string, latitude?: number, street?: string) => normalizeGroceryDetails(detail(id, name, latitude, street), id)!;

describe('grocery identity and geometry', () => {
  it('sorts atomic records and computes straight-line distance from their own WGS84 geometry', () => {
    const input = [place('far', 'Synthetic Alpha', 37.009), place('near', 'Synthetic Beta', 37.001), place('middle', 'Synthetic Gamma', 37.005)];
    const output = validateGroceryPlaces(input, subject, policy);
    expect(output.map(p => p.id)).toEqual(['near', 'middle', 'far']);
    for (const p of output) {
      expect(p).toMatchObject({ ...input.find(item => item.id === p.id)!, distanceMiles: expect.any(Number) });
      expect(p.distanceMiles).toBe(Math.round(groceryDistanceMeters(subject, p) / 1609.344 * 100) / 100);
    }
    const markers = getContextMarkers('grocery', null, { propertyId: 'synthetic', status: 'AVAILABLE', places: output, source: 'ARCGIS_PLACES', radiusMeters: 1600 });
    expect(markers.map(p => [p.id, p.label, p.latitude, p.longitude])).toEqual(output.map(p => [p.id, p.name, p.latitude, p.longitude]));
    expect(markers[0]?.detail).toContain('straight-line');
  });

  it('collapses same IDs and near-identical storefront variants without changing the chosen provider name', () => {
    const first = place('a');
    const second = place('b', 'Synthetic Bros Markets', 37.0031, '100 Synthetic Ave.');
    expect(validateGroceryPlaces([second, first, first], subject, policy)).toEqual([{ ...first, distanceMiles: 0.21 }]);
  });

  it('retains separate branches and separate businesses sharing a building', () => {
    const output = validateGroceryPlaces([place('a'), place('b', undefined, 37.01, '200 Synthetic Ave'), place('c', 'Other Grocery')], subject, policy);
    expect(output).toHaveLength(3);
  });

  it('rejects every conflicting point for the same street/city/state/brand even with different ZIPs', () => {
    const other = detail('b', 'Synthetic Bros Markets', 37.01, '100 Synthetic Ave');
    other.placeDetails.address.postcode = '99999';
    expect(validateGroceryPlaces([place('a'), normalizeGroceryDetails(other, 'b')!], subject, policy)).toEqual([]);
  });

  it('rejects out-of-radius geometry independently of a misleading reported distance', () => {
    const outside = place('far', 'Synthetic Far', 37.1);
    expect(validateGroceryPlaces([{ ...outside, distanceMiles: 0.1 }, place('near')], subject, policy).map(p => p.id)).toEqual(['near']);
    expect(groceryDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111195.08, 1);
  });

  it('requires matching detail ID, valid coordinates and a specific street address', () => {
    expect(normalizeGroceryDetails(detail('a'), 'b')).toBeNull();
    expect(normalizeGroceryDetails(detail('a', undefined, undefined, 'Synthetic Road'), 'a')).toBeNull();
    expect(normalizeGroceryDetails(detail('a', undefined, 100), 'a')).toBeNull();
    expect(normalizeGroceryDetails({ placeDetails: { placeId: 'a' } }, 'a')).toBeNull();
    expect(JSON.stringify(place('a'))).not.toMatch(/contactInfo|telephone|postcode/);
  });

  it('uses the same provider ID for details despite out-of-order completions; no pagination/retries', async () => {
    const calls: URL[] = [];
    const transport = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input)); calls.push(url);
      if (url.pathname.endsWith('/categories')) return Response.json({ categories: [{ categoryId: 'aaaaaaaaaaaaaaaaaaaaaaaa', label: 'Grocery Store' }] });
      if (url.pathname.endsWith('/near-point')) return Response.json({ results: ['a', 'b', 'a'].map(id => ({ ...detail(id).placeDetails, distance: 1 })), pagination: { nextUrl: 'https://untrusted.example' } });
      const id = url.pathname.split('/').at(-1)!;
      if (id === 'a') await new Promise(resolve => setTimeout(resolve, 10));
      return Response.json(detail(id, id === 'a' ? 'Synthetic Alpha' : 'Synthetic Beta', id === 'a' ? 37.009 : 37.001));
    });
    const result = await new ArcGisPlacesProvider('synthetic', transport).nearby(subject.latitude, subject.longitude, policy);
    expect(result.map(p => [p.id, p.name, p.latitude])).toEqual([['b', 'Synthetic Beta', 37.001], ['a', 'Synthetic Alpha', 37.009]]);
    expect(calls).toHaveLength(4);
    expect(calls.every(url => url.origin === 'https://places-api.arcgis.com')).toBe(true);
    expect(calls[1]!.searchParams.get('x')).toBe('-122');
    expect(calls[1]!.searchParams.get('y')).toBe('37');
    expect(calls.slice(2).every(url => !url.searchParams.get('requestedFields')?.includes('all'))).toBe(true);
  });
});
