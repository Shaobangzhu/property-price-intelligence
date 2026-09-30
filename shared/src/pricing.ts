// Pure, versioned pricing rules. Keep this module independent of HTTP, persistence, UI, GIS, and AI.
export const ENGINE_VERSION = 'ppi-pricing-v1' as const;

export type PricingMode = 'OFFER' | 'LISTING';
export type OfferStrategy = 'CONSERVATIVE' | 'BALANCED' | 'COMPETITIVE';
export type ListingStrategy = 'QUICK_SALE' | 'BALANCED' | 'TEST_MARKET';
export type Freshness = 'FRESH' | 'STALE' | 'UNAVAILABLE' | 'UNKNOWN';
export type PricingComparable = {
  id: string; providerId: string | null; address: string; evidenceType: 'RECORDED_SALE'; propertyType: string | null;
  price: number | null; eventDate: string | null; distanceMiles: number | null; livingAreaSqft: number | null;
  bedrooms: number | null; bathrooms: number | null;
};
export type ActiveListingComparable = {
  id: string; evidenceType: 'ACTIVE_ASKING_PRICE'; price: number | null; distanceMiles: number | null;
};
export type PricingInput = {
  subject: { id: string; propertyType: string | null; livingAreaSqft: number | null; bedrooms: number | null;
    bathrooms: number | null; currentListPrice: number | null; overrideFields: string[] };
  recordedSales: PricingComparable[]; activeListings: ActiveListingComparable[];
  mode: PricingMode; strategyProfile: OfferStrategy | ListingStrategy; maxBudget: number | null;
  asOf: string;
  metadata: { propertyFreshness: Freshness; salesFreshness: Freshness; listingsFreshness: Freshness;
    salesSource: string | null; listingsSource: string | null; searchRadiusMiles: number | null; saleDateRangeDays: number | null;
    propertyFetchedAt?: string | null; salesFetchedAt?: string | null; listingsFetchedAt?: string | null };
};
export type PricingConfig = {
  engineVersion: typeof ENGINE_VERSION; maxSaleAgeDays: number; maxDistanceMiles: number; minSqftRatio: number;
  maxSqftRatio: number; maxBedroomDifference: number; maxBathroomDifference: number;
  minimumComparableCount: number; maximumComparableCount: number; maxPricePerSqftMedianRatio: number;
};
export const PRICING_CONFIG_V1: Readonly<PricingConfig> = Object.freeze({
  engineVersion: ENGINE_VERSION, maxSaleAgeDays: 365, maxDistanceMiles: 2, minSqftRatio: 0.7,
  maxSqftRatio: 1.3, maxBedroomDifference: 2, maxBathroomDifference: 1.5,
  minimumComparableCount: 3, maximumComparableCount: 8, maxPricePerSqftMedianRatio: 2
});
export type ExclusionReason = 'EXCLUDED_PROPERTY_TYPE' | 'EXCLUDED_TOO_OLD' | 'EXCLUDED_TOO_FAR' |
  'EXCLUDED_SIZE_MISMATCH' | 'EXCLUDED_MISSING_PRICE' | 'EXCLUDED_MISSING_AREA' |
  'EXCLUDED_SUBJECT_AREA_MISSING' |
  'EXCLUDED_MISSING_DATE' | 'EXCLUDED_FUTURE_SALE' | 'EXCLUDED_MISSING_DISTANCE' |
  'EXCLUDED_BEDROOM_MISMATCH' | 'EXCLUDED_BATHROOM_MISMATCH' | 'EXCLUDED_DUPLICATE' | 'EXCLUDED_CAP_REACHED' | 'EXCLUDED_PRICE_OUTLIER';
export type IncludedComparable = { candidateId: string; reasonCode: 'INCLUDED'; soldPrice: number; pricePerSqft: number;
  ageDays: number; distanceMiles: number; sqftRatio: number; factors: { distance: number; recency: number; sizeSimilarity: number };
  rawWeight: number; normalizedWeight: number; missingOptionalFields: number };
