import { describe, expect, it } from 'vitest';
import { calculatePricing, ENGINE_VERSION, PRICING_CONFIG_V1, PricingPreviewResponse, type PricingInput } from '@ppi/shared';

const asOf = '2026-09-29T00:00:00.000Z';
const dateAgo = (days: number) => new Date(Date.parse(asOf) - days * 86_400_000).toISOString();
const sale = (id: string, price: number, age: number, distance: number, area = 1000) => ({
  id, providerId: id, address: `${id} Main St`, evidenceType: 'RECORDED_SALE' as const, propertyType: 'Condo',
  price, eventDate: dateAgo(age), distanceMiles: distance, livingAreaSqft: area, bedrooms: 2, bathrooms: 2
});
const base = (): PricingInput => ({
  subject: { id: 'subject', propertyType: 'Condominium', livingAreaSqft: 1000, bedrooms: 2, bathrooms: 2,
    currentListPrice: null, overrideFields: [] },
  recordedSales: [sale('a', 200000, 30, 0), sale('b', 220000, 60, 0.5), sale('c', 240000, 90, 1)],
  activeListings: [{ id: 'ask', evidenceType: 'ACTIVE_ASKING_PRICE', price: 250000, distanceMiles: 0.3 }],
  mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: null, asOf,
  metadata: { propertyFreshness: 'FRESH', salesFreshness: 'FRESH', listingsFreshness: 'FRESH',
    salesSource: 'RENTCAST', listingsSource: 'RENTCAST', searchRadiusMiles: 2, saleDateRangeDays: 365 }
});

