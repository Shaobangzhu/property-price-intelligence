import { describe, expect, it, vi } from 'vitest';
import { NearbySchool } from '@ppi/shared';
import { NcesSchoolLocations, NCES_SCHOOL_LAYER, matchSchoolLocations } from '../server/src/context/school-locations.js';

const subject = { latitude: 30, longitude: -97, city: 'Synthetic City', state: 'TX' };
const school = NearbySchool.parse({ id: 'school:synthetic', name: 'Synthetic High School', level: 'HIGH', levelLabel: 'High',
  schoolType: 'public', rating: 7, distanceMiles: 0.7, latitude: null, longitude: null });
const reference = { attributes: { NCESSCH: 'synthetic-1', NAME: 'Synthetic High', CITY: 'Synthetic City', STATE: 'TX', SCHOOLYEAR: '2024-2025' },
  geometry: { x: -97, y: 30.01 } };
const payload = (features = [reference]) => ({ spatialReference: { wkid: 4326 }, features });

describe('official school location matching', () => {
  it('adds a corroborated school point and provenance without changing the provider school identity or metadata', () => {
    const result = matchSchoolLocations(subject, [school], [reference]);
    expect(result).toEqual([{ ...school, latitude: 30.01, longitude: -97, locationSource: 'NCES_EDGE_2024_25' }]);
    expect(school.latitude).toBeNull();
    expect(result[0]?.distanceMiles).toBe(school.distanceMiles);
  });

  it.each([
    { ...reference, attributes: { ...reference.attributes, NAME: 'Different High' } },
    { ...reference, attributes: { ...reference.attributes, STATE: 'CA' } },
    { ...reference, geometry: { x: -100, y: 35 } },
    { ...reference, geometry: null }
  ])('does not use a nonmatching, remote or missing school point', candidate => {
    expect(matchSchoolLocations(subject, [school], [candidate])).toEqual([school]);
  });

  it('does not infer a school point from name alone when reported distance conflicts', () => {
    const distant = { ...reference, geometry: { x: -97, y: 30.1 } };
    expect(matchSchoolLocations(subject, [school], [distant])).toEqual([school]);
  });

  it('rejects ambiguous identities or conflicting locations rather than choosing the nearest', () => {
    expect(matchSchoolLocations(subject, [school], [reference, { ...reference, attributes: { ...reference.attributes, NCESSCH: 'synthetic-2' } }])).toEqual([school]);
    expect(matchSchoolLocations(subject, [school], [reference, { ...reference, geometry: { x: -97, y: 30.011 } }])).toEqual([school]);
    expect(matchSchoolLocations(subject, [school], [reference, reference])[0]?.locationSource).toBe('NCES_EDGE_2024_25');
  });

  it('requires matching city and a bounded local distance when provider distance is missing', () => {
    const noDistance = { ...school, distanceMiles: null };
    expect(matchSchoolLocations(subject, [noDistance], [reference])[0]?.latitude).toBe(30.01);
    expect(matchSchoolLocations({ ...subject, city: 'Other city' }, [noDistance], [reference])).toEqual([noDistance]);
  });

  it('keeps unmatched schools and does not create new schools from reference data', () => {
    const other = { ...school, id: 'school:other', name: 'Unmatched School' };
    const result = matchSchoolLocations(subject, [school, other], [reference]);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(other);
    expect(matchSchoolLocations(subject, [], [reference])).toEqual([]);
    expect(matchSchoolLocations({ ...subject, latitude: null }, [school], [reference])).toEqual([school]);
  });
});

