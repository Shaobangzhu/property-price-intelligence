import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerEnv, parseServerConfig } from '../server/src/config/env.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let config;
try { config = parseServerConfig(loadServerEnv()); }
catch { process.stdout.write('DATABASE_URL: INVALID FORMAT\n'); process.exit(1); }
if (!config.DATABASE_URL) { process.stdout.write('DATABASE_URL: MISSING\n'); process.exit(1); }

const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  cwd: root, env: process.env, encoding: 'utf8'
});
process.stdout.write(result.status === 0 ? 'PPI migrations applied\n' : 'PPI migration failed\n');
process.exit(result.status ?? 1);
