import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { NearbySchool } from '@ppi/shared';
import type { StoredProperty } from '../properties/repository.js';
import { distanceMiles } from '../market/provider.js';

// Official public-domain school points; never an attendance-assignment source.
export const NCES_SCHOOL_LAYER = 'https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2425/MapServer/0';
export const SCHOOL_LOCATION_SOURCE = 'NCES_EDGE_2024_25' as const;
type Subject = Pick<StoredProperty, 'latitude' | 'longitude' | 'city' | 'state'>;
export interface SchoolLocationSource { locate(subject: Subject, schools: NearbySchool[]): Promise<NearbySchool[]>; }
const text = z.string().trim().min(1).max(250);
const responseSchema = z.object({
  spatialReference: z.object({ wkid: z.literal(4326) }),
  exceededTransferLimit: z.boolean().optional(),
  features: z.array(z.object({ attributes: z.object({ NCESSCH: text, NAME: text, CITY: text, STATE: z.string().length(2), SCHOOLYEAR: text }),
    geometry: z.object({ x: z.number().finite().min(-180).max(180), y: z.number().finite().min(-90).max(90) }).nullable()
  })).max(200)
});
type Reference = z.infer<typeof responseSchema>['features'][number];
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+school$/, '');
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const MAX_BYTES = 256 * 1024;
const TTL_MS = 10 * 60 * 1000;

/** Match only schools already returned by Zillapi; don't add nearby reference schools. */
export function matchSchoolLocations(subject: Subject, schools: NearbySchool[], references: Reference[]): NearbySchool[] {
  const { latitude, longitude } = subject;
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return schools;
  return schools.map(school => {
    if (school.latitude !== null && school.longitude !== null) return school;
    const matches = references.filter(reference => {
      if (!reference.geometry || reference.attributes.STATE !== subject.state.toUpperCase() ||
        normalize(reference.attributes.NAME) !== normalize(school.name)) return false;
      const miles = distanceMiles({ latitude, longitude }, { latitude: reference.geometry.y, longitude: reference.geometry.x });
      // Distances corroborate identity, never determine attendance or select the nearest school.
      if (miles > 25) return false;
      return school.distanceMiles !== null
        ? Math.abs(miles - school.distanceMiles) <= Math.max(0.75, school.distanceMiles * 0.25)
        : miles <= 10 && normalize(reference.attributes.CITY) === normalize(subject.city);
    });
    // Repeated features for one NCES identity are acceptable only at the same point.
    const identities = new Map(matches.map(match => [`${match.attributes.NCESSCH}:${match.geometry!.x}:${match.geometry!.y}`, match]));
    if (identities.size !== 1) return school;
    const matched = [...identities.values()][0]!;
    return { ...school, latitude: matched.geometry!.y, longitude: matched.geometry!.x, locationSource: SCHOOL_LOCATION_SOURCE };
  });
}

export class NcesSchoolLocations implements SchoolLocationSource {
  private cache = new Map<string, { expiresAt: number; schools: NearbySchool[] }>();
  private active: { key: string; promise: Promise<NearbySchool[]> } | null = null;
  constructor(private readonly transport: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  async locate(subject: Subject, schools: NearbySchool[]): Promise<NearbySchool[]> {
    if (!schools.length || schools.every(school => school.latitude !== null && school.longitude !== null) ||
      subject.latitude === null || subject.longitude === null || !/^[A-Z]{2}$/i.test(subject.state)) return schools;
    const key = createHash('sha256').update(JSON.stringify([subject.latitude, subject.longitude, subject.city, subject.state, schools])).digest('hex');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.schools);
    if (this.active) {
      if (this.active.key !== key) throw new Error('SCHOOL_LOCATIONS_BUSY');
      return structuredClone(await this.active.promise);
    }
    const promise = this.query(subject, schools);
    this.active = { key, promise };
    try {
      const result = await promise;
      for (const [entryKey, entry] of this.cache) if (entry.expiresAt <= this.now()) this.cache.delete(entryKey);
      this.cache.delete(key);
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expiresAt: this.now() + TTL_MS, schools: structuredClone(result) });
      return result;
    } finally { this.active = null; }
  }

  private async query(subject: Subject, schools: NearbySchool[]): Promise<NearbySchool[]> {
    const names = [...new Set(schools.filter(school => school.latitude === null || school.longitude === null).flatMap(school =>
      [school.name.toUpperCase(), school.name.replace(/\s+school$/i, '').toUpperCase()]))];
    const params = new URLSearchParams({ f: 'json', where: `STATE = ${quote(subject.state.toUpperCase())} AND UPPER(NAME) IN (${names.map(quote).join(',')})`,
      outFields: 'NCESSCH,NAME,CITY,STATE,SCHOOLYEAR', returnGeometry: 'true', outSR: '4326', resultRecordCount: '200' });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let body: ReadableStream<Uint8Array> | null = null;
    try {
      // Only public school names and state leave PPI. Subject addresses/coordinates stay local.
      const response = await this.transport(`${NCES_SCHOOL_LAYER}/query`, { method: 'POST', body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000), redirect: 'error' });
      body = response.body;
      if (!response.ok || !body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error();
      reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error();
        chunks.push(chunk.value);
      }
      const parsed = responseSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!parsed.success || parsed.data.exceededTransferLimit || parsed.data.features.length >= 200) throw new Error();
      return matchSchoolLocations(subject, schools, parsed.data.features);
    } catch { throw new Error('SCHOOL_LOCATIONS_UNAVAILABLE'); }
    finally {
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      else if (body) void body.cancel().catch(() => {});
    }
  }
}
