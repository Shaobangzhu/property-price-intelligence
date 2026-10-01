// Read-only audit. Never emit secret values, matching source lines, or provider records.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const git = process.platform === 'darwin' ? '/usr/bin/git' : 'git';
const localFiles = ['.env', 'server/.env', 'client/.env.local'];
const values = Object.fromEntries(localFiles.map(file => [file, existsSync(resolve(root, file)) ? parseEnv(readFileSync(resolve(root, file), 'utf8')) : {}]));
const names = ['RENTCAST_API_KEY', 'OPENAI_API_KEY', 'ARCGIS_PLACES_API_KEY', 'POSTGRES_PASSWORD', 'DATABASE_URL'];
const placeholder = value => !value || /[<>]|^(?:replace|your[-_ ]|example|changeme)/i.test(value);
const secrets = new Set();
for (const env of Object.values(values)) for (const name of names) {
  const value = env[name];
  if (!placeholder(value) && value.length >= 8) secrets.add(value);
  if (name === 'DATABASE_URL' && value) {
    try { const password = decodeURIComponent(new URL(value).password); if (password.length >= 8 && !placeholder(password)) secrets.add(password); } catch { /* Status only below. */ }
  }
}
for (const name of [...names, 'VITE_ARCGIS_API_KEY']) {
  const value = Object.values(values).map(env => env[name]).find(Boolean);
  let state = !value ? 'MISSING' : placeholder(value) ? 'INVALID FORMAT' : 'CONFIGURED';
  if (name === 'DATABASE_URL' && value) { try { new URL(value); } catch { state = 'INVALID FORMAT'; } }
  process.stdout.write(`${name}: ${state}\n`);
}
let failed = false;
const fail = label => { failed = true; process.stdout.write(`${label}: FAIL\n`); };
for (const file of localFiles) {
  if (!existsSync(resolve(root, file))) continue;
  try { execFileSync(git, ['check-ignore', '-q', file], { cwd: root, stdio: 'pipe' }); }
  catch { fail(`Ignored local configuration (${file})`); }
}
const files = execFileSync(git, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const historicalNames = execFileSync(git, ['log', '--all', '--format=', '--name-only', '--', '.env', ':(glob)**/.env*'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
if (historicalNames.some(file => /(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example'))) fail('Historical environment filenames');
const walk = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(resolve(dir, item.name)) : [resolve(dir, item.name)]) : [];
const bundle = walk(resolve(root, 'client/dist'));
if (!bundle.length) fail('Browser bundle missing (run npm run build first)');
const patterns = [/sk-(?:proj-)?[A-Za-z0-9_-]{32,}/, /AAPK[A-Za-z0-9_-]{40,}/, /postgres(?:ql)?:\/\/[^\s:'"<>]+:([^\s@'"<>]+)@/];
for (const path of new Set([...files.map(file => resolve(root, file)), ...bundle])) {
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  if ([...secrets].some(secret => text.includes(secret))) fail(`Server secret match (${relative(root, path)})`);
  // The browser basemap credential is the sole intentional public credential.
  const publicKey = values['client/.env.local'].VITE_ARCGIS_API_KEY;
  let scan = publicKey && bundle.includes(path) ? text.replaceAll(publicKey, '') : text;
  // This exact checked-in canary exercises database-target rejection; it is not a credential.
  if (relative(root, path) === 'tests/config.test.ts') scan = scan.replaceAll('ppi_app:secret@', 'ppi_app:<synthetic>@');
  if (!path.endsWith('.env.example') && patterns.some(pattern => pattern.test(scan))) fail(`Credential pattern (${relative(root, path)})`);
  if (path.endsWith('.env.example')) {
    const template = parseEnv(text);
    if (names.some(name => template[name] && !placeholder(template[name]))) fail(`Template credential (${relative(root, path)})`);
  }
}
for (const name of Object.keys(values['client/.env.local'])) {
  if (name.startsWith('VITE_') && !['VITE_ARCGIS_API_KEY', 'VITE_API_BASE_URL'].includes(name)) fail('Unexpected browser configuration name');
}
if (values['client/.env.local'].VITE_API_BASE_URL && !/^(?:\/api|https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/api)\/?$/.test(values['client/.env.local'].VITE_API_BASE_URL)) fail('VITE_API_BASE_URL INVALID FORMAT');
process.stdout.write(`Repository, local-env ignore rules, templates and browser bundle audit: ${failed ? 'FAIL' : 'PASS'}\n`);
process.exitCode = failed ? 1 : 0;
