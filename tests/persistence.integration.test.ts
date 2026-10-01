import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadServerEnv, parseServerConfig } from '../server/src/config/env.js';
import { PgPropertyRepository } from '../server/src/properties/pg-repository.js';
import { PropertyService } from '../server/src/properties/service.js';
import { ProviderError, type NormalizedProviderProperty } from '../server/src/properties/provider.js';
import { PgMarketRepository } from '../server/src/market/repository.js';
import { MarketEvidenceService } from '../server/src/market/service.js';
import { normalizeMarketResponse } from '../server/src/market/provider.js';
import { calculatePricing, type PricingInput } from '@ppi/shared';
import { PgAnalysisRepository } from '../server/src/analysis/repository.js';

const enabled = process.env.PPI_INTEGRATION_TESTS === 'true';
const address = '123 Main St, Apt 2, Austin, TX 78701';
const profile: NormalizedProviderProperty = {
  provider: 'RENTCAST', providerPropertyId: 'test-provider-id', formattedAddress: address, addressLine1: '123 Main St', unit: 'Apt 2',
  city: 'Austin', state: 'TX', zipCode: '78701', latitude: 30.1, longitude: -97.1, propertyType: 'Condo', bedrooms: 2,
  bathrooms: 2, livingAreaSqft: 1200, lotSizeSqft: null, yearBuilt: 2001, currentListPrice: null
};

