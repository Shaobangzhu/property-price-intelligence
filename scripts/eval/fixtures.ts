import type { PricingInput } from '@ppi/shared';

const asOf = '2026-09-29T00:00:00.000Z';
const sale = (id: string, price: number, daysAgo: number, distanceMiles: number) => ({
  id, providerId: id, address: `${id} Synthetic St`, evidenceType: 'RECORDED_SALE' as const,
  propertyType: 'Condo', price, eventDate: new Date(Date.parse(asOf) - daysAgo * 86_400_000).toISOString(),
  distanceMiles, livingAreaSqft: 1000, bedrooms: 2, bathrooms: 2
});
const base = (): PricingInput => ({
  subject: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', propertyType: 'Condo', livingAreaSqft: 1000,
    bedrooms: 2, bathrooms: 2, currentListPrice: null, overrideFields: [] },
  recordedSales: [], activeListings: [{ id: 'ask:1', evidenceType: 'ACTIVE_ASKING_PRICE', price: 235000, distanceMiles: 0.8 }],
  mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: null, asOf,
  metadata: { propertyFreshness: 'FRESH', salesFreshness: 'FRESH', listingsFreshness: 'FRESH',
    salesSource: 'SYNTHETIC', listingsSource: 'SYNTHETIC', searchRadiusMiles: 2, saleDateRangeDays: 365 }
});

const normal = base();
normal.recordedSales = [sale('sale:1', 200000, 30, 0.2), sale('sale:2', 220000, 60, 0.5),
  sale('sale:3', 240000, 90, 1), sale('sale:4', 230000, 120, 0.7), sale('sale:5', 210000, 150, 1.1)];

const limited = base();
limited.recordedSales = [sale('sale:1', 200000, 30, 0.2), sale('sale:2', 220000, 60, 0.5)];
limited.metadata.salesFreshness = 'STALE';

const outlier = base();
outlier.recordedSales = [sale('sale:1', 200000, 30, 0.2), sale('sale:2', 220000, 60, 0.5),
  sale('sale:3', 240000, 90, 1), sale('sale:outlier', 2000000, 300, 1.9)];

export const evaluationFixtures = [
  { name: 'normal-property', input: normal },
  { name: 'limited-evidence', input: limited },
  { name: 'excluded-outlier', input: outlier }
] as const;
