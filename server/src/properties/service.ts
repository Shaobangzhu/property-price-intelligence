import { createHash } from 'node:crypto';
import type { PropertyEnvelope, PropertyListResponse, PropertyPatchInput } from '@ppi/shared';
import { addressMatches, normalizeAddressKey, requestedUnit } from './address.js';
import { ProviderError, type NormalizedProviderProperty, type PropertyDataProvider } from './provider.js';
import type { PropertyRepository, StoredRecord } from './repository.js';

export function parseProfileTtlDays(env: NodeJS.ProcessEnv): number {
  const raw = env.PROPERTY_PROFILE_TTL_DAYS;
  if (raw === undefined || raw === '') return 14;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 60) throw new Error('Invalid configuration: PROPERTY_PROFILE_TTL_DAYS');
  return value;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class PropertyError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

function selectSubject(candidates: NormalizedProviderProperty[], address: string): NormalizedProviderProperty {
  const matches = candidates.filter(candidate => addressMatches(address, candidate));
  if (matches.length > 1) throw new PropertyError('AMBIGUOUS_PROPERTY', 409);
  if (!matches.length) {
    if (requestedUnit(address) === null && candidates.filter(candidate => normalizeAddressKey(`${candidate.addressLine1}, ${candidate.city}, ${candidate.state} ${candidate.zipCode}`) === normalizeAddressKey(address)).length > 1) {
      throw new PropertyError('AMBIGUOUS_PROPERTY', 409);
    }
    throw new PropertyError('PROPERTY_NOT_FOUND', 404);
  }
  return matches[0]!;
}

function providerFailure(error: ProviderError): PropertyError {
  if (error.code === 'CONFIGURATION') return new PropertyError('RENTCAST_API_KEY_MISSING', 503);
  if (error.code === 'MALFORMED') return new PropertyError('PROVIDER_MALFORMED', 502);
  if (error.code === 'RATE_LIMIT') return new PropertyError('PROVIDER_RATE_LIMIT', 503);
  if (error.code === 'AUTH') return new PropertyError('PROVIDER_AUTH_FAILED', 502);
  return new PropertyError('PROVIDER_UNAVAILABLE', 502);
}

export class PropertyService {
  private readonly inFlight = new Map<string, Promise<PropertyEnvelope>>();
  constructor(private readonly repository: PropertyRepository, private readonly provider: PropertyDataProvider, private readonly now: () => Date = () => new Date(), private readonly profileTtlDays = 14) {}

  private profileExpiresAt(snapshot: NonNullable<StoredRecord['snapshot']>): string {
    return new Date(Math.min(new Date(snapshot.expiresAt).getTime(), new Date(snapshot.fetchedAt).getTime() + this.profileTtlDays * 86_400_000)).toISOString();
  }

  private envelope(record: StoredRecord, cacheStatus: PropertyEnvelope['cache']['cacheStatus'] = null): PropertyEnvelope {
    const { property, snapshot } = record;
    const effectiveValues = {
      bedrooms: property.userOverrides.bedrooms?.value ?? property.bedrooms,
      bathrooms: property.userOverrides.bathrooms?.value ?? property.bathrooms,
      livingAreaSqft: property.userOverrides.livingAreaSqft?.value ?? property.livingAreaSqft,
      yearBuilt: property.userOverrides.yearBuilt?.value ?? property.yearBuilt
    };
    return {
      property: { ...property, effectiveValues },
      cache: {
        source: snapshot?.provider ?? null,
        fetchedAt: snapshot?.fetchedAt ?? null,
        expiresAt: snapshot ? this.profileExpiresAt(snapshot) : null,
        freshness: !snapshot ? 'UNKNOWN' : cacheStatus === 'STALE_FALLBACK' || (property.refreshFailedAt !== null && new Date(property.refreshFailedAt).getTime() >= new Date(snapshot.fetchedAt).getTime()) ? 'STALE' : new Date(this.profileExpiresAt(snapshot)).getTime() > this.now().getTime() ? 'FRESH' : 'STALE',
        cacheStatus
      }
    };
  }

  private singleflight(key: string, action: () => Promise<PropertyEnvelope>): Promise<PropertyEnvelope> {
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const result = action().finally(() => { if (this.inFlight.get(key) === result) this.inFlight.delete(key); });
    this.inFlight.set(key, result);
    return result;
  }

  resolve(address: string): Promise<PropertyEnvelope> {
    const key = normalizeAddressKey(address);
    return this.singleflight(key, () => this.resolveInternal(address, key, false));
  }

  private async resolveInternal(address: string, key: string, force: boolean, known?: StoredRecord): Promise<PropertyEnvelope> {
    const existing = known ?? await this.repository.findByAddressKey(key);
    if (!force && existing?.snapshot && new Date(this.profileExpiresAt(existing.snapshot)).getTime() > this.now().getTime()
      && (!existing.property.refreshFailedAt || new Date(existing.property.refreshFailedAt).getTime() < new Date(existing.snapshot.fetchedAt).getTime())) return this.envelope(existing, 'HIT');
    let candidates: NormalizedProviderProperty[];
    try { candidates = await this.provider.search(address); }
    catch (error) {
      if (error instanceof ProviderError) {
        if (existing?.snapshot) {
          const failedAt = this.now().toISOString();
          await this.repository.markRefreshFailed(existing.property.id, failedAt);
          return this.envelope({ ...existing, property: { ...existing.property, refreshFailedAt: failedAt } }, 'STALE_FALLBACK');
        }
        throw providerFailure(error);
      }
      throw error;
    }
    const profile = selectSubject(candidates, address);
    const fetchedAt = this.now();
    let saved: StoredRecord;
    try {
      saved = await this.repository.saveProfile({
        profile, normalizedAddressKey: normalizeAddressKey(profile.formattedAddress),
        queryHash: hash(key), contentHash: hash(JSON.stringify(profile)),
        fetchedAt: fetchedAt.toISOString(), expiresAt: new Date(fetchedAt.getTime() + this.profileTtlDays * 86_400_000).toISOString()
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'PROPERTY_IDENTITY_CONFLICT') throw new PropertyError('PROPERTY_IDENTITY_CONFLICT', 409);
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new PropertyError('PROPERTY_IDENTITY_CONFLICT', 409);
      throw error;
    }
    return this.envelope(saved, existing?.snapshot ? 'REFRESHED' : 'MISS');
  }

  async refresh(id: string): Promise<PropertyEnvelope> {
    const current = await this.repository.findById(id);
    if (!current) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
    return this.singleflight(current.property.normalizedAddressKey, () => this.resolveInternal(current.property.formattedAddress, current.property.normalizedAddressKey, true, current));
  }

  async get(id: string): Promise<PropertyEnvelope> {
    const record = await this.repository.findById(id);
    if (!record) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
    return this.envelope(record);
  }

  async list(options: { page: number; pageSize: number; search: string }): Promise<PropertyListResponse> {
    const page = await this.repository.list(options);
    return { ...page, items: page.items.map(item => this.envelope(item)) };
  }

  async patch(id: string, input: PropertyPatchInput): Promise<PropertyEnvelope> {
    const record = await this.repository.patch(id, input, this.now().toISOString());
    if (!record) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
    return this.envelope(record);
  }

  async delete(id: string): Promise<void> {
    if (!await this.repository.delete(id)) throw new PropertyError('PROPERTY_NOT_FOUND', 404);
  }
}
