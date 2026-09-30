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
    for (const migration of ['20260929000000_property_profile', '20260929000100_refresh_failure_marker']) {
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
});
