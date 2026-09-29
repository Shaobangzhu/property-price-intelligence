import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const operation = process.argv[2];
if (!['up', 'down', 'ps', 'logs'].includes(operation)) { process.stderr.write('Use db-compose up, down, ps, or logs\n'); process.exit(1); }
const root = resolve(import.meta.dirname, '..');
const path = resolve(root, '.env');
if (!existsSync(path)) { process.stderr.write('Missing root .env\n'); process.exit(1); }
const fileValues = parseEnv(readFileSync(path, 'utf8'));
const values = Object.fromEntries(['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_PORT'].map(key => [key, process.env[key] ?? fileValues[key]]));
if (values.POSTGRES_DB !== 'property_price_intelligence' || values.POSTGRES_USER !== 'ppi_app' || values.POSTGRES_PORT !== '55435' || !values.POSTGRES_PASSWORD || values.POSTGRES_PASSWORD.startsWith('<')) { process.stderr.write('Invalid PPI Compose configuration\n'); process.exit(1); }
const serverPath = resolve(root, 'server/.env');
if (['up', 'down'].includes(operation) && existsSync(serverPath)) {
  const server = parseEnv(readFileSync(serverPath, 'utf8'));
  const databaseUrl = process.env.DATABASE_URL ?? server.DATABASE_URL;
  if (databaseUrl) {
    try { const url = new URL(databaseUrl); if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== values.POSTGRES_PORT || url.pathname !== '/' + values.POSTGRES_DB || decodeURIComponent(url.password) !== values.POSTGRES_PASSWORD || url.username !== values.POSTGRES_USER) throw new Error(); }
    catch { process.stderr.write('PPI database configurations disagree\n'); process.exit(1); }
  }
}
const base = ['compose', '-p', 'ppi-local', '--project-directory', root, '-f', resolve(root, 'compose.yaml'), '--env-file', path];
const run = args => spawnSync('docker', [...base, ...args], { stdio: 'inherit' });
if (run(['config', '-q']).status !== 0) process.exit(1);
if (operation === 'up') {
  const existing = spawnSync('docker', [...base, 'ps', '-q', 'postgres'], { encoding: 'utf8' });
  if (existing.status !== 0) process.exit(1);
  if (!existing.stdout.trim()) {
    const occupied = await new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port: 55435 }); socket.setTimeout(400); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); }); });
    if (occupied) { process.stderr.write('Port 55435 is occupied by an unrelated service; PPI database not started\n'); process.exit(1); }
  }
}
const command = operation === 'up' ? ['up', '-d', '--no-recreate', 'postgres'] : operation === 'down' ? ['down'] : operation === 'ps' ? ['ps', 'postgres'] : ['logs', '--tail', '100', '--no-color', 'postgres'];
process.exit(run(command).status ?? 1);
