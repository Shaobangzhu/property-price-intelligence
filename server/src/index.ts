import { createApp } from './app.js';
import { loadServerEnv, parseServerConfig } from './config/env.js';
import { createDatabase } from './infrastructure/database.js';

async function main() {
  const config = parseServerConfig(loadServerEnv());
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const db = createDatabase(config.DATABASE_URL);
  const app = createApp({ checkDatabase: db.check, origins: config.origins, log: entry => process.stderr.write(JSON.stringify(entry) + '\n') });
  const server = app.listen(config.PORT, config.HOST, () => process.stdout.write(`PPI API listening on ${config.HOST}:${config.PORT}\n`));
  let closing = false;
  const shutdown = () => { if (closing) return; closing = true; server.close(async () => { await db.close(); process.exitCode = 0; }); setTimeout(() => { process.exitCode = 1; server.closeAllConnections(); }, 5000).unref(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
main().catch(() => { process.stderr.write('PPI API could not start: check local configuration\n'); process.exitCode = 1; });
