import { describe, expect, it, vi } from 'vitest';
import { OfficialGisLayers } from '@ppi/shared';
import type { PropertyRepository, StoredRecord } from '../server/src/properties/repository.js';
import { CalFireWildfireProvider, CgsFaultProvider, HazardContextService, OfficialArcGisQuery, pointToFaultMiles, type GisQuery } from '../server/src/context/hazards.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const point = { latitude: 37.7793, longitude: -122.4193 };
const subject = { property: { id, ...point }, snapshot: null } as unknown as StoredRecord;
const repository = () => ({ findById: vi.fn(async () => subject), saveProfile: vi.fn(), patch: vi.fn() }) as unknown as PropertyRepository;
const feature = (attributes: Record<string, unknown>, geometry?: unknown) => ({ attributes, geometry });

describe('official wildfire context', () => {
  it('reports intersection with a documented CAL FIRE classification and source version', async () => {
    const gis: GisQuery = { query: vi.fn(async url => url === OfficialGisLayers.responsibility ? { features: [feature({ SRA: 'SRA' })] }
      : { features: [feature({ FHSZ_Description: 'Very High' })] }) };
    const result = await new CalFireWildfireProvider(gis).check(point);
    expect(result).toEqual({ status: 'INSIDE_DISPLAYED_ZONE', classification: 'Very High', responsibilityArea: 'SRA', sourceVersion: 'effective 2024-04-01' });
    expect(gis.query).toHaveBeenCalledWith(OfficialGisLayers.wildfireSra, expect.any(URLSearchParams));
    expect((gis.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].get('geometry')).toBe('-122.4193,37.7793');
  });

  it('treats CAL FIRE LRA NonWildland as outside displayed zones, without a safety claim', async () => {
    const gis: GisQuery = { query: vi.fn(async url => url === OfficialGisLayers.responsibility ? { features: [feature({ SRA: 'LRA' })] }
      : { features: [feature({ FHSZ_Description: 'NonWildland' })] }) };
    const result = await new CalFireWildfireProvider(gis).check(point);
    expect(result).toMatchObject({ status: 'OUTSIDE_DISPLAYED_ZONE', classification: null, responsibilityArea: 'LRA', sourceVersion: 'recommended 2025-03-24' });
    expect(JSON.stringify(result).toLowerCase()).not.toContain('safe');
  });

  it('distinguishes coverage gaps from provider failure', async () => {
    const noCoverage = new CalFireWildfireProvider({ query: async () => ({ features: [] }) });
    expect((await noCoverage.check(point)).status).toBe('NO_COVERAGE');
    const failed = new HazardContextService(repository(), { check: async () => { throw new Error('offline'); } }, { check: async () => ({ status: 'NO_NEARBY_FEATURES', nearestFeatureName: null, distanceMiles: null }) }, () => new Date('2026-09-29T12:00:00.000Z'));
    const result = await failed.getWildfire(id);
    expect(result).toMatchObject({ status: 'UNAVAILABLE', sourceName: 'CAL FIRE Fire Hazard Severity Zones', checkedAt: '2026-09-29T12:00:00.000Z' });
  });
});

describe('CGS mapped fault traces', () => {
  it('calculates nearest point on a segment and ranks returned mapped traces', async () => {
    expect(pointToFaultMiles({ latitude: 0, longitude: 0 }, [[[0.1, -0.1], [0.1, 0.1]]])).toBeCloseTo(6.9172, 2);
    const gis: GisQuery = { query: vi.fn(async () => ({ features: [
      feature({ FLT_NAME: 'Distant trace' }, { paths: [[[-122.2, 37.7], [-122.2, 37.9]]] }),
      feature({ FLT_NAME: 'Near trace' }, { paths: [[[-122.4, 37.7], [-122.4, 37.9]]] })
    ] })) };
    const result = await new CgsFaultProvider(gis).check(point);
    expect(result).toMatchObject({ status: 'NEAREST_MAPPED_FAULT', nearestFeatureName: 'Near trace' });
    expect(result.distanceMiles).toBeCloseTo(1.05, 1);
    const query = (gis.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as URLSearchParams;
    expect(query.get('distance')).toBe(String(20 * 1609.344));
    expect(query.get('outFields')).toBe('OBJECTID,FLT_NAME');
    expect(query.get('returnGeometry')).toBe('true');
  });

  it('separates no nearby traces, no coverage, and truncated results', async () => {
    expect((await new CgsFaultProvider({ query: async () => ({ features: [] }) }).check(point)).status).toBe('NO_NEARBY_FEATURES');
    expect((await new CgsFaultProvider({ query: async () => { throw new Error('should not query'); } }).check({ latitude: 30, longitude: -100 })).status).toBe('NO_COVERAGE');
    const service = new HazardContextService(repository(), { check: async () => ({ status: 'NO_COVERAGE', classification: null, responsibilityArea: null, sourceVersion: null }) },
      new CgsFaultProvider({ query: async () => ({ features: [], exceededTransferLimit: true }) }));
    expect((await service.getFaults(id)).status).toBe('UNAVAILABLE');
  });

  it('bounds outbound government GIS calls and never exposes remote error payloads', async () => {
    const transport = vi.fn(async () => Response.json({ error: { code: 403, details: ['opaque remote data'] } })) as unknown as typeof fetch;
    const gis = new OfficialArcGisQuery(transport);
    await expect(gis.query(OfficialGisLayers.faultTraces, new URLSearchParams({ f: 'json' }))).rejects.toThrow('GIS_UNAVAILABLE');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]?.[0])).toContain('/FeatureServer/21/query?f=json');
  });
});
