import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PropertyPatchInput } from '@ppi/shared';
import { normalizeAddressKey } from '../server/src/properties/address.js';
import { normalizeRentCastResponse, ProviderError, type NormalizedProviderProperty, type PropertyDataProvider } from '../server/src/properties/provider.js';
import { PropertyError, PropertyService, parseProfileTtlDays } from '../server/src/properties/service.js';
import type { PropertyRepository, SaveProfile, StoredProperty, StoredRecord, StoredSnapshot } from '../server/src/properties/repository.js';

const address = '123 Main St, Apt 2, Austin, TX 78701';
const profile: NormalizedProviderProperty = {
  provider: 'RENTCAST', providerPropertyId: 'rentcast-apt-2', formattedAddress: address, addressLine1: '123 Main St', unit: 'Apt 2',
  city: 'Austin', state: 'TX', zipCode: '78701', latitude: 30.1, longitude: -97.1, propertyType: 'Condo', bedrooms: 2,
  bathrooms: 2, livingAreaSqft: 1200, lotSizeSqft: null, yearBuilt: 2001, currentListPrice: null
};

class MemoryRepository implements PropertyRepository {
  records = new Map<string, StoredRecord>();
  snapshots: StoredSnapshot[] = [];
  findByAddressKey = async (key: string) => [...this.records.values()].find(item => item.property.normalizedAddressKey === key) ?? null;
  findById = async (id: string) => this.records.get(id) ?? null;
  list = async ({ page, pageSize, search }: { page: number; pageSize: number; search: string }) => {
    const all = [...this.records.values()].filter(item => item.property.formattedAddress.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.property.updatedAt.localeCompare(a.property.updatedAt));
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
  };
  saveProfile = async (input: SaveProfile) => {
    const prior = [...this.records.values()].find(item => item.property.providerPropertyId === input.profile.providerPropertyId || item.property.normalizedAddressKey === input.normalizedAddressKey);
    const property: StoredProperty = prior ? { ...prior.property, ...input.profile, normalizedAddressKey: input.normalizedAddressKey, updatedAt: input.fetchedAt } : {
      ...input.profile, id: randomUUID(), normalizedAddressKey: input.normalizedAddressKey, refreshFailedAt: null, notes: null, userOverrides: {}, createdAt: input.fetchedAt, updatedAt: input.fetchedAt
    };
    const snapshot: StoredSnapshot = {
      id: randomUUID(), propertyId: property.id, kind: 'PROPERTY_PROFILE', provider: 'RENTCAST', fetchedAt: input.fetchedAt, sourceDataAsOf: null,
      expiresAt: input.expiresAt, queryHash: input.queryHash, contentHash: input.contentHash, normalizedPayload: structuredClone(input.profile), createdAt: input.fetchedAt
    };
    property.refreshFailedAt = null;
    const record = { property, snapshot };
    this.records.set(property.id, record); this.snapshots.push(snapshot);
    return record;
  };
  markRefreshFailed = async (id: string, at: string) => {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, property: { ...record.property, refreshFailedAt: at } });
  };
  patch = async (id: string, input: PropertyPatchInput, now: string) => {
    const record = this.records.get(id);
    if (!record) return null;
    const userOverrides = { ...record.property.userOverrides };
    for (const [field, value] of Object.entries(input.overrides ?? {})) {
      const key = field as keyof typeof userOverrides;
      if (value === null) delete userOverrides[key];
      else if (value !== undefined) userOverrides[key] = { value, source: 'USER', updatedAt: now };
    }
    const updated = { ...record, property: { ...record.property, notes: input.notes === undefined ? record.property.notes : input.notes, userOverrides, updatedAt: now } };
    this.records.set(id, updated);
    return updated;
  };
  delete = async (id: string) => { this.snapshots = this.snapshots.filter(item => item.propertyId !== id); return this.records.delete(id); };
}

function setup() {
  const repository = new MemoryRepository();
  const search = vi.fn(async () => [profile]);
  const provider: PropertyDataProvider = { name: 'RENTCAST', search };
  let current = new Date('2026-09-29T12:00:00.000Z');
  const service = new PropertyService(repository, provider, () => current);
  return { repository, provider, search, service, current: () => current, advance: (days: number) => { current = new Date(current.getTime() + days * 86_400_000); } };
}

