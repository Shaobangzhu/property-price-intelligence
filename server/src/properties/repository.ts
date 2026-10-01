import type { PropertyPatchInput, PropertyRecord } from '@ppi/shared';
import type { NormalizedProviderProperty } from './provider.js';

export type StoredProperty = Omit<PropertyRecord, 'effectiveValues'>;
export type StoredSnapshot = {
  id: string; propertyId: string; kind: 'PROPERTY_PROFILE'; provider: 'RENTCAST';
  fetchedAt: string; sourceDataAsOf: string | null; expiresAt: string; queryHash: string; contentHash: string;
  normalizedPayload: NormalizedProviderProperty; createdAt: string;
};
export type StoredRecord = { property: StoredProperty; snapshot: StoredSnapshot | null };
export type SaveProfile = {
  profile: NormalizedProviderProperty; normalizedAddressKey: string; queryHash: string; contentHash: string;
  fetchedAt: string; expiresAt: string; expectedPropertyId?: string;
};
export type PropertyPage = { items: StoredRecord[]; total: number; page: number; pageSize: number };
export interface PropertyRepository {
  findByAddressKey(key: string): Promise<StoredRecord | null>;
  findById(id: string): Promise<StoredRecord | null>;
  list(options: { page: number; pageSize: number; search: string }): Promise<PropertyPage>;
  saveProfile(input: SaveProfile): Promise<StoredRecord>;
  markRefreshFailed(id: string, at: string): Promise<void>;
  patch(id: string, input: PropertyPatchInput, now: string): Promise<StoredRecord | null>;
  delete(id: string): Promise<boolean>;
}
