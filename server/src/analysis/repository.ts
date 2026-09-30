import type { Pool } from 'pg';
import { AnalysisRun, type PricingPreviewRequest, type PricingPreviewResponse } from '@ppi/shared';
import { PropertyError } from '../properties/service.js';

export type NewRun = {
  propertyId: string; mode: 'OFFER' | 'LISTING'; strategyProfile: string; engineVersion: string; promptVersion: string;
  model: string; reasoningEffort: string; userInputs: PricingPreviewRequest; inputSnapshot: unknown;
  engineResult: PricingPreviewResponse; inputHash: string; requestKey: string;
};
export interface AnalysisRepository {
  claim(input: NewRun, force: boolean): Promise<{ run: AnalysisRun; claimed: boolean }>;
  get(id: string): Promise<AnalysisRun | null>;
  list(propertyId: string): Promise<{ items: AnalysisRun[]; total: number }>;
  finish(id: string, update: { status: 'SUCCEEDED' | 'FAILED'; aiResult: AnalysisRun['aiResult']; failureCode: string | null;
    tokenUsage: AnalysisRun['tokenUsage']; latencyMs: number }): Promise<AnalysisRun>;
}

function fromRow(value: unknown): AnalysisRun {
  const row = value as Record<string, unknown>;
  return AnalysisRun.parse({ ...row, createdAt: (row.createdAt as Date).toISOString(),
    completedAt: row.completedAt ? (row.completedAt as Date).toISOString() : null,
    tokenUsage: row.tokenUsage ?? null, aiResult: row.aiResult ?? null, failureCode: row.failureCode ?? null, latencyMs: row.latencyMs ?? null });
}

export class PgAnalysisRepository implements AnalysisRepository {
  constructor(private readonly pool: Pool) {}

  async claim(input: NewRun, force: boolean): Promise<{ run: AnalysisRun; claimed: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`analysis:${input.propertyId}:${input.mode}:${input.inputHash}`]);
      const request = await client.query('SELECT * FROM "AnalysisRun" WHERE "requestKey"=$1', [input.requestKey]);
      if (request.rows[0]) {
        const existing = fromRow(request.rows[0]);
        if (existing.propertyId !== input.propertyId || existing.mode !== input.mode || existing.inputHash !== input.inputHash)
          throw new PropertyError('REQUEST_KEY_CONFLICT', 409);
        await client.query('COMMIT'); return { run: existing, claimed: false };
      }
      await client.query(`UPDATE "AnalysisRun" SET "status"='FAILED', "failureCode"='INTERRUPTED', "completedAt"=CURRENT_TIMESTAMP
        WHERE "propertyId"=$1 AND "mode"=$2 AND "inputHash"=$3 AND "status"='RUNNING' AND "createdAt" < CURRENT_TIMESTAMP - INTERVAL '45 seconds'`,
      [input.propertyId, input.mode, input.inputHash]);
      const active = await client.query(`SELECT * FROM "AnalysisRun" WHERE "propertyId"=$1 AND "mode"=$2 AND "inputHash"=$3 AND "status"='RUNNING' LIMIT 1`,
        [input.propertyId, input.mode, input.inputHash]);
      if (active.rows[0]) { await client.query('COMMIT'); return { run: fromRow(active.rows[0]), claimed: false }; }
      if (!force) {
        const existing = await client.query(`SELECT * FROM "AnalysisRun" WHERE "propertyId"=$1 AND "mode"=$2 AND "inputHash"=$3 AND "status"='SUCCEEDED' ORDER BY "createdAt" DESC LIMIT 1`,
          [input.propertyId, input.mode, input.inputHash]);
        if (existing.rows[0]) { await client.query('COMMIT'); return { run: fromRow(existing.rows[0]), claimed: false }; }
      }
      const saved = await client.query(`INSERT INTO "AnalysisRun" ("propertyId","mode","status","strategyProfile","engineVersion","promptVersion","model","reasoningEffort",
        "userInputs","inputSnapshot","engineResult","inputHash","requestKey") VALUES ($1,$2,'RUNNING',$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12) RETURNING *`,
      [input.propertyId, input.mode, input.strategyProfile, input.engineVersion, input.promptVersion, input.model, input.reasoningEffort,
        JSON.stringify(input.userInputs), JSON.stringify(input.inputSnapshot), JSON.stringify(input.engineResult), input.inputHash, input.requestKey]);
      await client.query('COMMIT');
      return { run: fromRow(saved.rows[0]), claimed: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async get(id: string): Promise<AnalysisRun | null> {
    const result = await this.pool.query('SELECT * FROM "AnalysisRun" WHERE "id"=$1', [id]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async list(propertyId: string): Promise<{ items: AnalysisRun[]; total: number }> {
    const [items, count] = await Promise.all([
      this.pool.query('SELECT * FROM "AnalysisRun" WHERE "propertyId"=$1 ORDER BY "createdAt" DESC,"id" DESC LIMIT 100', [propertyId]),
      this.pool.query('SELECT COUNT(*)::int AS count FROM "AnalysisRun" WHERE "propertyId"=$1', [propertyId])
    ]);
    return { items: items.rows.map(fromRow), total: Number(count.rows[0]?.count ?? 0) };
  }

  async finish(id: string, update: { status: 'SUCCEEDED' | 'FAILED'; aiResult: AnalysisRun['aiResult']; failureCode: string | null;
    tokenUsage: AnalysisRun['tokenUsage']; latencyMs: number }): Promise<AnalysisRun> {
    const result = await this.pool.query(`UPDATE "AnalysisRun" SET "status"=$2,"aiResult"=$3::jsonb,"failureCode"=$4,
      "tokenUsage"=$5::jsonb,"latencyMs"=$6,"completedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='RUNNING' RETURNING *`,
    [id, update.status, update.aiResult ? JSON.stringify(update.aiResult) : null, update.failureCode,
      update.tokenUsage ? JSON.stringify(update.tokenUsage) : null, update.latencyMs]);
    if (!result.rows[0]) throw new Error('ANALYSIS_WRITE_FAILED');
    return fromRow(result.rows[0]);
  }
}