describe('property resolution and persistence rules', () => {
  it('keeps profile expiry configurable with a bounded default', () => {
    expect(parseProfileTtlDays({})).toBe(14);
    expect(parseProfileTtlDays({ PROPERTY_PROFILE_TTL_DAYS: '7' })).toBe(7);
    expect(() => parseProfileTtlDays({ PROPERTY_PROFILE_TTL_DAYS: '0' })).toThrow('PROPERTY_PROFILE_TTL_DAYS');
  });

  it('uses a shortened profile TTL on an existing saved snapshot', async () => {
    const { repository, provider, service, search, advance, current } = setup();
    const first = await service.resolve(address);
    advance(8);
    const shorter = new PropertyService(repository, provider, current, 7);
    expect((await shorter.get(first.property.id)).cache.freshness).toBe('STALE');
    expect((await shorter.resolve(address)).cache.cacheStatus).toBe('REFRESHED');
    expect(search).toHaveBeenCalledTimes(2);
  });
  it('uses a fresh 14-day snapshot and normalizes duplicate address spellings', async () => {
    const { service, search, repository } = setup();
    const first = await service.resolve(address);
    const second = await service.resolve('123 MAIN STREET, APARTMENT 2, AUSTIN, TX 78701');
    expect(first.cache.cacheStatus).toBe('MISS');
    expect(second.cache.cacheStatus).toBe('HIT');
    expect(search).toHaveBeenCalledTimes(1);
    expect(repository.records.size).toBe(1);
  });

  it('coalesces simultaneous cache misses into one provider request', async () => {
    const { service, search, repository } = setup();
    const [a, b] = await Promise.all([service.resolve(address), service.resolve(address)]);
    expect(a.property.id).toBe(b.property.id);
    expect(search).toHaveBeenCalledTimes(1);
    expect(repository.snapshots).toHaveLength(1);
  });

  it('refreshes expired data but preserves stale data and fetchedAt if refresh fails', async () => {
    const { service, search, repository, advance } = setup();
    const initial = await service.resolve(address);
    advance(15);
    search.mockRejectedValueOnce(new ProviderError('UPSTREAM'));
    const fallback = await service.resolve(address);
    expect(fallback.cache.cacheStatus).toBe('STALE_FALLBACK');
    expect(fallback.cache.freshness).toBe('STALE');
    expect(fallback.cache.fetchedAt).toBe(initial.cache.fetchedAt);
    expect(repository.snapshots).toHaveLength(1);
    expect((await service.get(initial.property.id)).cache.freshness).toBe('STALE');
    const refreshed = await service.refresh(initial.property.id);
    expect(refreshed.cache.cacheStatus).toBe('REFRESHED');
    expect(refreshed.cache.fetchedAt).not.toBe(initial.cache.fetchedAt);
    expect(repository.snapshots).toHaveLength(2);
  });

  it('persists failed forced-refresh status even before the original TTL ends', async () => {
    const { service, search } = setup();
    const initial = await service.resolve(address);
    search.mockRejectedValueOnce(new ProviderError('TIMEOUT'));
    const fallback = await service.refresh(initial.property.id);
    expect(fallback.cache.cacheStatus).toBe('STALE_FALLBACK');
    expect((await service.get(initial.property.id)).cache.freshness).toBe('STALE');
    expect((await service.refresh(initial.property.id)).cache.freshness).toBe('FRESH');
  });

  it('keeps note and override edits separate from immutable provider snapshots', async () => {
    const { service, repository, advance } = setup();
    const initial = await service.resolve(address);
    advance(2);
    const edited = await service.patch(initial.property.id, { notes: 'Check kitchen condition', overrides: { livingAreaSqft: 1350 } });
    expect(edited.property.notes).toBe('Check kitchen condition');
    expect(edited.property.livingAreaSqft).toBe(1200);
    expect(edited.property.effectiveValues.livingAreaSqft).toBe(1350);
    expect(edited.property.userOverrides.livingAreaSqft?.source).toBe('USER');
    expect(edited.cache.fetchedAt).toBe(initial.cache.fetchedAt);
    expect(repository.snapshots[0]?.normalizedPayload.livingAreaSqft).toBe(1200);
  });

  it('preserves apartment identity and refuses an ambiguous provider match', async () => {
    const { service, search } = setup();
    expect(normalizeAddressKey(address)).not.toBe(normalizeAddressKey('123 Main St, Apt 3, Austin, TX 78701'));
    search.mockResolvedValueOnce([{ ...profile, providerPropertyId: 'a' }, { ...profile, providerPropertyId: 'b' }]);
    await expect(service.resolve(address)).rejects.toMatchObject({ code: 'AMBIGUOUS_PROPERTY', status: 409 });
    search.mockResolvedValueOnce([{ ...profile, unit: 'Apt 3', formattedAddress: '123 Main St, Apt 3, Austin, TX 78701' }]);
    await expect(service.resolve(address)).rejects.toMatchObject({ code: 'PROPERTY_NOT_FOUND' });
    search.mockResolvedValueOnce([profile, { ...profile, providerPropertyId: 'rentcast-apt-3', unit: 'Apt 3', formattedAddress: '123 Main St, Apt 3, Austin, TX 78701' }]);
    await expect(service.resolve('123 Main St, Austin, TX 78701')).rejects.toMatchObject({ code: 'AMBIGUOUS_PROPERTY' });
  });

  it('rejects malformed provider responses and never includes owner data in normalized profiles', () => {
    expect(() => normalizeRentCastResponse({ bad: true })).toThrow(ProviderError);
    expect(() => normalizeRentCastResponse([{ ...profile, addressLine1: null }])).toThrow(ProviderError);
    const normalized = normalizeRentCastResponse([{ id: 'x', formattedAddress: address, addressLine1: '123 Main St', addressLine2: 'Apt 2', city: 'Austin', state: 'TX', zipCode: '78701', owner: { names: ['private'] } }]);
    expect(JSON.stringify(normalized)).not.toContain('private');
    expect(normalized[0]?.currentListPrice).toBeNull();
  });

  it('deletes the subject and snapshots and paginates only saved subjects', async () => {
    const { service, search, repository } = setup();
    const first = await service.resolve(address);
    const secondProfile = { ...profile, providerPropertyId: 'rentcast-apt-3', unit: 'Apt 3', formattedAddress: '123 Main St, Apt 3, Austin, TX 78701' };
    search.mockResolvedValueOnce([secondProfile]);
    const second = await service.resolve(secondProfile.formattedAddress);
    expect((await service.list({ page: 1, pageSize: 1, search: 'Main' })).total).toBe(2);
    expect((await service.list({ page: 2, pageSize: 1, search: 'Main' })).items).toHaveLength(1);
    await service.delete(first.property.id);
    expect(repository.snapshots).toHaveLength(1);
    expect(repository.records.has(second.property.id)).toBe(true);
    await expect(service.get(first.property.id)).rejects.toBeInstanceOf(PropertyError);
  });
});
