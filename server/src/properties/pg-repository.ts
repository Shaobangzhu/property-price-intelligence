import type { Pool, PoolClient } from 'pg';
import type { PropertyPatchInput, PropertyRecord } from '@ppi/shared';
import type { NormalizedProviderProperty } from './provider.js';
import type { PropertyRepository, SaveProfile, StoredProperty, StoredRecord, StoredSnapshot } from './repository.js';
import { addressMatches } from './address.js';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
type Row = Record<string, unknown>;

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const decimal = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);
const integer = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);
const text = (value: unknown): string => String(value);
const nullableText = (value: unknown): string | null => value === null || value === undefined ? null : String(value);

function propertyFromRow(row: Row): StoredProperty {
  return {
    id: text(row.id), provider: 'RENTCAST', providerPropertyId: nullableText(row.providerPropertyId), normalizedAddressKey: text(row.normalizedAddressKey),
    formattedAddress: text(row.formattedAddress), addressLine1: text(row.addressLine1), unit: nullableText(row.unit), city: text(row.city), state: text(row.state), zipCode: text(row.zipCode),
    latitude: decimal(row.latitude), longitude: decimal(row.longitude), propertyType: nullableText(row.propertyType),
    bedrooms: decimal(row.bedrooms), bathrooms: decimal(row.bathrooms), livingAreaSqft: integer(row.livingAreaSqft), lotSizeSqft: integer(row.lotSizeSqft),
    yearBuilt: integer(row.yearBuilt), currentListPrice: decimal(row.currentListPrice), refreshFailedAt: row.refreshFailedAt ? iso(row.refreshFailedAt) : null, notes: nullableText(row.notes),
    userOverrides: (row.userOverrides ?? {}) as PropertyRecord['userOverrides'], createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt)
  };
}

function snapshotFromRow(row: Row): StoredSnapshot | null {
  if (!row.snapshotId) return null;
  return {
    id: text(row.snapshotId), propertyId: text(row.id), kind: 'PROPERTY_PROFILE', provider: 'RENTCAST',
    fetchedAt: iso(row.fetchedAt), sourceDataAsOf: row.sourceDataAsOf ? iso(row.sourceDataAsOf) : null,
    expiresAt: iso(row.expiresAt), queryHash: text(row.queryHash), contentHash: text(row.contentHash),
    normalizedPayload: row.normalizedPayload as NormalizedProviderProperty, createdAt: iso(row.snapshotCreatedAt)
  };
}

const latest = `LEFT JOIN LATERAL (
  SELECT s."id" AS "snapshotId", s."fetchedAt", s."sourceDataAsOf", s."expiresAt", s."queryHash", s."contentHash", s."normalizedPayload", s."createdAt" AS "snapshotCreatedAt"
  FROM "DataSnapshot" s WHERE s."propertyId" = p."id" AND s."kind" = 'PROPERTY_PROFILE'
  ORDER BY s."fetchedAt" DESC, s."createdAt" DESC LIMIT 1
) s ON TRUE`;

async function getWithSnapshot(db: Queryable, id: string): Promise<StoredRecord | null> {
  const result = await db.query(`SELECT p.*, s.* FROM "Property" p ${latest} WHERE p."id" = $1`, [id]);
  const row = result.rows[0] as Row | undefined;
  return row ? { property: propertyFromRow(row), snapshot: snapshotFromRow(row) } : null;
}

function profileValues(profile: NormalizedProviderProperty, key: string): unknown[] {
  return [profile.provider, profile.providerPropertyId, key, profile.formattedAddress, profile.addressLine1, profile.unit, profile.city, profile.state, profile.zipCode,
    profile.latitude, profile.longitude, profile.propertyType, profile.bedrooms, profile.bathrooms, profile.livingAreaSqft, profile.lotSizeSqft, profile.yearBuilt, profile.currentListPrice];
}

export class PgPropertyRepository implements PropertyRepository {
  constructor(private readonly pool: Pool) {}

  async findByAddressKey(key: string): Promise<StoredRecord | null> {
    const result = await this.pool.query(`SELECT p.*, s.* FROM "Property" p ${latest} WHERE p."normalizedAddressKey" = $1`, [key]);
    const row = result.rows[0] as Row | undefined;
    return row ? { property: propertyFromRow(row), snapshot: snapshotFromRow(row) } : null;
  }

  findById(id: string): Promise<StoredRecord | null> { return getWithSnapshot(this.pool, id); }

