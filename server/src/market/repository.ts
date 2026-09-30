import type { MarketComparableCandidate, MarketEvidenceKind, MarketQuery } from '@ppi/shared';
import type { Pool } from 'pg';

export type EvidenceSnapshot = { candidates: MarketComparableCandidate[]; query: MarketQuery; fetchedAt: string; expiresAt: string };
export interface MarketRepository {
  latest(propertyId: string, kind: MarketEvidenceKind, queryHash: string): Promise<EvidenceSnapshot | null>;
  save(propertyId: string, kind: MarketEvidenceKind, queryHash: string, snapshot: EvidenceSnapshot, contentHash: string): Promise<void>;
}

export class PgMarketRepository implements MarketRepository {
  constructor(private readonly pool: Pool) {}
  async latest(propertyId: string, kind: MarketEvidenceKind, queryHash: string): Promise<EvidenceSnapshot | null> {
    const result = await this.pool.query(`SELECT "fetchedAt", "expiresAt", "normalizedPayload" FROM "DataSnapshot" WHERE "propertyId"=$1 AND "kind"=$2 AND "queryHash"=$3 ORDER BY "fetchedAt" DESC, "createdAt" DESC LIMIT 1`, [propertyId, kind, queryHash]);
    const row = result.rows[0];
    if (!row) return null;
    return { candidates: row.normalizedPayload.candidates, query: row.normalizedPayload.query,
      fetchedAt: row.fetchedAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
  }
  async save(propertyId: string, kind: MarketEvidenceKind, queryHash: string, snapshot: EvidenceSnapshot, contentHash: string): Promise<void> {
    await this.pool.query(`INSERT INTO "DataSnapshot" ("propertyId","kind","provider","fetchedAt","sourceDataAsOf","expiresAt","queryHash","contentHash","normalizedPayload") VALUES ($1,$2,'RENTCAST',$3,NULL,$4,$5,$6,$7::jsonb)`,
      [propertyId, kind, snapshot.fetchedAt, snapshot.expiresAt, queryHash, contentHash, JSON.stringify({ candidates: snapshot.candidates, query: snapshot.query })]);
  }
}
