import pg from 'pg';
import { assertLocalDatabase } from '../config/env.js';

export type CheckDatabase = () => Promise<boolean>;
export function createDatabase(connection: string) {
  assertLocalDatabase(connection);
  const pool = new pg.Pool({ connectionString: connection, max: 2, connectionTimeoutMillis: 1500, idleTimeoutMillis: 1000, statement_timeout: 1500 });
  const check: CheckDatabase = async () => {
    try { const result = await pool.query('SELECT 1 AS ok'); return result.rows[0]?.ok === 1; }
    catch { return false; }
  };
  return { pool, check, close: () => pool.end() };
}
