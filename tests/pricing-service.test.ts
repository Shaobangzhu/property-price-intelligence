import { describe, expect, it, vi } from 'vitest';
import type { PropertyService } from '../server/src/properties/service.js';
import type { MarketEvidenceService } from '../server/src/market/service.js';
import { PricingPreviewService } from '../server/src/pricing/service.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = '2026-09-29T00:00:00.000Z';
const sale = (index: number, price: number) => ({ id: `sale:${index}`, evidenceType: 'RECORDED_SALE', providerId: `sale-${index}`,
  address: `${index} Main St`, latitude: 30.1, longitude: -97.1, propertyType: 'Condo', bedrooms: 2, bathrooms: 2,
  livingAreaSqft: 1000, lotSizeSqft: null, yearBuilt: null, price,
  eventDate: new Date(Date.parse(now) - (index + 1) * 30 * 86_400_000).toISOString(), distanceMiles: index * 0.5, source: 'RENTCAST' });

describe('pricing preview service', () => {
  it('uses validated effective subject facts and separated saved market groups', async () => {
    const property = { property: { id, provider: 'RENTCAST', providerPropertyId: 'subject', normalizedAddressKey: '123mainst',
      formattedAddress: '123 Main St, Austin, TX 78701', addressLine1: '123 Main St', unit: null, city: 'Austin', state: 'TX', zipCode: '78701',
      latitude: 30.1, longitude: -97.1, propertyType: 'Condo', bedrooms: 2, bathrooms: 2, livingAreaSqft: 1200, lotSizeSqft: null,
      yearBuilt: null, currentListPrice: null, refreshFailedAt: null, notes: null,
      userOverrides: { livingAreaSqft: { value: 1000, source: 'USER', updatedAt: now } },
      effectiveValues: { bedrooms: 2, bathrooms: 2, livingAreaSqft: 1000, yearBuilt: null }, createdAt: now, updatedAt: now },
      cache: { source: 'RENTCAST', fetchedAt: now, expiresAt: '2026-10-13T00:00:00.000Z', freshness: 'FRESH', cacheStatus: 'HIT' } };
    const query = { latitude: 30.1, longitude: -97.1, radiusMiles: 2, limit: 25, saleDateRangeDays: 365 };
    const group = (kind: 'RECORDED_SALES' | 'ACTIVE_LISTINGS') => ({ kind, candidates: kind === 'RECORDED_SALES'
      ? [sale(0, 200000), sale(1, 220000), sale(2, 240000)]
      : [{ ...sale(3, 9_000_000), id: 'ask:1', evidenceType: 'ACTIVE_ASKING_PRICE' }], source: 'RENTCAST', freshness: 'FRESH',
      cacheStatus: 'HIT', fetchedAt: now, expiresAt: '2026-10-06T00:00:00.000Z', query: { ...query, saleDateRangeDays: kind === 'RECORDED_SALES' ? 365 : null }, errorCode: null });
    const properties = { get: vi.fn().mockResolvedValue(property) } as unknown as PropertyService;
    const marketGet = vi.fn().mockResolvedValue({ propertyId: id, recordedSales: group('RECORDED_SALES'), activeListings: group('ACTIVE_LISTINGS') });
    const market = { getForSubject: marketGet } as unknown as MarketEvidenceService;
    const service = new PricingPreviewService(properties, market, () => new Date(now));
    const result = await service.preview(id, { mode: 'OFFER', strategyProfile: 'BALANCED' });
    expect(result.status).toBe('READY');
    expect(result.engineVersion).toBe('ppi-pricing-v1');
    expect(result.referencePrice).toBe(220000);
    expect(result.calculationTrace.subjectAreaSqft).toBe(1000);
    expect(result.assumptions.some(text => text.includes('livingAreaSqft'))).toBe(true);
    expect(result.activeListingContext).toHaveLength(1);
    expect(result.activeListingContext[0]?.position).toBe('ABOVE_RANGE');
    expect(result.activeListingContext[0]?.reasonCode).toBe('ACTIVE_ASK_CONTEXT_ONLY');
    expect(result.includedComparables).toHaveLength(3);
    expect(properties.get).toHaveBeenCalledWith(id);
    expect(market.getForSubject).toHaveBeenCalledWith(property.property);
    marketGet.mockImplementationOnce(async subject => {
      // Simulate a refresh replacing current provider facts while comps load.
      property.property.latitude = 31;
      property.property.effectiveValues.livingAreaSqft = 1600;
      expect(subject.latitude).toBe(30.1);
      return { propertyId: id, recordedSales: group('RECORDED_SALES'), activeListings: group('ACTIVE_LISTINGS') };
    });
    const frozen = await service.prepareInput(id, { mode: 'OFFER', strategyProfile: 'BALANCED' });
    expect(frozen.subject.livingAreaSqft).toBe(1000);
    marketGet.mockResolvedValueOnce({ propertyId: id, recordedSales: { ...group('RECORDED_SALES'), candidates: [group('ACTIVE_LISTINGS').candidates[0]] }, activeListings: group('ACTIVE_LISTINGS') });
    await expect(service.preview(id, { mode: 'OFFER', strategyProfile: 'BALANCED' })).rejects.toMatchObject({ code: 'INVALID_MARKET_EVIDENCE' });
  });
});
