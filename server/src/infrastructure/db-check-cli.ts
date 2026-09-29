import { loadServerEnv, parseServerConfig } from '../config/env.js';
import { createDatabase } from './database.js';

async function main() {
  const config = parseServerConfig(loadServerEnv());
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const db = createDatabase(config.DATABASE_URL);
  try { const ready = await db.check(); process.stdout.write(ready ? 'PPI database ready\n' : 'PPI database unavailable\n'); if (!ready) process.exitCode = 1; }
  finally { await db.close(); }
}
main().catch(() => { process.stderr.write('PPI database check failed: configuration or connection unavailable\n'); process.exitCode = 1; });
