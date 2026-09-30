import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const serverEnvPath = resolve(import.meta.dirname, '../../.env');
export function loadServerEnv(target: NodeJS.ProcessEnv = process.env, path = serverEnvPath): NodeJS.ProcessEnv {
  if (existsSync(path)) {
    const parsed = parseEnv(readFileSync(path, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) if (target[key] === undefined) target[key] = value;
  }
  return target;
}

const port = z.coerce.number().int().min(1).max(65535);
const optional = z.string().trim().optional().default('');
const coordinates = z.string().trim().optional().default('');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),
  PORT: port.default(3001),
  DATABASE_URL: optional,
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  RENTCAST_API_KEY: optional, ARCGIS_PLACES_API_KEY: optional, OPENAI_API_KEY: optional,
  OPENAI_MODEL: z.string().trim().min(1).default('gpt-6-luna'),
  OPENAI_REASONING_EFFORT: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  ALLOW_LIVE_API_TESTS: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  SMOKE_TEST_ADDRESS: optional, SMOKE_TEST_LATITUDE: coordinates, SMOKE_TEST_LONGITUDE: coordinates, SMOKE_GROCERY_CATEGORY_ID: optional
});
export type AppConfig = z.infer<typeof schema> & { origins: string[]; smokeCoordinates: { latitude: number; longitude: number } | null };
export type ServerConfig = Pick<AppConfig, 'NODE_ENV' | 'HOST' | 'PORT' | 'DATABASE_URL' | 'ALLOWED_ORIGINS' | 'RENTCAST_API_KEY' | 'ARCGIS_PLACES_API_KEY' | 'origins'>;

function validateBase(data: Pick<AppConfig, 'ALLOWED_ORIGINS' | 'DATABASE_URL'>): string[] {
  const origins = data.ALLOWED_ORIGINS.split(',').map(v => v.trim());
  if (!origins.length || origins.some(origin => { try { const url = new URL(origin); return url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.origin !== origin; } catch { return true; } })) throw new Error('Invalid configuration: ALLOWED_ORIGINS');
  if (data.DATABASE_URL) assertLocalDatabase(data.DATABASE_URL);
  return origins;
}

export function parseServerConfig(values: NodeJS.ProcessEnv): ServerConfig {
  const result = schema.pick({ NODE_ENV: true, HOST: true, PORT: true, DATABASE_URL: true, ALLOWED_ORIGINS: true, RENTCAST_API_KEY: true, ARCGIS_PLACES_API_KEY: true }).safeParse(values);
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  return { ...result.data, origins: validateBase(result.data) };
}

export function parseConfig(values: NodeJS.ProcessEnv): AppConfig {
  const result = schema.safeParse(values);
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const data = result.data;
  const origins = validateBase(data);
  let smokeCoordinates: AppConfig['smokeCoordinates'] = null;
  if (data.SMOKE_TEST_LATITUDE || data.SMOKE_TEST_LONGITUDE) {
    const latitude = Number(data.SMOKE_TEST_LATITUDE), longitude = Number(data.SMOKE_TEST_LONGITUDE);
    if (!data.SMOKE_TEST_LATITUDE || !data.SMOKE_TEST_LONGITUDE || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('Invalid configuration: SMOKE_TEST_LATITUDE, SMOKE_TEST_LONGITUDE');
    smokeCoordinates = { latitude, longitude };
  }
  if (data.SMOKE_GROCERY_CATEGORY_ID && !/^[a-f0-9]{24}$/i.test(data.SMOKE_GROCERY_CATEGORY_ID)) throw new Error('Invalid configuration: SMOKE_GROCERY_CATEGORY_ID');
  return { ...data, origins, smokeCoordinates };
}

export function assertLocalDatabase(connection: string): void {
  try {
    const url = new URL(connection);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/property_price_intelligence' || url.port !== '55435' || url.username !== 'ppi_app') throw new Error();
  } catch { throw new Error('Invalid configuration: DATABASE_URL must target dedicated local PPI database'); }
}
