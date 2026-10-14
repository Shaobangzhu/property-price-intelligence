import { createHash } from 'node:crypto';
import { z } from 'zod';
import { NearbySchool } from '@ppi/shared';
import { addressMatches, normalizeAddressIdentity, requestedUnit } from '../properties/address.js';

// Nearby school metadata only: none of these fields establish attendance eligibility.
const text = z.string().trim().min(1).max(250);
const school = z.object({
  name: text, rating: z.number().finite().min(0).max(10).nullable().optional(),
  distance: z.number().finite().min(0).nullable().optional(),
  type: text.nullable().optional(), level: text.nullable().optional()
}).passthrough();
const schools = z.array(school).max(100);
const propertyResponse = z.object({ data: z.object({
  zpid: z.string().regex(/^\d{1,30}$/).nullable().optional(),
  address: z.object({ streetAddress: text, city: text, state: z.string().length(2), zipcode: z.string().regex(/^\d{5}(?:-\d{4})?$/) }),
  schools: schools.nullable().optional()
}).passthrough() });
const schoolsResponse = z.object({ data: schools });
// Hypothetical names are inspected for presence ONLY, never interpreted as proof.
const assignmentFieldNames = ['isAssigned', 'assigned', 'attendanceZone', 'schoolAssignment'] as const;
function assignmentFields(records: Record<string, unknown>[]): string[] {
  return assignmentFieldNames.filter(key => records.some(record => Object.hasOwn(record, key)));
}

export type ZillapiRequestMetadata = {
  endpoint: 'BY_ADDRESS' | 'SCHOOLS'; httpStatus: number | null; creditsCharged: number | null; durationMs: number;
};
export type ZillapiDiagnostic = {
  cacheHit: boolean; requestCount: number; requests: ZillapiRequestMetadata[];
  hasZpid: boolean; hasSchoolRecords: boolean; assignmentRelatedFields: string[];
  semanticsVerified: false;
};
export type ZillapiSchoolLookup = { schools: NearbySchool[] | null; diagnostic: ZillapiDiagnostic };
export type ZillapiErrorCode = 'CONFIGURATION' | 'INPUT' | 'BUSY' | 'AUTH' | 'CREDITS_EXHAUSTED' |
  'RATE_LIMIT' | 'NOT_FOUND' | 'TIMEOUT' | 'UPSTREAM' | 'MALFORMED' | 'SUBJECT_MISMATCH';
export class ZillapiError extends Error {
  constructor(readonly code: ZillapiErrorCode, readonly requests: ZillapiRequestMetadata[] = []) { super(code); }
}