describe('ppi-pricing-v1 deterministic domain', () => {
  it('returns a stable weighted median and observed quantile range from recorded sales', () => {
    const input = base();
    const first = calculatePricing(input);
    expect(calculatePricing(input)).toEqual(first);
    expect(first.engineVersion).toBe(ENGINE_VERSION);
    expect(first.status).toBe('READY');
    expect(first.referencePrice).toBe(220000);
    expect(first.referenceRange).toEqual([200000, 220000]);
    expect(first.calculationTrace.weightedMedianPricePerSqft).toBe(220);
    expect(first.calculationTrace.weightedP20PricePerSqft).toBe(200);
    expect(first.calculationTrace.weightedP80PricePerSqft).toBe(220);
    expect(first.calculationTrace.config).toEqual(PRICING_CONFIG_V1);
    expect(first.includedComparables.map(comp => comp.reasonCode)).toEqual(['INCLUDED', 'INCLUDED', 'INCLUDED']);
    expect(first.includedComparables.reduce((sum, comp) => sum + comp.normalizedWeight, 0)).toBeCloseTo(1, 5);
    expect(PricingPreviewResponse.parse(first)).toEqual(first);
  });

  it('applies distance, recency, and area similarity factors separately', () => {
    const input = base();
    input.recordedSales[1] = sale('b', 220000, 60, 0.5, 900);
    const result = calculatePricing(input);
    const row = result.includedComparables.find(comp => comp.candidateId === 'b')!;
    expect(row.factors.distance).toBe(0.75);
    expect(row.factors.recency).toBeCloseTo(1 - 60 / 365, 5);
    expect(row.factors.sizeSimilarity).toBeCloseTo(1 - 0.1 / 0.3, 5);
    expect(row.rawWeight).toBeCloseTo(row.factors.distance * row.factors.recency * row.factors.sizeSimilarity, 5);
  });

  it('resists one extreme, low-weight sale', () => {
    const input = base();
    const original = calculatePricing(input);
    input.recordedSales.push(sale('extreme', 2_000_000, 300, 1.9));
    const result = calculatePricing(input);
    expect(result.referencePrice).toBe(original.referencePrice);
    expect(result.referenceRange).toEqual(original.referenceRange);
    expect(result.excludedComparables).toContainEqual({ candidateId: 'extreme', reasonCode: 'EXCLUDED_PRICE_OUTLIER' });
  });

  it.each([
    ['EXCLUDED_MISSING_PRICE', { price: null }],
    ['EXCLUDED_MISSING_AREA', { livingAreaSqft: null }],
    ['EXCLUDED_PROPERTY_TYPE', { propertyType: 'House' }],
    ['EXCLUDED_MISSING_DATE', { eventDate: null }],
    ['EXCLUDED_FUTURE_SALE', { eventDate: dateAgo(-5) }],
    ['EXCLUDED_TOO_OLD', { eventDate: dateAgo(366) }],
    ['EXCLUDED_MISSING_DISTANCE', { distanceMiles: null }],
    ['EXCLUDED_TOO_FAR', { distanceMiles: 2.01 }],
    ['EXCLUDED_SIZE_MISMATCH', { livingAreaSqft: 1301 }],
    ['EXCLUDED_BEDROOM_MISMATCH', { bedrooms: 5 }],
    ['EXCLUDED_BATHROOM_MISMATCH', { bathrooms: 4 }]
  ] as const)('traces %s', (reason, change) => {
    const input = base();
    input.recordedSales.push({ ...sale('bad', 210000, 20, 0.2), ...change });
    const result = calculatePricing(input);
    expect(result.excludedComparables).toContainEqual({ candidateId: 'bad', reasonCode: reason });
    expect(result.referencePrice).toBe(220000);
  });

  it('deduplicates provider records and caps the selected evidence set', () => {
    const input = base();
    input.recordedSales.push({ ...sale('duplicate', 900000, 20, 0.2), providerId: 'a' });
    for (let index = 0; index < 8; index++) input.recordedSales.push(sale(`extra-${index}`, 210000, 20, 0.2));
    const result = calculatePricing(input);
    expect(result.excludedComparables).toContainEqual({ candidateId: 'duplicate', reasonCode: 'EXCLUDED_DUPLICATE' });
    expect(result.includedComparables).toHaveLength(8);
    expect(result.excludedComparables.filter(comp => comp.reasonCode === 'EXCLUDED_CAP_REACHED')).toHaveLength(3);
  });

  it('returns no numeric result for missing subject area or too few eligible sales', () => {
    const missingArea = base();
    missingArea.subject.livingAreaSqft = null;
    const noArea = calculatePricing(missingArea);
    expect(noArea.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(noArea.referencePrice).toBeNull();
    expect(noArea.referenceRange).toBeNull();
    expect(noArea.offerResult).toBeNull();
    expect(noArea.reasonCodes).toContain('SUBJECT_AREA_MISSING');
    expect(noArea.excludedComparables).toHaveLength(3);
    expect(noArea.excludedComparables.every(comp => comp.reasonCode === 'EXCLUDED_SUBJECT_AREA_MISSING')).toBe(true);
    expect(PricingPreviewResponse.parse(noArea)).toEqual(noArea);
    const tooFew = base();
    tooFew.recordedSales = tooFew.recordedSales.slice(0, 2);
    const noCount = calculatePricing(tooFew);
    expect(noCount.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(noCount.reasonCodes).toContain('TOO_FEW_ELIGIBLE_SALES');
    expect(noCount.referencePrice).toBeNull();
  });

  it('grades descriptive evidence quality by count, freshness, proximity, missing fields, and dispersion', () => {
    const strong = base();
    strong.recordedSales = [200, 205, 210, 215, 220].map((price, index) => sale(`strong-${index}`, price * 1000, 20 + index * 10, 0.1 + index * 0.1));
    expect(calculatePricing(strong).evidenceQuality).toBe('STRONG');
    const moderate = base();
    moderate.recordedSales.push(sale('fourth', 230000, 100, 1));
    expect(calculatePricing(moderate).evidenceQuality).toBe('MODERATE');
    moderate.metadata.salesFreshness = 'STALE';
    expect(calculatePricing(moderate).evidenceQuality).toBe('LIMITED');
    moderate.metadata.salesFreshness = 'FRESH';
    moderate.recordedSales[0]!.bedrooms = null;
    moderate.recordedSales[1]!.bathrooms = null;
    moderate.recordedSales[2]!.bedrooms = null;
    moderate.recordedSales[3]!.bathrooms = null;
    expect(calculatePricing(moderate).evidenceQuality).toBe('LIMITED');
    const dispersed = base();
    dispersed.recordedSales = [150, 200, 300, 350].map((price, index) => sale(`dispersed-${index}`, price * 1000, 40, 0.4));
    expect(calculatePricing(dispersed).calculationTrace.dispersionRatio).toBeGreaterThan(0.35);
    expect(calculatePricing(dispersed).evidenceQuality).toBe('LIMITED');
  });

  it('positions all Offer profiles within the same evidence range and applies a hard budget', () => {
    const input = base();
    const offers = ['CONSERVATIVE', 'BALANCED', 'COMPETITIVE'].map(strategyProfile => calculatePricing({ ...input, strategyProfile: strategyProfile as PricingInput['strategyProfile'] }).offerResult!);
    expect(offers.map(result => result.suggestedPrice)).toEqual([200000, 210000, 220000]);
    expect(offers.every(result => result.recommendedRange![0] >= 200000 && result.recommendedRange![1] <= 220000)).toBe(true);
    const budgeted = calculatePricing({ ...input, strategyProfile: 'COMPETITIVE', maxBudget: 215050 }).offerResult!;
    expect(budgeted.suggestedPrice).toBe(215000);
    expect(budgeted.recommendedRange![1]).toBe(215000);
    expect(budgeted.suggestedPrice!).toBeLessThanOrEqual(215050);
    expect(budgeted.constraints).toContain('MAX_BUDGET_APPLIED');
    const below = calculatePricing({ ...input, maxBudget: 190000 }).offerResult!;
    expect(below.status).toBe('BUDGET_BELOW_REFERENCE_RANGE');
    expect(below.suggestedPrice).toBeNull();
  });

  it('positions Listing goals distinctly without using active asks as sales', () => {
    const input = { ...base(), mode: 'LISTING' as const };
    const results = ['QUICK_SALE', 'BALANCED', 'TEST_MARKET'].map(strategyProfile => calculatePricing({ ...input, strategyProfile: strategyProfile as PricingInput['strategyProfile'] }));
    expect(results.map(result => result.listingResult?.suggestedPrice)).toEqual([204000, 210000, 220000]);
    expect(results.every(result => result.offerResult === null)).toBe(true);
    const changed = base();
    changed.activeListings = [{ id: 'ask-high', evidenceType: 'ACTIVE_ASKING_PRICE', price: 9_000_000, distanceMiles: 0.2 }];
    expect(calculatePricing(changed).referencePrice).toBe(calculatePricing(base()).referencePrice);
    expect(calculatePricing(changed).activeListingContext[0]?.position).toBe('ABOVE_RANGE');
  });

  it('does not ingest context-layer fields into numeric pricing', () => {
    const original = calculatePricing(base());
    const withContext = { ...base(), schools: [{ value: 10 }], grocery: [{ value: 10 }], wildfire: 'Very High', faults: { distanceMiles: 0 } };
    expect(calculatePricing(withContext).referencePrice).toBe(original.referencePrice);
    expect(calculatePricing(withContext).offerResult).toEqual(original.offerResult);
    expect(original.assumptions).toContain('No school, grocery, wildfire, or fault adjustment is applied.');
  });
});
