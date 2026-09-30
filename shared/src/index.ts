import { z } from 'zod';

export const AnalysisMode = z.enum(['OFFER', 'LISTING']);
export type AnalysisMode = z.infer<typeof AnalysisMode>;
export const MapContext = z.enum(['schools', 'grocery', 'wildfire', 'faults']);
export const MapSelection = MapContext.nullable();
export type MapContext = z.infer<typeof MapContext>;
export const PriceEvidenceType = z.enum(['RECORDED_SALE', 'ACTIVE_ASKING_PRICE', 'INACTIVE_ASKING_PRICE', 'PROVIDER_AVM']);
export type PriceEvidenceType = z.infer<typeof PriceEvidenceType>;
export const HealthResponse = z.object({ status: z.enum(['live', 'ready', 'unavailable']), requestId: z.string() });
export const ApiErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) });
export const CapabilityStatus = z.enum(['NOT_RUN', 'SKIPPED', 'SUCCESS', 'ERROR', 'DEFERRED']);
export const CapabilityReport = z.object({ provider: z.string(), operation: z.string(), status: CapabilityStatus, httpStatus: z.number().int().optional(), durationMs: z.number().nonnegative().optional(), count: z.number().int().nonnegative().optional(), note: z.string().optional() });
export type CapabilityReport = z.infer<typeof CapabilityReport>;
export const PropertySummary = z.object({
  id: z.string().nullable(), formattedAddress: z.string(), latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(),
  propertyType: z.string().nullable(), bedrooms: z.number().nullable(), bathrooms: z.number().nullable(), squareFootage: z.number().nullable(), lotSize: z.number().nullable(), yearBuilt: z.number().int().nullable(), lastSaleDate: z.string().nullable(), lastSalePrice: z.number().nullable()
});
export type PropertySummary = z.infer<typeof PropertySummary>;

export const PropertyOverrideFields = z.enum(['bedrooms', 'bathrooms', 'livingAreaSqft', 'yearBuilt']);
export type PropertyOverrideField = z.infer<typeof PropertyOverrideFields>;
export const PropertyOverridesPatch = z.object({
  bedrooms: z.number().min(0).max(100).nullable().optional(),
  bathrooms: z.number().min(0).max(100).nullable().optional(),
  livingAreaSqft: z.number().int().min(1).max(1_000_000).nullable().optional(),
  yearBuilt: z.number().int().min(1600).max(2200).nullable().optional()
}).strict();
export const PropertyPatchInput = z.object({
  notes: z.string().max(5000).nullable().optional(),
  overrides: PropertyOverridesPatch.optional()
}).strict().refine(value => value.notes !== undefined || value.overrides !== undefined, 'No changes supplied');
export type PropertyPatchInput = z.infer<typeof PropertyPatchInput>;
export const ResolvePropertyInput = z.object({ address: z.string().trim().min(8).max(250) }).strict();
export const ListPropertiesQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(200).default('')
}).strict();
export const PropertyId = z.uuid();

const NullableNumber = z.number().finite().nullable();
export const OverrideEntry = z.object({ value: z.number().finite(), source: z.literal('USER'), updatedAt: z.iso.datetime() });
export const PropertyUserOverrides = z.object({
  bedrooms: OverrideEntry.optional(), bathrooms: OverrideEntry.optional(),
  livingAreaSqft: OverrideEntry.optional(), yearBuilt: OverrideEntry.optional()
}).strict();
export const PropertyRecord = z.object({
  id: PropertyId,
  provider: z.literal('RENTCAST'),
  providerPropertyId: z.string().nullable(),
  normalizedAddressKey: z.string(),
  formattedAddress: z.string(), addressLine1: z.string(), unit: z.string().nullable(), city: z.string(), state: z.string(), zipCode: z.string(),
  latitude: NullableNumber, longitude: NullableNumber, propertyType: z.string().nullable(),
  bedrooms: NullableNumber, bathrooms: NullableNumber, livingAreaSqft: z.number().int().nullable(), lotSizeSqft: z.number().int().nullable(), yearBuilt: z.number().int().nullable(),
  currentListPrice: NullableNumber, refreshFailedAt: z.iso.datetime().nullable(), notes: z.string().nullable(),
  userOverrides: PropertyUserOverrides,
  effectiveValues: z.object({ bedrooms: NullableNumber, bathrooms: NullableNumber, livingAreaSqft: z.number().int().nullable(), yearBuilt: z.number().int().nullable() }),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime()
});
export type PropertyRecord = z.infer<typeof PropertyRecord>;
export const PropertyCache = z.object({
  source: z.literal('RENTCAST').nullable(),
  fetchedAt: z.iso.datetime().nullable(), expiresAt: z.iso.datetime().nullable(),
  freshness: z.enum(['FRESH', 'STALE', 'UNKNOWN']),
  cacheStatus: z.enum(['HIT', 'MISS', 'REFRESHED', 'STALE_FALLBACK']).nullable()
});
export type PropertyCache = z.infer<typeof PropertyCache>;
export const PropertyEnvelope = z.object({ property: PropertyRecord, cache: PropertyCache });
export type PropertyEnvelope = z.infer<typeof PropertyEnvelope>;
export const PropertyListResponse = z.object({ items: z.array(PropertyEnvelope), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive() });
export type PropertyListResponse = z.infer<typeof PropertyListResponse>;

