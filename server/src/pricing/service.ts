import { calculatePricing, MarketContextResponse, PricingPreviewResponse, PropertyEnvelope,
  type PricingInput, type PricingPreviewRequest } from '@ppi/shared';
import type { PropertyService } from '../properties/service.js';
import { PropertyError } from '../properties/service.js';
import type { MarketEvidenceService } from '../market/service.js';

export class PricingPreviewService {
  constructor(private readonly properties: PropertyService, private readonly market: MarketEvidenceService,
    private readonly now: () => Date = () => new Date()) {}

  async preview(propertyId: string, request: PricingPreviewRequest) {
    const [propertyEnvelope, marketContext] = await Promise.all([this.properties.get(propertyId), this.market.get(propertyId)]);
    const property = PropertyEnvelope.parse(propertyEnvelope);
    const market = MarketContextResponse.parse(marketContext);
    const subject = property.property;
    if (subject.id !== propertyId || market.propertyId !== propertyId ||
      market.recordedSales.candidates.some(candidate => candidate.evidenceType !== 'RECORDED_SALE') ||
      market.activeListings.candidates.some(candidate => candidate.evidenceType !== 'ACTIVE_ASKING_PRICE')) {
      throw new PropertyError('INVALID_MARKET_EVIDENCE', 502);
    }
    const input: PricingInput = {
      subject: { id: subject.id, propertyType: subject.propertyType, livingAreaSqft: subject.effectiveValues.livingAreaSqft,
        bedrooms: subject.effectiveValues.bedrooms, bathrooms: subject.effectiveValues.bathrooms,
        currentListPrice: subject.currentListPrice, overrideFields: Object.keys(subject.userOverrides) },
      recordedSales: market.recordedSales.candidates.map(candidate => ({
        id: candidate.id, providerId: candidate.providerId, address: candidate.address, evidenceType: 'RECORDED_SALE',
        propertyType: candidate.propertyType, price: candidate.price, eventDate: candidate.eventDate, distanceMiles: candidate.distanceMiles,
        livingAreaSqft: candidate.livingAreaSqft, bedrooms: candidate.bedrooms, bathrooms: candidate.bathrooms
      })),
      activeListings: market.activeListings.candidates.map(candidate => ({
        id: candidate.id, evidenceType: 'ACTIVE_ASKING_PRICE', price: candidate.price, distanceMiles: candidate.distanceMiles
      })),
      mode: request.mode, strategyProfile: request.strategyProfile, maxBudget: request.mode === 'OFFER' ? request.maxBudget ?? null : null,
      asOf: this.now().toISOString(),
      metadata: { propertyFreshness: property.cache.freshness, salesFreshness: market.recordedSales.freshness,
        listingsFreshness: market.activeListings.freshness, salesSource: market.recordedSales.source, listingsSource: market.activeListings.source,
        searchRadiusMiles: market.recordedSales.query?.radiusMiles ?? null, saleDateRangeDays: market.recordedSales.query?.saleDateRangeDays ?? null }
    };
    return PricingPreviewResponse.parse(calculatePricing(input));
  }
}
