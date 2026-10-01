import { describe, expect, it, vi } from 'vitest';
import type { MarketEvidenceKind, MarketQuery } from '@ppi/shared';
import { ProviderError } from '../server/src/properties/provider.js';
import type { PropertyRepository, StoredRecord } from '../server/src/properties/repository.js';
import { distanceMiles, normalizeMarketResponse, RentCastMarketProvider } from '../server/src/market/provider.js';
import type { EvidenceSnapshot, MarketRepository } from '../server/src/market/repository.js';
import { MarketEvidenceService, parseMarketPolicy } from '../server/src/market/service.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const subject = { providerPropertyId: 'subject-1', formattedAddress: '123 Main St, Austin, TX 78701', latitude: 30.1, longitude: -97.1 };
const query: MarketQuery = { latitude: 30.1, longitude: -97.1, radiusMiles: 2, limit: 25, saleDateRangeDays: 365 };
const sale = { id: 'sale-1', formattedAddress: '125 Main St, Austin, TX 78701', latitude: 30.11, longitude: -97.11, lastSalePrice: 410000, lastSaleDate: '2026-06-01T00:00:00.000Z' };
const listing = { id: 'listing-1', formattedAddress: '130 Main St, Austin, TX 78701', latitude: 30.12, longitude: -97.12, status: 'Active', price: 450000, listedDate: '2026-09-01T00:00:00.000Z' };

function setup() {
  let now = new Date('2026-09-29T12:00:00.000Z');
  const record = { property: { id, ...subject }, snapshot: null } as unknown as StoredRecord;
  const properties = { findById: vi.fn(async () => record) } as unknown as PropertyRepository;
  const snapshots = new Map<string, EvidenceSnapshot>();
  const repository: MarketRepository = {
    latest: vi.fn(async (_id, kind, hash) => snapshots.get(`${kind}:${hash}`) ?? null),
    save: vi.fn(async (_id, kind, hash, snapshot) => { snapshots.set(`${kind}:${hash}`, snapshot); })
  };
  const search = vi.fn(async (kind: MarketEvidenceKind, input: MarketQuery) => normalizeMarketResponse(kind === 'RECORDED_SALES' ? [sale] : [listing], kind, input, subject));
  const provider = { name: 'RENTCAST' as const, search };
  const service = new MarketEvidenceService(properties, repository, provider, undefined, () => now);
  return { service, search, properties, repository, snapshots, advance: (hours: number) => { now = new Date(now.getTime() + hours * 3_600_000); } };
}

describe('market evidence semantics and cache', () => {
  it('keeps recorded sales distinct from active listing asks and nulls missing fields', () => {
    const sales = normalizeMarketResponse([sale, { ...sale, id: 'incomplete', lastSalePrice: null }], 'RECORDED_SALES', query, subject);
    const listings = normalizeMarketResponse([listing, { ...listing, id: 'inactive', status: 'Inactive' }], 'ACTIVE_LISTINGS', query, subject);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ evidenceType: 'RECORDED_SALE', price: 410000, bedrooms: null, bathrooms: null, lotSizeSqft: null });
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({ evidenceType: 'ACTIVE_ASKING_PRICE', price: 450000, bedrooms: null });
    expect(sales[0]?.id).not.toBe(listings[0]?.id);
  });

  it('calculates miles and rejects out-of-radius results without replacing missing coordinates', () => {
    expect(distanceMiles({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(69.09, 1);
    expect(normalizeMarketResponse([{ ...listing, latitude: null, longitude: null }], 'ACTIVE_LISTINGS', query, subject)[0]?.distanceMiles).toBeNull();
    expect(normalizeMarketResponse([{ ...sale, latitude: 31 }], 'RECORDED_SALES', query, subject)).toHaveLength(0);
  });

  it('excludes the subject despite street/unit abbreviation differences while retaining other units', () => {
    const apartment = { ...subject, providerPropertyId: null, formattedAddress: '123 Main St, Apt 2, Austin, TX 78701' };
    const rows = [
      { ...sale, id: 'subject-variant', formattedAddress: '123 MAIN STREET, APARTMENT 2, AUSTIN, TX 78701' },
      { ...sale, id: 'other-unit', formattedAddress: '123 Main Street, Apartment 3, Austin, TX 78701' }
    ];
    expect(normalizeMarketResponse(rows, 'RECORDED_SALES', query, apartment).map(row => row.providerId)).toEqual(['other-unit']);
    expect(normalizeMarketResponse([{ ...listing, formattedAddress: '123 Main Street, Apartment 2, Austin, TX 78701' }], 'ACTIVE_LISTINGS', query, apartment)).toEqual([]);
  });

  it('applies independent seven-day and 24-hour policies, then preserves stale timestamps on provider failure', async () => {
    const { service, search, repository, advance } = setup();
    const initial = await service.get(id);
    expect(initial.recordedSales.expiresAt).toBe('2026-10-06T12:00:00.000Z');
    expect(initial.activeListings.expiresAt).toBe('2026-09-30T12:00:00.000Z');
    await service.get(id);
    expect(search).toHaveBeenCalledTimes(2);
    advance(25);
    search.mockRejectedValueOnce(new ProviderError('UPSTREAM'));
    const next = await service.get(id);
    expect(next.recordedSales.cacheStatus).toBe('HIT');
    expect(next.activeListings.cacheStatus).toBe('STALE_FALLBACK');
    expect(next.activeListings.fetchedAt).toBe(initial.activeListings.fetchedAt);
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('queries the captured analysis subject without re-reading refreshed coordinates', async () => {
    const { service, search, properties } = setup();
    const captured = { id, ...subject, latitude: 30.09 };
    await service.getForSubject(captured);
    expect(properties.findById).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(2);
    for (const call of search.mock.calls) expect(call[1].latitude).toBe(captured.latitude);
  });

  it('uses two bounded RentCast requests with no offset, retries, or raw payload exposure', async () => {
    const calls: URL[] = [];
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(new URL(String(input)));
      return Response.json(calls.length === 1 ? [sale] : [listing]);
    }) as unknown as typeof fetch;
    const provider = new RentCastMarketProvider('synthetic-test-key', transport);
    await provider.search('RECORDED_SALES', query, subject);
    await provider.search('ACTIVE_LISTINGS', { ...query, saleDateRangeDays: null }, subject);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.searchParams.get('saleDateRange')).toBe('365');
    expect(calls[1]?.searchParams.get('status')).toBe('Active');
    expect(calls.every(url => url.searchParams.get('limit') === '25' && !url.searchParams.has('offset'))).toBe(true);
  });

  it('rejects invalid policy bounds by variable name only', () => {
    expect(() => parseMarketPolicy({ MARKET_RADIUS_MILES: '200' })).toThrow('MARKET_RADIUS_MILES');
  });
});
