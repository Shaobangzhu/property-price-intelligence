// Read only; the configuration guard permits only the dedicated local PPI database.
import pg from 'pg';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadServerEnv, parseServerConfig } from '../server/src/config/env.ts';

const config = parseServerConfig(loadServerEnv());
if (!config.DATABASE_URL) { process.stderr.write('DATABASE_URL: MISSING\n'); process.exit(1); }
const client = new pg.Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 3000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const applied = (await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map(row => row.migration_name);
  const expected = readdirSync(resolve(import.meta.dirname, '../prisma/migrations'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  const migrationOk = expected.every(name => applied.includes(name));
  const result = await client.query(`WITH payloads AS (
    SELECT "normalizedPayload" AS value FROM "DataSnapshot"
    UNION ALL SELECT "inputSnapshot" FROM "AnalysisRun"
    UNION ALL SELECT "engineResult" FROM "AnalysisRun"
    UNION ALL SELECT "aiResult" FROM "AnalysisRun" WHERE "aiResult" IS NOT NULL
    UNION ALL SELECT "userOverrides" FROM "Property" WHERE "userOverrides" IS NOT NULL
  ) SELECT COUNT(*)::int AS findings FROM payloads WHERE
    jsonb_path_exists(value, '$.**.placeId') OR jsonb_path_exists(value, '$.**.place_id') OR
    jsonb_path_exists(value, '$.**.grocery') OR jsonb_path_exists(value, '$.**.places')`);
  const clean = result.rows[0].findings === 0;
  await client.query('ROLLBACK');
  process.stdout.write(`Tracked migrations applied: ${migrationOk ? 'PASS' : 'FAIL'}\nPersisted Places-key check: ${clean ? 'PASS' : 'FAIL'}\n`);
  process.exitCode = migrationOk && clean ? 0 : 1;
} catch {
  process.stderr.write('PPI database audit unavailable\n');
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
