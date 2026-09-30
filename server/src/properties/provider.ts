import { z } from 'zod';

export type ProviderErrorCode = 'CONFIGURATION' | 'TIMEOUT' | 'AUTH' | 'RATE_LIMIT' | 'UPSTREAM' | 'MALFORMED';
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) { super(code); }
}

const optionalNumber = (minimum: number, maximum: number) => z.number().finite().min(minimum).max(maximum).nullable().optional();
const optionalText = z.string().trim().min(1).max(250).nullable().optional();
const rawProperty = z.object({
  id: optionalText, formattedAddress: z.string().trim().min(8).max(250), addressLine1: z.string().trim().min(1).max(180),
  addressLine2: optionalText, city: z.string().trim().min(1).max(100), state: z.string().trim().length(2), zipCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
  latitude: optionalNumber(-90, 90), longitude: optionalNumber(-180, 180), propertyType: optionalText,
  bedrooms: optionalNumber(0, 100), bathrooms: optionalNumber(0, 100), squareFootage: optionalNumber(1, 1_000_000), lotSize: optionalNumber(0, 100_000_000),
  yearBuilt: optionalNumber(1600, 2200)
}).passthrough();

export const NormalizedProviderProperty = z.object({
  provider: z.literal('RENTCAST'), providerPropertyId: z.string().nullable(),
  formattedAddress: z.string(), addressLine1: z.string(), unit: z.string().nullable(), city: z.string(), state: z.string(), zipCode: z.string(),
  latitude: z.number().nullable(), longitude: z.number().nullable(), propertyType: z.string().nullable(),
  bedrooms: z.number().nullable(), bathrooms: z.number().nullable(), livingAreaSqft: z.number().int().nullable(), lotSizeSqft: z.number().int().nullable(),
  yearBuilt: z.number().int().nullable(), currentListPrice: z.null()
});
export type NormalizedProviderProperty = z.infer<typeof NormalizedProviderProperty>;

export interface PropertyDataProvider {
  readonly name: 'RENTCAST';
  search(address: string): Promise<NormalizedProviderProperty[]>;
}

export function normalizeRentCastResponse(value: unknown): NormalizedProviderProperty[] {
  if (!Array.isArray(value) || value.length > 10) throw new ProviderError('MALFORMED');
  return value.map(item => {
    const parsed = rawProperty.safeParse(item);
    if (!parsed.success) throw new ProviderError('MALFORMED');
    const data = parsed.data;
    const normalized = NormalizedProviderProperty.safeParse({
      provider: 'RENTCAST', providerPropertyId: data.id ?? null,
      formattedAddress: data.formattedAddress, addressLine1: data.addressLine1, unit: data.addressLine2 ?? null,
      city: data.city, state: data.state.toUpperCase(), zipCode: data.zipCode,
      latitude: data.latitude ?? null, longitude: data.longitude ?? null, propertyType: data.propertyType ?? null,
      bedrooms: data.bedrooms ?? null, bathrooms: data.bathrooms ?? null, livingAreaSqft: data.squareFootage ?? null,
      lotSizeSqft: data.lotSize ?? null, yearBuilt: data.yearBuilt ?? null, currentListPrice: null
    });
    if (!normalized.success) throw new ProviderError('MALFORMED');
    return normalized.data;
  });
}

export class RentCastPropertyProvider implements PropertyDataProvider {
  readonly name = 'RENTCAST' as const;
  constructor(private readonly apiKey: string, private readonly transport: typeof fetch = fetch) {}

  async search(address: string): Promise<NormalizedProviderProperty[]> {
    if (!this.apiKey) throw new ProviderError('CONFIGURATION');
    const url = new URL('https://api.rentcast.io/v1/properties');
    url.searchParams.set('address', address);
    url.searchParams.set('limit', '10');
    let response: Response;
    try {
      response = await this.transport(url, { headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new ProviderError('TIMEOUT');
      throw new ProviderError('UPSTREAM');
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError('AUTH');
    if (response.status === 429) throw new ProviderError('RATE_LIMIT');
    if (!response.ok) throw new ProviderError('UPSTREAM');
    let body: string;
    try { body = await response.text(); } catch { throw new ProviderError('UPSTREAM'); }
    if (body.length > 1_000_000) throw new ProviderError('MALFORMED');
    let json: unknown;
    try { json = JSON.parse(body); } catch { throw new ProviderError('MALFORMED'); }
    return normalizeRentCastResponse(json);
  }
}
