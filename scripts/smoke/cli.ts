import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { loadServerEnv, parseConfig } from '../../server/src/config/env.js';
import { runSmoke } from './runner.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--live')) throw new Error('Unknown smoke option');
  const config = parseConfig(loadServerEnv());
  const path = resolve(process.cwd(), 'client/.env.local');
  const clientValues = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  const browserKeyConfigured = !!(process.env.VITE_ARCGIS_API_KEY ?? clientValues.VITE_ARCGIS_API_KEY);
  const result = await runSmoke(config, { live: args.includes('--live'), browserKeyConfigured });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
main().catch(() => { process.stderr.write('Smoke runner stopped: invalid configuration or live gate\n'); process.exitCode = 1; });
