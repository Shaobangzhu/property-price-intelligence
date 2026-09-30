import { createHash } from 'node:crypto';
import type { MarketContextResponse, MarketEvidenceGroup, MarketEvidenceKind, MarketQuery } from '@ppi/shared';
import type { PropertyRepository } from '../properties/repository.js';
import { PropertyError } from '../properties/service.js';
import { ProviderError } from '../properties/provider.js';
import type { MarketEvidenceProvider } from './provider.js';
import type { EvidenceSnapshot, MarketRepository } from './repository.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type MarketPolicy = { radiusMiles: number; resultLimit: number; saleDateRangeDays: number; salesTtlHours: number; listingsTtlHours: number };
export const DEFAULT_MARKET_POLICY: MarketPolicy = { radiusMiles: 2, resultLimit: 25, saleDateRangeDays: 365, salesTtlHours: 168, listingsTtlHours: 24 };
export function parseMarketPolicy(env: NodeJS.ProcessEnv): MarketPolicy {
  const bounded = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid configuration: ${name}`);
    return value;
  };
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = bounded(name, fallback, min, max);
    if (!Number.isInteger(value)) throw new Error(`Invalid configuration: ${name}`);
    return value;
  };
  return {
    radiusMiles: bounded('MARKET_RADIUS_MILES', 2, 0.1, 10),
    resultLimit: integer('MARKET_RESULT_LIMIT', 25, 1, 100),
    saleDateRangeDays: integer('MARKET_SALE_DATE_DAYS', 365, 1, 1095),
    salesTtlHours: integer('MARKET_SALES_TTL_HOURS', 168, 1, 720),
    listingsTtlHours: integer('MARKET_LISTINGS_TTL_HOURS', 24, 1, 168)
  };
}

export class MarketEvidenceService {
  private readonly pending = new Map<string, Promise<MarketEvidenceGroup>>();
  constructor(private readonly properties: PropertyRepository, private readonly repository: MarketRepository,
    private readonly provider: MarketEvidenceProvider, private readonly policy: MarketPolicy = DEFAULT_MARKET_POLICY,
    private readonly now: () => Date = () => new Date()) {}

  async get(propertyId: string): Promise<MarketContextResponse> {
    const record = await this.properties.findById(propertyId);
    if (!record) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
    const { latitude, longitude, providerPropertyId, formattedAddress } = record.property;
    if (latitude === null || longitude === null) {
      const unavailable = (kind: MarketEvidenceKind): MarketEvidenceGroup => ({ kind, candidates: [], source: null,
        freshness: 'UNAVAILABLE', cacheStatus: 'NO_COORDINATES', fetchedAt: null, expiresAt: null, query: null, errorCode: 'SUBJECT_COORDINATES_MISSING' });
      return { propertyId, recordedSales: unavailable('RECORDED_SALES'), activeListings: unavailable('ACTIVE_LISTINGS') };
    }
    const subject = { latitude, longitude, providerPropertyId, formattedAddress };
    const [recordedSales, activeListings] = await Promise.all([
      this.group(propertyId, 'RECORDED_SALES', subject), this.group(propertyId, 'ACTIVE_LISTINGS', subject)
    ]);
    return { propertyId, recordedSales, activeListings };
  }

  private group(propertyId: string, kind: MarketEvidenceKind, subject: { latitude: number; longitude: number; providerPropertyId: string | null; formattedAddress: string }): Promise<MarketEvidenceGroup> {
    const query: MarketQuery = { latitude: subject.latitude, longitude: subject.longitude,
      radiusMiles: this.policy.radiusMiles, limit: this.policy.resultLimit,
      saleDateRangeDays: kind === 'RECORDED_SALES' ? this.policy.saleDateRangeDays : null };
    const queryHash = digest({ kind, query, ttlHours: kind === 'RECORDED_SALES' ? this.policy.salesTtlHours : this.policy.listingsTtlHours });
    const key = `${propertyId}:${kind}:${queryHash}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = this.loadGroup(propertyId, kind, query, queryHash, subject).finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    });
    this.pending.set(key, pending);
    return pending;
  }

  private async loadGroup(propertyId: string, kind: MarketEvidenceKind, query: MarketQuery, queryHash: string,
    subject: { latitude: number; longitude: number; providerPropertyId: string | null; formattedAddress: string }): Promise<MarketEvidenceGroup> {
    const previous = await this.repository.latest(propertyId, kind, queryHash);
    const envelope = (snapshot: EvidenceSnapshot, cacheStatus: MarketEvidenceGroup['cacheStatus'], freshness: MarketEvidenceGroup['freshness']): MarketEvidenceGroup =>
      ({ kind, candidates: snapshot.candidates, source: 'RENTCAST', freshness, cacheStatus,
        fetchedAt: snapshot.fetchedAt, expiresAt: snapshot.expiresAt, query: snapshot.query, errorCode: null });
    if (previous && new Date(previous.expiresAt).getTime() > this.now().getTime()) return envelope(previous, 'HIT', 'FRESH');
    try {
      const candidates = await this.provider.search(kind, query, subject);
      const fetchedAt = this.now();
      const snapshot: EvidenceSnapshot = { candidates, query, fetchedAt: fetchedAt.toISOString(),
        expiresAt: new Date(fetchedAt.getTime() + (kind === 'RECORDED_SALES' ? this.policy.salesTtlHours : this.policy.listingsTtlHours) * 3_600_000).toISOString() };
      await this.repository.save(propertyId, kind, queryHash, snapshot, digest(candidates));
      return envelope(snapshot, previous ? 'REFRESHED' : 'MISS', 'FRESH');
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      if (previous) return { ...envelope(previous, 'STALE_FALLBACK', 'STALE'), errorCode: error.code };
      return { kind, candidates: [], source: null, freshness: 'UNAVAILABLE', cacheStatus: 'ERROR',
        fetchedAt: null, expiresAt: null, query, errorCode: error.code };
    }
  }
}