export const MarketEvidenceKind = z.enum(['RECORDED_SALES', 'ACTIVE_LISTINGS']);
export type MarketEvidenceKind = z.infer<typeof MarketEvidenceKind>;
export const MarketComparableCandidate = z.object({
  id: z.string().min(1), evidenceType: z.enum(['RECORDED_SALE', 'ACTIVE_ASKING_PRICE']),
  providerId: z.string().nullable(), address: z.string().min(1),
  latitude: NullableNumber, longitude: NullableNumber, propertyType: z.string().nullable(),
  bedrooms: NullableNumber, bathrooms: NullableNumber, livingAreaSqft: z.number().int().nullable(),
  lotSizeSqft: z.number().int().nullable(), yearBuilt: z.number().int().nullable(),
  price: NullableNumber, eventDate: z.string().nullable(), distanceMiles: NullableNumber,
  source: z.literal('RENTCAST')
});
export type MarketComparableCandidate = z.infer<typeof MarketComparableCandidate>;
export const MarketQuery = z.object({ latitude: z.number(), longitude: z.number(), radiusMiles: z.number().positive(), limit: z.number().int().positive(), saleDateRangeDays: z.number().int().positive().nullable() });
export type MarketQuery = z.infer<typeof MarketQuery>;
export const MarketEvidenceGroup = z.object({
  kind: MarketEvidenceKind, candidates: z.array(MarketComparableCandidate),
  source: z.literal('RENTCAST').nullable(), freshness: z.enum(['FRESH', 'STALE', 'UNAVAILABLE']),
  cacheStatus: z.enum(['HIT', 'MISS', 'REFRESHED', 'STALE_FALLBACK', 'ERROR', 'NO_COORDINATES']),
  fetchedAt: z.iso.datetime().nullable(), expiresAt: z.iso.datetime().nullable(),
  query: MarketQuery.nullable(), errorCode: z.string().nullable()
});
export type MarketEvidenceGroup = z.infer<typeof MarketEvidenceGroup>;
export const MarketContextResponse = z.object({ propertyId: PropertyId, recordedSales: MarketEvidenceGroup, activeListings: MarketEvidenceGroup });
export type MarketContextResponse = z.infer<typeof MarketContextResponse>;

export const AssignmentLevel = z.enum(['ELEMENTARY', 'MIDDLE', 'HIGH', 'OTHER']);
export const SchoolMatchStatus = z.enum(['EXACT_ID', 'NAME_DISTRICT', 'NAME_CITY', 'UNMATCHED']);
export const AssignedSchool = z.object({
  id: z.string().min(1), assignmentLevel: AssignmentLevel, sourceSchoolId: z.string().nullable(),
  name: z.string().min(1), district: z.string().nullable(), city: z.string().nullable(),
  latitude: NullableNumber, longitude: NullableNumber, grades: z.string().nullable(), schoolType: z.string().nullable(),
  distanceMiles: NullableNumber, assignmentSource: z.string().min(1), metadataSource: z.string().nullable(), matchStatus: SchoolMatchStatus
});
export type AssignedSchool = z.infer<typeof AssignedSchool>;
export const AssignedSchoolsResponse = z.object({
  propertyId: PropertyId, status: z.enum(['ASSIGNMENT_UNAVAILABLE', 'AVAILABLE', 'PARTIAL', 'UNMATCHED', 'PROVIDER_ERROR']),
  schools: z.array(AssignedSchool), assignmentSource: z.string().nullable()
});
export type AssignedSchoolsResponse = z.infer<typeof AssignedSchoolsResponse>;

export const GroceryPlace = z.object({
  id: z.string().min(1), name: z.string().min(1), category: z.string().nullable(),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  distanceMiles: z.number().nonnegative().nullable(), source: z.literal('ARCGIS_PLACES')
});
export type GroceryPlace = z.infer<typeof GroceryPlace>;
export const GroceryResponse = z.object({
  propertyId: PropertyId, status: z.enum(['AVAILABLE', 'NO_RESULTS', 'NO_COORDINATES', 'CREDENTIAL_UNAVAILABLE', 'RATE_LIMIT', 'PROVIDER_ERROR']),
  places: z.array(GroceryPlace), source: z.literal('ARCGIS_PLACES'), radiusMeters: z.number().int().positive()
});
export type GroceryResponse = z.infer<typeof GroceryResponse>;

export const WildfireContextResponse = z.object({
  propertyId: PropertyId, status: z.enum(['INSIDE_DISPLAYED_ZONE', 'OUTSIDE_DISPLAYED_ZONE', 'NO_COVERAGE', 'NO_COORDINATES', 'UNAVAILABLE']),
  classification: z.enum(['Moderate', 'High', 'Very High']).nullable(), responsibilityArea: z.enum(['SRA', 'LRA', 'FRA']).nullable(),
  sourceName: z.string(), sourceVersion: z.string().nullable(), checkedAt: z.iso.datetime()
});
export type WildfireContextResponse = z.infer<typeof WildfireContextResponse>;
export const FaultContextResponse = z.object({
  propertyId: PropertyId, contextType: z.literal('FAULT_TRACE'),
  status: z.enum(['NEAREST_MAPPED_FAULT', 'NO_NEARBY_FEATURES', 'NO_COVERAGE', 'NO_COORDINATES', 'UNAVAILABLE']),
  nearestFeatureName: z.string().nullable(), distanceMiles: z.number().nonnegative().nullable(), searchRadiusMiles: z.number().positive(),
  sourceName: z.string(), sourceVersion: z.string().nullable(), checkedAt: z.iso.datetime()
});
export type FaultContextResponse = z.infer<typeof FaultContextResponse>;

// Public California government feature services, verified in the Milestone 06 source register.
export const OfficialGisLayers = {
  responsibility: 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/SRA_for_FHSZ_in_LRA/FeatureServer/0',
  wildfireSra: 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSZSRA_23_3/FeatureServer/0',
  wildfireLra: 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSALRA25_v1_All/FeatureServer/0',
  faultTraces: 'https://gis.conservation.ca.gov/server/rest/services/CGS/FaultActivityMapCA/FeatureServer/21'
} as const;