export type ExcludedComparable = { candidateId: string; reasonCode: ExclusionReason };
export type ListingContext = { candidateId: string; reasonCode: 'ACTIVE_ASK_CONTEXT_ONLY'; askingPrice: number | null; position: 'BELOW_RANGE' | 'WITHIN_RANGE' | 'ABOVE_RANGE' | 'UNPRICED' | 'REFERENCE_UNAVAILABLE' };
export type StrategyResult = { status: 'READY' | 'BUDGET_BELOW_REFERENCE_RANGE'; strategyProfile: OfferStrategy | ListingStrategy;
  recommendedRange: [number, number] | null; suggestedPrice: number | null; reasonCodes: string[]; constraints: string[] };
export type PricingEngineResult = {
  status: 'READY' | 'INSUFFICIENT_EVIDENCE'; engineVersion: typeof ENGINE_VERSION;
  referencePrice: number | null; referenceRange: [number, number] | null; evidenceQuality: 'STRONG' | 'MODERATE' | 'LIMITED' | 'INSUFFICIENT';
  includedComparables: IncludedComparable[]; excludedComparables: ExcludedComparable[]; activeListingContext: ListingContext[];
  offerResult: StrategyResult | null; listingResult: StrategyResult | null;
  assumptions: string[]; warnings: string[]; reasonCodes: string[];
  calculationTrace: { subjectAreaSqft: number | null; configuredSearchRadiusMiles: number | null; configuredSaleDateRangeDays: number | null;
    eligibleCount: number; selectedCount: number; weightedMedianPricePerSqft: number | null;
    weightedP20PricePerSqft: number | null; weightedP80PricePerSqft: number | null;
    dispersionRatio: number | null; missingOptionalFieldRate: number | null; medianAgeDays: number | null; medianDistanceMiles: number | null;
    rounding: 'NEAREST_100_DOLLARS'; config: PricingConfig };
};

const roundMoney = (value: number) => Math.round(value / 100) * 100;
const roundFactor = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const isPositive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;
const normalizedType = (value: string | null): string | null => {
  if (!value?.trim()) return null;
  const type = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (['single family', 'single family residence', 'house', 'detached'].includes(type)) return 'HOUSE';
  if (['condo', 'condominium'].includes(type)) return 'CONDO';
  if (['townhouse', 'townhome'].includes(type)) return 'TOWNHOUSE';
  return type;
};
const weightedQuantile = (rows: IncludedComparable[], fraction: number, value: (row: IncludedComparable) => number): number => {
  const sorted = [...rows].sort((a, b) => value(a) - value(b) || a.candidateId.localeCompare(b.candidateId));
  let cumulative = 0;
  for (const row of sorted) { cumulative += row.normalizedWeight; if (cumulative + 1e-12 >= fraction) return value(row); }
  return value(sorted[sorted.length - 1]!);
};
const range = (low: number, high: number): [number, number] => [roundMoney(low), roundMoney(high)];

function strategyResult(input: PricingInput, referenceRange: [number, number]): StrategyResult {
  const [low, high] = referenceRange;
  const span = high - low;
  const profile = input.strategyProfile;
  let lower: number, upper: number, suggested: number;
  if (input.mode === 'OFFER') {
    if (profile === 'CONSERVATIVE') [lower, upper, suggested] = [low, low + span * 0.5, low];
    else if (profile === 'COMPETITIVE') [lower, upper, suggested] = [low + span * 0.5, high, high];
    else [lower, upper, suggested] = [low + span * 0.25, high - span * 0.25, low + span * 0.5];
  } else if (profile === 'QUICK_SALE') [lower, upper, suggested] = [low, low + span * 0.5, low + span * 0.2];
  else if (profile === 'TEST_MARKET') [lower, upper, suggested] = [low + span * 0.5, high, high];
  else [lower, upper, suggested] = [low + span * 0.25, high - span * 0.25, low + span * 0.5];
  const constraints: string[] = [];
  const reasonCodes = [input.mode === 'OFFER' ? `OFFER_${profile}` : `LISTING_${profile}`, 'POSITION_WITHIN_OBSERVED_RANGE'];
  if (input.mode === 'OFFER' && input.maxBudget !== null) {
    constraints.push('MAX_BUDGET_APPLIED');
    const boundedBudget = Math.floor(input.maxBudget / 100) * 100;
    if (boundedBudget < low) return { status: 'BUDGET_BELOW_REFERENCE_RANGE', strategyProfile: profile,
      recommendedRange: null, suggestedPrice: null, reasonCodes: [...reasonCodes, 'MAX_BUDGET_BELOW_REFERENCE_RANGE'], constraints };
    if (boundedBudget < lower) { lower = low; reasonCodes.push('STRATEGY_SHIFTED_FOR_BUDGET'); }
    upper = Math.min(upper, boundedBudget);
    suggested = Math.min(suggested, boundedBudget);
  }
  const recommendedRange = range(lower, upper);
  return { status: 'READY', strategyProfile: profile, recommendedRange,
    suggestedPrice: Math.max(recommendedRange[0], Math.min(recommendedRange[1], roundMoney(suggested))), reasonCodes, constraints };
}