const MAX_BYTES = 256 * 1024;
// The authorized address diagnostic took ~24s; allow headroom for upstream work.
export const ZILLAPI_REQUEST_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 32;
function credits(response: Response): number | null {
  const value = response.headers.get('X-Credits-Charged');
  return value !== null && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

/** Backend-only transport; only allowlisted nearby metadata and safe diagnostics escape. */
export class ZillapiClient {
  private active: { key: string; promise: Promise<ZillapiSchoolLookup> } | null = null;
  private cache = new Map<string, { expiresAt: number; result: ZillapiSchoolLookup }>();
  constructor(private readonly apiKey: string, private readonly transport: typeof fetch = fetch,
    private readonly now: () => number = Date.now) {}

  async inspectSchools(address: string): Promise<ZillapiDiagnostic> {
    return (await this.lookupSchools(address)).diagnostic;
  }

  async lookupSchools(address: string): Promise<ZillapiSchoolLookup> {
    if (!this.apiKey.trim()) throw new ZillapiError('CONFIGURATION');
    if (address.trim().length < 8 || address.length > 250) throw new ZillapiError('INPUT');
    const key = createHash('sha256').update(normalizeAddressIdentity(address)).digest('hex');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return { ...structuredClone(cached.result), diagnostic: {
      ...structuredClone(cached.result.diagnostic), cacheHit: true, requestCount: 0, requests: [] } };
    if (this.active) {
      if (this.active.key !== key) throw new ZillapiError('BUSY');
      return structuredClone(await this.active.promise);
    }
    const promise = this.lookup(address, key);
    this.active = { key, promise };
    try {
      const result = await promise;
      for (const [entryKey, entry] of this.cache) if (entry.expiresAt <= this.now()) this.cache.delete(entryKey);
      this.cache.delete(key);
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expiresAt: this.now() + CACHE_TTL_MS, result: structuredClone(result) });
      return result;
    } finally { this.active = null; }
  }

  private async lookup(address: string, subjectKey: string): Promise<ZillapiSchoolLookup> {
    const requests: ZillapiRequestMetadata[] = [];
    const url = new URL('https://api.zillapi.com/v1/properties/by-address');
    url.searchParams.set('address', address);
    url.searchParams.set('fields', 'zpid,address,schools');
    const raw = await this.request(url, 'BY_ADDRESS', requests);
    const parsed = propertyResponse.safeParse(raw);
    if (!parsed.success) throw new ZillapiError('MALFORMED', requests);
    const data = parsed.data.data;
    const returnedAddress = `${data.address.streetAddress}, ${data.address.city}, ${data.address.state} ${data.address.zipcode}`;
    if (!addressMatches(address, { formattedAddress: returnedAddress, unit: requestedUnit(data.address.streetAddress) })) {
      throw new ZillapiError('SUBJECT_MISMATCH', requests);
    }
    let entries = data.schools;
    // An explicit empty array is sufficient diagnostic evidence; don't spend a second credit.
    if (entries == null && data.zpid) {
      const rawSchools = await this.request(new URL(`https://api.zillapi.com/v1/properties/${data.zpid}/schools`), 'SCHOOLS', requests);
      const parsedSchools = schoolsResponse.safeParse(rawSchools);
      if (!parsedSchools.success) throw new ZillapiError('MALFORMED', requests);
      entries = parsedSchools.data.data;
    }
    const diagnostic: ZillapiDiagnostic = { cacheHit: false, requestCount: requests.length, requests, hasZpid: !!data.zpid,
      hasSchoolRecords: !!entries?.length, assignmentRelatedFields: assignmentFields([data, ...(entries ?? [])]),
      semanticsVerified: false };
    return { diagnostic, schools: entries == null ? null : entries.map((entry, index) => NearbySchool.parse({
      // Local display identity only; the documented response has no school ID.
      id: `school:${createHash('sha256').update(`${subjectKey}:${index}:${entry.name}`).digest('hex').slice(0, 20)}`,
      name: entry.name, level: ({ elementary: 'ELEMENTARY', middle: 'MIDDLE', high: 'HIGH' } as Record<string, string>)[entry.level?.toLowerCase() ?? ''] ?? 'OTHER',
      levelLabel: entry.level ?? null, schoolType: entry.type ?? null, rating: entry.rating ?? null,
      distanceMiles: entry.distance ?? null,
      // No documented school-coordinate fields; don't place schools at the subject point.
      latitude: null, longitude: null
    })) };
  }

  private async request(url: URL, endpoint: ZillapiRequestMetadata['endpoint'], requests: ZillapiRequestMetadata[]): Promise<unknown> {
    if (requests.length >= 2 || url.origin !== 'https://api.zillapi.com') throw new ZillapiError('CONFIGURATION', requests);
    const metadata: ZillapiRequestMetadata = { endpoint, httpStatus: null, creditsCharged: null, durationMs: 0 };
    requests.push(metadata);
    const started = performance.now();
    const signal = AbortSignal.timeout(ZILLAPI_REQUEST_TIMEOUT_MS);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let bodyStream: ReadableStream<Uint8Array> | null = null;
    try {
      const response = await this.transport(url, { method: 'GET', headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' }, redirect: 'error', signal });
      bodyStream = response.body;
      metadata.httpStatus = response.status;
      metadata.creditsCharged = credits(response);
      if (response.status === 401 || response.status === 403) throw new ZillapiError('AUTH');
      if (response.status === 402) throw new ZillapiError('CREDITS_EXHAUSTED');
      if (response.status === 429) throw new ZillapiError('RATE_LIMIT');
      if (response.status === 404) throw new ZillapiError('NOT_FOUND');
      if (response.status === 504) throw new ZillapiError('TIMEOUT');
      if (!response.ok) throw new ZillapiError('UPSTREAM');
      if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) throw new ZillapiError('MALFORMED');
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) throw new ZillapiError('MALFORMED');
        chunks.push(chunk.value);
      }
      const body = Buffer.concat(chunks);
      try { return JSON.parse(body.toString('utf8')) as unknown; }
      catch { throw new ZillapiError('MALFORMED'); }
    } catch (error) {
      const code = signal.aborted || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) ? 'TIMEOUT'
        : error instanceof ZillapiError ? error.code : 'UPSTREAM';
      throw new ZillapiError(code, requests);
    } finally {
      metadata.durationMs = Math.round(performance.now() - started);
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      else if (bodyStream) void bodyStream.cancel().catch(() => {});
    }
  }
}
