import type { NearbySchoolsResponse } from '@ppi/shared';
import type { PropertyRepository } from '../properties/repository.js';
import { PropertyError } from '../properties/service.js';
import { addressMatches } from '../properties/address.js';
import type { ServerConfig } from '../config/env.js';
import { ZillapiClient, ZillapiError } from './zillapi.js';
import type { SchoolLocationSource } from './school-locations.js';

// Keep the existing env spelling compatible with user-owned server/.env files.
export function createSchoolProvider(config: Pick<ServerConfig, 'SCHOOL_ASSIGNMENT_PROVIDER' | 'ZILLAPI_API_KEY'>): ZillapiClient | null {
  if (config.SCHOOL_ASSIGNMENT_PROVIDER === 'unavailable') return null;
  if (!config.ZILLAPI_API_KEY) throw new Error('Invalid configuration: ZILLAPI_API_KEY');
  return new ZillapiClient(config.ZILLAPI_API_KEY);
}

export class NearbySchoolsService {
  constructor(private readonly properties: PropertyRepository, private readonly provider: Pick<ZillapiClient, 'lookupSchools'> | null,
    private readonly locations?: SchoolLocationSource) {}

  async get(propertyId: string): Promise<NearbySchoolsResponse> {
    const record = await this.properties.findById(propertyId);
    if (!record) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
    if (!this.provider) return { propertyId, status: 'SOURCE_UNAVAILABLE', schools: [], source: null };
    try {
      if (record.property.unit && !addressMatches(record.property.formattedAddress, {
        formattedAddress: record.property.formattedAddress, unit: record.property.unit
      })) throw new ZillapiError('SUBJECT_MISMATCH');
      const result = await this.provider.lookupSchools(record.property.formattedAddress);
      let schools = result.schools ?? [];
      if (schools.length && this.locations) {
        try { schools = await this.locations.locate(record.property, schools); }
        catch { /* Keep provider schools visible when optional location enrichment fails. */ }
      }
      return { propertyId, status: result.schools === null ? 'DATA_UNAVAILABLE' : schools.length ? 'AVAILABLE' : 'NO_RESULTS',
        schools, source: 'ZILLAPI' };
    } catch (error) {
      const code = error instanceof ZillapiError ? error.code : 'UPSTREAM';
      throw new PropertyError(`SCHOOL_PROVIDER_${code}`, code === 'BUSY' || code === 'RATE_LIMIT' ? 503 : 502);
    }
  }
}