export function calculatePricing(input: PricingInput, config: Readonly<PricingConfig> = PRICING_CONFIG_V1): PricingEngineResult {
  const area = input.subject.livingAreaSqft;
  const subjectType = normalizedType(input.subject.propertyType);
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf)) throw new Error('INVALID_AS_OF');
  const excludedComparables: ExcludedComparable[] = [];
  let eligible: IncludedComparable[] = [];
  const seenIds = new Set<string>(), seenKeys = new Set<string>();
  for (const candidate of input.recordedSales) {
    let reason: ExclusionReason | null = null;
    const candidateType = normalizedType(candidate.propertyType);
    const saleTime = candidate.eventDate === null ? NaN : Date.parse(candidate.eventDate);
    const ageDays = Math.floor((asOf - saleTime) / 86_400_000);
    const ratio = isPositive(area) && isPositive(candidate.livingAreaSqft) ? candidate.livingAreaSqft / area : NaN;
    if (!isPositive(area)) reason = 'EXCLUDED_SUBJECT_AREA_MISSING';
    else if (!isPositive(candidate.price)) reason = 'EXCLUDED_MISSING_PRICE';
    else if (!isPositive(candidate.livingAreaSqft)) reason = 'EXCLUDED_MISSING_AREA';
    else if (!subjectType || candidateType !== subjectType) reason = 'EXCLUDED_PROPERTY_TYPE';
    else if (!Number.isFinite(saleTime)) reason = 'EXCLUDED_MISSING_DATE';
    else if (ageDays < 0) reason = 'EXCLUDED_FUTURE_SALE';
    else if (ageDays > config.maxSaleAgeDays) reason = 'EXCLUDED_TOO_OLD';
    else if (candidate.distanceMiles === null || !Number.isFinite(candidate.distanceMiles) || candidate.distanceMiles < 0) reason = 'EXCLUDED_MISSING_DISTANCE';
    else if (candidate.distanceMiles > config.maxDistanceMiles) reason = 'EXCLUDED_TOO_FAR';
    else if (ratio < config.minSqftRatio || ratio > config.maxSqftRatio) reason = 'EXCLUDED_SIZE_MISMATCH';
    else if (input.subject.bedrooms !== null && candidate.bedrooms !== null && Math.abs(input.subject.bedrooms - candidate.bedrooms) > config.maxBedroomDifference) reason = 'EXCLUDED_BEDROOM_MISMATCH';
    else if (input.subject.bathrooms !== null && candidate.bathrooms !== null && Math.abs(input.subject.bathrooms - candidate.bathrooms) > config.maxBathroomDifference) reason = 'EXCLUDED_BATHROOM_MISMATCH';
    const key = candidate.providerId?.trim() ? `provider:${candidate.providerId}` : `address:${candidate.address.toLowerCase().replace(/[^a-z0-9]/g, '')}:${candidate.eventDate}`;
    if (reason === null && (seenIds.has(candidate.id) || seenKeys.has(key))) reason = 'EXCLUDED_DUPLICATE';
    if (reason !== null) { excludedComparables.push({ candidateId: candidate.id, reasonCode: reason }); continue; }
    seenIds.add(candidate.id); seenKeys.add(key);
    const distance = candidate.distanceMiles!;
    const distanceFactor = Math.max(0.25, 1 - distance / config.maxDistanceMiles);
    const recencyFactor = Math.max(0.25, 1 - ageDays / config.maxSaleAgeDays);
    const sizeFactor = Math.max(0.25, 1 - Math.abs(1 - ratio) / Math.max(1 - config.minSqftRatio, config.maxSqftRatio - 1));
    const rawWeight = distanceFactor * recencyFactor * sizeFactor;
    eligible.push({ candidateId: candidate.id, reasonCode: 'INCLUDED', soldPrice: candidate.price!, pricePerSqft: candidate.price! / candidate.livingAreaSqft!,
      ageDays, distanceMiles: distance, sqftRatio: roundFactor(ratio),
      factors: { distance: roundFactor(distanceFactor), recency: roundFactor(recencyFactor), sizeSimilarity: roundFactor(sizeFactor) },
      rawWeight: roundFactor(rawWeight), normalizedWeight: 0,
      missingOptionalFields: Number(candidate.bedrooms === null) + Number(candidate.bathrooms === null) });
  }
  if (eligible.length >= 4) {
    const prices = eligible.map(row => row.pricePerSqft).sort((a, b) => a - b);
    const middle = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[middle]! : (prices[middle - 1]! + prices[middle]!) / 2;
    eligible = eligible.filter(row => {
      if (row.pricePerSqft > median * config.maxPricePerSqftMedianRatio || row.pricePerSqft < median / config.maxPricePerSqftMedianRatio) {
        excludedComparables.push({ candidateId: row.candidateId, reasonCode: 'EXCLUDED_PRICE_OUTLIER' });
        return false;
      }
      return true;
    });
  }
  eligible.sort((a, b) => b.rawWeight - a.rawWeight || a.candidateId.localeCompare(b.candidateId));
  const includedComparables = eligible.slice(0, config.maximumComparableCount);
  for (const row of eligible.slice(config.maximumComparableCount)) excludedComparables.push({ candidateId: row.candidateId, reasonCode: 'EXCLUDED_CAP_REACHED' });
  const totalWeight = includedComparables.reduce((sum, row) => sum + row.rawWeight, 0);
  for (const row of includedComparables) row.normalizedWeight = roundFactor(row.rawWeight / totalWeight);
  const enough = isPositive(area) && !!subjectType && includedComparables.length >= config.minimumComparableCount;
  const weightedMedian = enough ? weightedQuantile(includedComparables, 0.5, row => row.pricePerSqft) : null;
  const p20 = enough ? weightedQuantile(includedComparables, 0.2, row => row.pricePerSqft) : null;
  const p80 = enough ? weightedQuantile(includedComparables, 0.8, row => row.pricePerSqft) : null;
  const dispersion = weightedMedian && p20 !== null && p80 !== null ? (p80 - p20) / weightedMedian : null;
  const missingRate = includedComparables.length ? includedComparables.reduce((sum, row) => sum + row.missingOptionalFields, 0) / (includedComparables.length * 2) : null;
  const medianAge = enough ? weightedQuantile(includedComparables, 0.5, row => row.ageDays) : null;
  const medianDistance = enough ? weightedQuantile(includedComparables, 0.5, row => row.distanceMiles) : null;
  const referencePrice = weightedMedian !== null ? roundMoney(weightedMedian * area!) : null;
  const referenceRange: [number, number] | null = p20 !== null && p80 !== null ? range(p20 * area!, p80 * area!) : null;
  let evidenceQuality: PricingEngineResult['evidenceQuality'] = 'INSUFFICIENT';
  const fresh = input.metadata.propertyFreshness === 'FRESH' && input.metadata.salesFreshness === 'FRESH';
  if (enough && dispersion !== null && missingRate !== null && medianAge !== null && medianDistance !== null) {
    evidenceQuality = includedComparables.length >= 5 && fresh && input.subject.bedrooms !== null && input.subject.bathrooms !== null &&
      medianAge <= 180 && medianDistance <= 1 && missingRate <= 0.2 && dispersion <= 0.2 ? 'STRONG'
      : includedComparables.length >= 4 && fresh && medianAge <= 270 && medianDistance <= 1.5 && missingRate <= 0.4 && dispersion <= 0.35 ? 'MODERATE' : 'LIMITED';
  }
  const activeListingContext: ListingContext[] = input.activeListings.map(listing => ({ candidateId: listing.id, reasonCode: 'ACTIVE_ASK_CONTEXT_ONLY',
    askingPrice: isPositive(listing.price) ? listing.price : null,
    position: !isPositive(listing.price) ? 'UNPRICED' : !referenceRange ? 'REFERENCE_UNAVAILABLE' : listing.price < referenceRange[0] ? 'BELOW_RANGE' : listing.price > referenceRange[1] ? 'ABOVE_RANGE' : 'WITHIN_RANGE' }));
  const reasonCodes: string[] = [];
  if (!isPositive(area)) reasonCodes.push('SUBJECT_AREA_MISSING');
  if (!subjectType) reasonCodes.push('SUBJECT_TYPE_MISSING');
  if (includedComparables.length < config.minimumComparableCount) reasonCodes.push('TOO_FEW_ELIGIBLE_SALES');
  if (input.metadata.salesFreshness === 'UNAVAILABLE') reasonCodes.push('SALES_UNAVAILABLE');
  if (input.metadata.salesFreshness === 'STALE' || input.metadata.propertyFreshness === 'STALE') reasonCodes.push('STALE_EVIDENCE');
  if (input.activeListings.length) reasonCodes.push('ACTIVE_ASKS_CONTEXT_ONLY');
  const warnings: string[] = [];
  if (reasonCodes.includes('STALE_EVIDENCE')) warnings.push('Saved evidence is stale; review its source date.');
  if (input.metadata.salesFreshness === 'UNAVAILABLE') warnings.push('Recorded-sale source is unavailable.');
  if (input.metadata.listingsFreshness !== 'FRESH') warnings.push('Active listing context is stale or unavailable.');
  const assumptions = ['Recorded sales determine the numeric reference; active listing asks are context only.',
    'No school, grocery, wildfire, or fault adjustment is applied.', 'This is a rule-based market reference, not a formal appraisal or validated AVM.'];
  if (isPositive(input.subject.currentListPrice)) assumptions.push('Current list price is shown for context and does not alter the market reference.');
  if (input.subject.overrideFields.length) assumptions.push(`User overrides applied to subject fields: ${[...input.subject.overrideFields].sort().join(', ')}.`);
  const strategy = referenceRange ? strategyResult(input, referenceRange) : null;
  if (strategy?.status === 'BUDGET_BELOW_REFERENCE_RANGE') reasonCodes.push('MAX_BUDGET_BELOW_REFERENCE_RANGE');
  return {
    status: enough ? 'READY' : 'INSUFFICIENT_EVIDENCE', engineVersion: ENGINE_VERSION, referencePrice, referenceRange, evidenceQuality,
    includedComparables, excludedComparables, activeListingContext,
    offerResult: input.mode === 'OFFER' ? strategy : null, listingResult: input.mode === 'LISTING' ? strategy : null,
    assumptions, warnings, reasonCodes,
    calculationTrace: { subjectAreaSqft: isPositive(area) ? area : null, configuredSearchRadiusMiles: input.metadata.searchRadiusMiles,
      configuredSaleDateRangeDays: input.metadata.saleDateRangeDays, eligibleCount: eligible.length, selectedCount: includedComparables.length,
      weightedMedianPricePerSqft: weightedMedian, weightedP20PricePerSqft: p20, weightedP80PricePerSqft: p80,
      dispersionRatio: dispersion, missingOptionalFieldRate: missingRate, medianAgeDays: medianAge, medianDistanceMiles: medianDistance,
      rounding: 'NEAREST_100_DOLLARS', config: { ...config } }
  };
}