describe.skipIf(!enabled)('PostgreSQL property workflow in an isolated test schema', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let repository: PgPropertyRepository;
  let schema: string;
  let publicCount: number;

  beforeAll(async () => {
    const config = parseServerConfig(loadServerEnv());
    if (!config.DATABASE_URL) throw new Error('DATABASE_URL MISSING');
    schema = `ppi_test_${randomBytes(6).toString('hex')}`;
    admin = new pg.Client({ connectionString: config.DATABASE_URL });
    await admin.connect();
    publicCount = Number((await admin.query('SELECT COUNT(*)::int AS count FROM public."Property"')).rows[0]?.count);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, options: `-c search_path=${schema}`, max: 2 });
    for (const migration of ['20260929000000_property_profile', '20260929000100_refresh_failure_marker', '20260929000200_analysis_run']) {
      await pool.query(readFileSync(resolve(`prisma/migrations/${migration}/migration.sql`), 'utf8'));
    }
    repository = new PgPropertyRepository(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin && schema) {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      expect(Number((await admin.query('SELECT COUNT(*)::int AS count FROM public."Property"')).rows[0]?.count)).toBe(publicCount);
      await admin.end();
    }
  });

  it('persists a normalized snapshot, keeps overrides separate, paginates, and cascades delete', async () => {
    const search = vi.fn(async () => [profile]);
    const service = new PropertyService(repository, { name: 'RENTCAST', search }, () => new Date('2026-09-29T12:00:00.000Z'));
    const created = await service.resolve(address);
    expect(created.cache.cacheStatus).toBe('MISS');
    expect(created.property.unit).toBe('Apt 2');
    expect((await service.resolve(address)).cache.cacheStatus).toBe('HIT');
    expect(search).toHaveBeenCalledTimes(1);
    const edited = await service.patch(created.property.id, { notes: 'Inspect', overrides: { livingAreaSqft: 1300 } });
    expect(edited.property.effectiveValues.livingAreaSqft).toBe(1300);
    expect(edited.property.livingAreaSqft).toBe(1200);
    expect(edited.cache.fetchedAt).toBe(created.cache.fetchedAt);
    expect((await service.list({ page: 1, pageSize: 5, search: 'Main' })).total).toBe(1);
    const snapshotCount = await pool.query('SELECT COUNT(*)::int AS count FROM "DataSnapshot" WHERE "propertyId"=$1', [created.property.id]);
    expect(snapshotCount.rows[0]?.count).toBe(1);
    search.mockRejectedValueOnce(new ProviderError('UPSTREAM'));
    expect((await service.refresh(created.property.id)).cache.cacheStatus).toBe('STALE_FALLBACK');
    expect((await service.get(created.property.id)).cache.freshness).toBe('STALE');
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM "DataSnapshot"')).rows[0]?.count).toBe(1);
    expect((await service.refresh(created.property.id)).cache.freshness).toBe('FRESH');
    await service.delete(created.property.id);
    expect((await service.list({ page: 1, pageSize: 5, search: '' })).total).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM "DataSnapshot"')).rows[0]?.count).toBe(0);
  });

  it('stores separate market snapshots with query metadata and cascades them with the subject', async () => {
    const propertyService = new PropertyService(repository, { name: 'RENTCAST', search: async () => [profile] });
    const created = await propertyService.resolve(address);
    const market = new MarketEvidenceService(repository, new PgMarketRepository(pool), { name: 'RENTCAST', search: async (kind, query, subject) =>
      normalizeMarketResponse(kind === 'RECORDED_SALES' ? [{ id: 'sale', formattedAddress: '125 Main St, Austin, TX 78701', latitude: 30.11, longitude: -97.11, lastSalePrice: 410000, lastSaleDate: '2026-06-01T00:00:00.000Z' }] :
        [{ id: 'listing', formattedAddress: '130 Main St, Austin, TX 78701', latitude: 30.12, longitude: -97.12, status: 'Active', price: 450000 }], kind, query, subject)
    }, undefined, () => new Date('2026-09-29T12:00:00.000Z'));
    const response = await market.get(created.property.id);
    expect(response.recordedSales.candidates[0]?.evidenceType).toBe('RECORDED_SALE');
    expect(response.activeListings.candidates[0]?.evidenceType).toBe('ACTIVE_ASKING_PRICE');
    const snapshots = await pool.query('SELECT "kind", "normalizedPayload" FROM "DataSnapshot" WHERE "propertyId"=$1 ORDER BY "kind"', [created.property.id]);
    expect(snapshots.rows.map(row => row.kind)).toEqual(['ACTIVE_LISTINGS', 'PROPERTY_PROFILE', 'RECORDED_SALES']);
    expect(snapshots.rows.find(row => row.kind === 'RECORDED_SALES')?.normalizedPayload.query.saleDateRangeDays).toBe(365);
    expect((await market.get(created.property.id)).recordedSales.cacheStatus).toBe('HIT');
    await propertyService.delete(created.property.id);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM "DataSnapshot"')).rows[0]?.count).toBe(0);
  });

  it('does not recreate a property deleted while its refresh is waiting for the provider', async () => {
    const search = vi.fn(async () => [profile]);
    const service = new PropertyService(repository, { name: 'RENTCAST', search });
    const created = await service.resolve(address);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    search.mockImplementationOnce(async () => { await pending; return [profile]; });
    const refreshing = service.refresh(created.property.id);
    const rejected = expect(refreshing).rejects.toMatchObject({ code: 'PROPERTY_NOT_FOUND', status: 404 });
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    await service.delete(created.property.id);
    release();
    await rejected;
    expect((await service.list({ page: 1, pageSize: 5, search: '' })).total).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM "DataSnapshot"')).rows[0]?.count).toBe(0);
  });

  it('refuses an address-key collision without overwriting the stored subject', async () => {
    const first = { ...profile, providerPropertyId: 'collision-first', unit: null, addressLine1: '1 23rd St', formattedAddress: '1 23rd St, Austin, TX 78701' };
    const second = { ...first, providerPropertyId: 'collision-second', addressLine1: '12 3rd St', formattedAddress: '12 3rd St, Austin, TX 78701' };
    const service = new PropertyService(repository, { name: 'RENTCAST', search: async address => address === first.formattedAddress ? [first] : [second] });
    const results = await Promise.allSettled([service.resolve(first.formattedAddress), service.resolve(second.formattedAddress)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'PROPERTY_IDENTITY_CONFLICT' } });
    expect((await service.list({ page: 1, pageSize: 5, search: '' })).total).toBe(1);
    for (const result of results) if (result.status === 'fulfilled') {
      expect((await service.get(result.value.property.id)).property.formattedAddress).toBe(result.value.property.formattedAddress);
      await service.delete(result.value.property.id);
    }
  });

  it('saves versioned analyses and frozen engine results without modifying refreshed property data', async () => {
    const propertyService = new PropertyService(repository, { name: 'RENTCAST', search: async () => [profile] });
    const created = await propertyService.resolve(address);
    const now = '2026-09-29T00:00:00.000Z';
    const sales = [200000, 220000, 240000].map((price, index) => ({ id: `sale:${index}`, providerId: `provider:${index}`, address: `${index} Main St`,
      evidenceType: 'RECORDED_SALE' as const, propertyType: 'Condo', price,
      eventDate: new Date(Date.parse(now) - (index + 1) * 30 * 86_400_000).toISOString(), distanceMiles: index / 2,
      livingAreaSqft: 1200, bedrooms: 2, bathrooms: 2 }));
    const input: PricingInput = { subject: { id: created.property.id, propertyType: 'Condo', livingAreaSqft: 1200, bedrooms: 2, bathrooms: 2,
      currentListPrice: null, overrideFields: [] }, recordedSales: sales, activeListings: [], mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: null,
      asOf: now, metadata: { propertyFreshness: 'FRESH', salesFreshness: 'FRESH', listingsFreshness: 'FRESH', salesSource: 'RENTCAST', listingsSource: 'RENTCAST',
        searchRadiusMiles: 2, saleDateRangeDays: 365 } };
    const analyses = new PgAnalysisRepository(pool);
    const runInput = { propertyId: created.property.id, mode: 'OFFER' as const, strategyProfile: 'BALANCED', engineVersion: 'ppi-pricing-v1',
      promptVersion: 'ppi-explanation-v1', model: 'gpt-5.6-luna', reasoningEffort: 'low', userInputs: { mode: 'OFFER' as const, strategyProfile: 'BALANCED' as const },
      inputSnapshot: input, engineResult: calculatePricing(input), inputHash: 'a'.repeat(64), requestKey: '11111111-1111-4111-8111-111111111111' };
    const claimed = await analyses.claim(runInput, false);
    expect(claimed.claimed).toBe(true);
    await expect(analyses.claim({ ...runInput, inputHash: 'b'.repeat(64) }, false)).rejects.toMatchObject({ code: 'REQUEST_KEY_CONFLICT' });
    expect((await analyses.claim({ ...runInput, requestKey: '22222222-2222-4222-8222-222222222222' }, false)).run.id).toBe(claimed.run.id);
    await analyses.finish(claimed.run.id, { status: 'FAILED', aiResult: null, failureCode: 'MODEL_TIMEOUT', tokenUsage: null, latencyMs: 12000 });
    const renewed = await analyses.claim({ ...runInput, requestKey: '33333333-3333-4333-8333-333333333333' }, false);
    expect(renewed.run.id).not.toBe(claimed.run.id);
    await propertyService.patch(created.property.id, { overrides: { livingAreaSqft: 1300 } });
    expect((await analyses.get(claimed.run.id))?.engineResult.referencePrice).toBe(claimed.run.engineResult.referencePrice);
    expect(((await analyses.get(claimed.run.id))?.inputSnapshot as PricingInput).subject.livingAreaSqft).toBe(1200);
    expect((await analyses.list(created.property.id)).total).toBe(2);
    const summary = await analyses.listSummaries(created.property.id, 1, 1);
    expect(summary.total).toBe(2);
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]).not.toHaveProperty('inputSnapshot');
    expect(summary.items[0]).not.toHaveProperty('engineResult');
    expect(summary.items[0]?.suggestedPrice).toBe(renewed.run.engineResult.offerResult?.suggestedPrice);
    expect((await analyses.listSummaries(created.property.id, 2, 1)).items[0]?.id).toBe(claimed.run.id);
    await pool.query(`UPDATE "AnalysisRun" SET "createdAt"=CURRENT_TIMESTAMP - INTERVAL '60 seconds' WHERE "id"=$1`, [renewed.run.id]);
    const interrupted = await analyses.claim({ ...runInput, requestKey: '33333333-3333-4333-8333-333333333333' }, false);
    expect(interrupted.claimed).toBe(false);
    expect(interrupted.run.failureCode).toBe('INTERRUPTED');
    expect((await analyses.get(renewed.run.id))?.status).toBe('FAILED');
    const concurrentKey = '44444444-4444-4444-8444-444444444444';
    const simultaneous = await Promise.allSettled([
      analyses.claim({ ...runInput, inputHash: 'c'.repeat(64), requestKey: concurrentKey }, true),
      analyses.claim({ ...runInput, inputHash: 'd'.repeat(64), requestKey: concurrentKey }, true)
    ]);
    expect(simultaneous.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const conflict = simultaneous.find(item => item.status === 'rejected');
    expect(conflict?.status === 'rejected' ? conflict.reason.code : null).toBe('REQUEST_KEY_CONFLICT');
    const activeId = simultaneous.flatMap(item => item.status === 'fulfilled' ? [item.value.run.id] : [])[0]!;
    await pool.query(`UPDATE "AnalysisRun" SET "createdAt"=CURRENT_TIMESTAMP - INTERVAL '60 seconds' WHERE "id"=$1`, [activeId]);
    expect((await analyses.get(activeId))?.failureCode).toBe('INTERRUPTED');
    await propertyService.delete(created.property.id);
    expect((await analyses.list(created.property.id)).total).toBe(0);
  });
});