describe('bounded NCES transport', () => {
  it('sends only public school names/state to the trusted official URL and caches safe results', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(payload()));
    const locations = new NcesSchoolLocations(transport);
    const result = await locations.locate(subject, [school]);
    expect(result[0]?.latitude).toBe(30.01);
    const [input, init] = transport.mock.calls[0]!;
    expect(input).toBe(`${NCES_SCHOOL_LAYER}/query`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) });
    const params = init!.body as URLSearchParams;
    expect(params.get('where')).toBe("STATE = 'TX' AND UPPER(NAME) IN ('SYNTHETIC HIGH SCHOOL','SYNTHETIC HIGH')");
    expect(params.get('outSR')).toBe('4326');
    expect(params.get('resultRecordCount')).toBe('200');
    expect(params.has('geometry')).toBe(false);
    expect(params.has('address')).toBe(false);
    expect(params.has('token')).toBe(false);
    expect(params.toString()).not.toMatch(/-97|Synthetic\+City/);
    result[0]!.latitude = 0;
    expect((await locations.locate(subject, [school]))[0]?.latitude).toBe(30.01);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('escapes SQL quote characters in provider school names', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(payload([])));
    await new NcesSchoolLocations(transport).locate(subject, [{ ...school, name: "Synthetic O'Neil School" }]);
    expect((transport.mock.calls[0]![1]!.body as URLSearchParams).get('where')).toContain("'SYNTHETIC O''NEIL SCHOOL'");
  });

  it.each([
    { ...payload(), exceededTransferLimit: true },
    { ...payload(), spatialReference: { wkid: 3857 } },
    { ...payload(), features: Array(200).fill(reference) },
    { error: { message: 'synthetic-secret' } },
    { ...payload(), features: [{ ...reference, geometry: { x: 999, y: 999 } }] }
  ])('rejects truncated, malformed and unprojected results with a fixed safe error', async data => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(data));
    await expect(new NcesSchoolLocations(transport).locate(subject, [school])).rejects.toThrow(/^SCHOOL_LOCATIONS_UNAVAILABLE$/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid-json', 'oversized', 'http', 'timeout'])('sanitizes %s and never retries', async scenario => {
    const transport = vi.fn<typeof fetch>(async () => {
      if (scenario === 'timeout') throw new DOMException('synthetic-secret', 'TimeoutError');
      return scenario === 'invalid-json' ? new Response('{') : scenario === 'oversized' ? new Response('x'.repeat(262145)) : new Response('synthetic-secret', { status: 500 });
    });
    await expect(new NcesSchoolLocations(transport).locate(subject, [school])).rejects.toThrow(/^SCHOOL_LOCATIONS_UNAVAILABLE$/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('skips unnecessary queries for empty schools, missing subject coordinates, or already located schools', async () => {
    const transport = vi.fn<typeof fetch>();
    const locations = new NcesSchoolLocations(transport);
    await locations.locate(subject, []);
    await locations.locate({ ...subject, latitude: null }, [school]);
    await locations.locate(subject, [{ ...school, latitude: 30.01, longitude: -97 }]);
    expect(transport).not.toHaveBeenCalled();
  });

  it('singleflights identical lookups and bounds concurrent work', async () => {
    let release!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const locations = new NcesSchoolLocations(transport);
    const first = locations.locate(subject, [school]);
    const second = locations.locate(subject, [school]);
    await expect(locations.locate({ ...subject, latitude: 30.1 }, [school])).rejects.toThrow('SCHOOL_LOCATIONS_BUSY');
    release(Response.json(payload()));
    expect(await first).toEqual(await second);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('expires the cache after ten minutes and bounds it to 32 subjects', async () => {
    let time = 0;
    const transport = vi.fn<typeof fetch>(async () => Response.json(payload()));
    const locations = new NcesSchoolLocations(transport, () => time);
    await locations.locate(subject, [school]);
    time = 600001;
    await locations.locate(subject, [school]);
    expect(transport).toHaveBeenCalledTimes(2);
    for (let i = 1; i <= 32; i++) await locations.locate({ ...subject, city: `Synthetic ${i}` }, [school]);
    await locations.locate(subject, [school]);
    expect(transport).toHaveBeenCalledTimes(35);
  });
});