  async list({ page, pageSize, search }: { page: number; pageSize: number; search: string }) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const [rows, count] = await Promise.all([
      this.pool.query(`SELECT p.*, s.* FROM "Property" p ${latest} WHERE p."formattedAddress" ILIKE $1 ESCAPE '\\' ORDER BY p."updatedAt" DESC, p."id" DESC LIMIT $2 OFFSET $3`, [pattern, pageSize, (page - 1) * pageSize]),
      this.pool.query(`SELECT COUNT(*)::int AS count FROM "Property" WHERE "formattedAddress" ILIKE $1 ESCAPE '\\'`, [pattern])
    ]);
    return { items: (rows.rows as Row[]).map(row => ({ property: propertyFromRow(row), snapshot: snapshotFromRow(row) })), total: Number(count.rows[0]?.count ?? 0), page, pageSize };
  }

  async saveProfile(input: SaveProfile): Promise<StoredRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locks = [`address:${input.normalizedAddressKey}`, `provider:${input.profile.providerPropertyId ?? input.normalizedAddressKey}`].sort();
      for (const lock of locks) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lock]);
      // A refresh may finish after the user deletes the subject. Keep the owning row
      // locked through the write so an old request cannot recreate that property.
      if (input.expectedPropertyId) {
        const expected = await client.query('SELECT "id" FROM "Property" WHERE "id"=$1 FOR UPDATE', [input.expectedPropertyId]);
        if (!expected.rows[0]) throw new Error('PROPERTY_NOT_FOUND');
      }
      const existing = await client.query(`SELECT "id", "formattedAddress", "unit" FROM "Property" WHERE ("provider" = $1 AND "providerPropertyId" = $2 AND $2 IS NOT NULL) OR "normalizedAddressKey" = $3 FOR UPDATE`, [input.profile.provider, input.profile.providerPropertyId, input.normalizedAddressKey]);
      if (existing.rowCount && existing.rowCount > 1) throw new Error('PROPERTY_IDENTITY_CONFLICT');
      if (input.expectedPropertyId && existing.rows[0]?.id !== input.expectedPropertyId) throw new Error('PROPERTY_IDENTITY_CONFLICT');
      if (existing.rows[0] && !addressMatches(input.profile.formattedAddress, { formattedAddress: text(existing.rows[0].formattedAddress), unit: nullableText(existing.rows[0].unit) })) throw new Error('PROPERTY_IDENTITY_CONFLICT');
      const values = profileValues(input.profile, input.normalizedAddressKey);
      let propertyId: string;
      if (existing.rows[0]) {
        propertyId = text(existing.rows[0].id);
        await client.query(`UPDATE "Property" SET
          "provider"=$1,"providerPropertyId"=$2,"normalizedAddressKey"=$3,"formattedAddress"=$4,"addressLine1"=$5,"unit"=$6,"city"=$7,"state"=$8,"zipCode"=$9,
          "latitude"=$10,"longitude"=$11,"propertyType"=$12,"bedrooms"=$13,"bathrooms"=$14,"livingAreaSqft"=$15,"lotSizeSqft"=$16,"yearBuilt"=$17,"currentListPrice"=$18,"refreshFailedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$19`, [...values, propertyId]);
      } else {
        const inserted = await client.query(`INSERT INTO "Property" ("provider","providerPropertyId","normalizedAddressKey","formattedAddress","addressLine1","unit","city","state","zipCode","latitude","longitude","propertyType","bedrooms","bathrooms","livingAreaSqft","lotSizeSqft","yearBuilt","currentListPrice")
          VALUES (${Array.from({ length: 18 }, (_, i) => `$${i + 1}`).join(',')}) RETURNING "id"`, values);
        propertyId = text(inserted.rows[0]?.id);
      }
      await client.query(`INSERT INTO "DataSnapshot" ("propertyId","kind","provider","fetchedAt","sourceDataAsOf","expiresAt","queryHash","contentHash","normalizedPayload")
        VALUES ($1,'PROPERTY_PROFILE',$2,$3,NULL,$4,$5,$6,$7::jsonb)`, [propertyId, input.profile.provider, input.fetchedAt, input.expiresAt, input.queryHash, input.contentHash, JSON.stringify(input.profile)]);
      const result = await getWithSnapshot(client, propertyId);
      await client.query('COMMIT');
      if (!result) throw new Error('PROPERTY_WRITE_FAILED');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async markRefreshFailed(id: string, at: string): Promise<void> {
    await this.pool.query('UPDATE "Property" SET "refreshFailedAt"=$2 WHERE "id"=$1', [id, at]);
  }

  async patch(id: string, input: PropertyPatchInput, now: string): Promise<StoredRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT "notes","userOverrides" FROM "Property" WHERE "id"=$1 FOR UPDATE', [id]);
      if (!current.rows[0]) { await client.query('ROLLBACK'); return null; }
      const overrides: PropertyRecord['userOverrides'] = { ...(current.rows[0].userOverrides ?? {}) };
      for (const [field, value] of Object.entries(input.overrides ?? {})) {
        const key = field as keyof PropertyRecord['userOverrides'];
        if (value === null) delete overrides[key];
        else if (value !== undefined) overrides[key] = { value, source: 'USER', updatedAt: now };
      }
      const notes = input.notes === undefined ? current.rows[0].notes : input.notes;
      await client.query('UPDATE "Property" SET "notes"=$2,"userOverrides"=$3::jsonb,"updatedAt"=$4 WHERE "id"=$1', [id, notes, JSON.stringify(overrides), now]);
      const result = await getWithSnapshot(client, id);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM "Property" WHERE "id"=$1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
