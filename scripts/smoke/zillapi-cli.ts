import { loadServerEnv, parseConfig } from '../../server/src/config/env.js';
import { runZillapiSmoke } from './zillapi.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--live')) throw new Error('Unknown smoke option');
  const result = await runZillapiSmoke(parseConfig(loadServerEnv()), { live: args.includes('--live') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.status === 'FAILED') process.exitCode = 1;
}
main().catch(() => { process.stderr.write('Zillapi diagnostic stopped: invalid configuration\n'); process.exitCode = 1; });
