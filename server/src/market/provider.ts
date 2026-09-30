import { createHash } from 'node:crypto';
import { MarketComparableCandidate, type MarketEvidenceKind, type MarketQuery } from '@ppi/shared';
import { ProviderError } from '../properties/provider.js';

type Subject = { providerPropertyId: string | null; formattedAddress: string; latitude: number; longitude: number };
export interface MarketEvidenceProvider {
  readonly name: 'RENTCAST';
  search(kind: MarketEvidenceKind, query: MarketQuery, subject: Subject): Promise<MarketComparableCandidate[]>;
}

export function distanceMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown, max = 250): string | null => typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null;
const num = (value: unknown, min: number, max: number): number | null => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const int = (value: unknown, min: number, max: number): number | null => { const result = num(value, min, max); return result !== null && Number.isInteger(result) ? result : null; };
const date = (value: unknown): string | null => { const valueText = str(value, 40); return valueText && !Number.isNaN(Date.parse(valueText)) ? new Date(valueText).toISOString() : null; };
const addressKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function normalizeMarketResponse(value: unknown, kind: MarketEvidenceKind, query: MarketQuery, subject: Subject): MarketComparableCandidate[] {
  if (!Array.isArray(value) || value.length > query.limit) throw new ProviderError('MALFORMED');
  const candidates: MarketComparableCandidate[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const raw = object(item);
    if (!raw) throw new ProviderError('MALFORMED');
    const address = str(raw.formattedAddress);
    if (!address) continue;
    const providerId = str(raw.id);
    if ((providerId && providerId === subject.providerPropertyId) || addressKey(address) === addressKey(subject.formattedAddress)) continue;
    if (kind === 'ACTIVE_LISTINGS' && raw.status !== 'Active') continue;
    const price = num(kind === 'RECORDED_SALES' ? raw.lastSalePrice : raw.price, 1, 1_000_000_000);
    const eventDate = date(kind === 'RECORDED_SALES' ? raw.lastSaleDate : raw.listedDate);
    // A record without a sale price and date does not establish a recorded transaction.
    if (kind === 'RECORDED_SALES' && (price === null || eventDate === null)) continue;
    const latitude = num(raw.latitude, -90, 90), longitude = num(raw.longitude, -180, 180);
    const distance = latitude === null || longitude === null ? null : distanceMiles(query, { latitude, longitude });
    if (distance !== null && distance > query.radiusMiles + 0.01) continue;
    const evidenceType = kind === 'RECORDED_SALES' ? 'RECORDED_SALE' : 'ACTIVE_ASKING_PRICE';
    const id = `${evidenceType.toLowerCase()}:${createHash('sha256').update(providerId ?? addressKey(address)).digest('hex').slice(0, 20)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push(MarketComparableCandidate.parse({
      id, evidenceType, providerId, address, latitude, longitude, propertyType: str(raw.propertyType),
      bedrooms: num(raw.bedrooms, 0, 100), bathrooms: num(raw.bathrooms, 0, 100),
      livingAreaSqft: int(raw.squareFootage, 1, 1_000_000), lotSizeSqft: int(raw.lotSize, 0, 100_000_000),
      yearBuilt: int(raw.yearBuilt, 1600, 2200), price, eventDate,
      distanceMiles: distance === null ? null : Math.round(distance * 100) / 100, source: 'RENTCAST'
    }));
  }
  return candidates;
}

export class RentCastMarketProvider implements MarketEvidenceProvider {
  readonly name = 'RENTCAST' as const;
  constructor(private readonly apiKey: string, private readonly transport: typeof fetch = fetch) {}

  async search(kind: MarketEvidenceKind, query: MarketQuery, subject: Subject): Promise<MarketComparableCandidate[]> {
    if (!this.apiKey) throw new ProviderError('CONFIGURATION');
    const url = new URL(kind === 'RECORDED_SALES' ? 'https://api.rentcast.io/v1/properties' : 'https://api.rentcast.io/v1/listings/sale');
    url.searchParams.set('latitude', String(query.latitude));
    url.searchParams.set('longitude', String(query.longitude));
    url.searchParams.set('radius', String(query.radiusMiles));
    url.searchParams.set('limit', String(query.limit));
    if (kind === 'RECORDED_SALES') url.searchParams.set('saleDateRange', String(query.saleDateRangeDays));
    else url.searchParams.set('status', 'Active');
    let response: Response;
    try { response = await this.transport(url, { headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'error' }); }
    catch (error) { throw new ProviderError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'UPSTREAM'); }
    if (response.status === 401 || response.status === 403) throw new ProviderError('AUTH');
    if (response.status === 429) throw new ProviderError('RATE_LIMIT');
    if (!response.ok) throw new ProviderError('UPSTREAM');
    let body: string;
    try { body = await response.text(); } catch { throw new ProviderError('UPSTREAM'); }
    if (body.length > 3_000_000) throw new ProviderError('MALFORMED');
    let json: unknown;
    try { json = JSON.parse(body); } catch { throw new ProviderError('MALFORMED'); }
    return normalizeMarketResponse(json, kind, query, subject);
  }
}
