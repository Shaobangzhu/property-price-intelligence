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
