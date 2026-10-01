import { describe, expect, it } from 'vitest';
import { parseConfig, parseServerConfig, assertLocalDatabase } from '../server/src/config/env.js';

describe('configuration', () => {
  it('accepts both loopback spellings only on configured ports without changing the configured value', () => {
    const values = { ALLOWED_ORIGINS: 'http://localhost:5173' };
    expect(parseServerConfig(values).origins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(parseServerConfig(values).ALLOWED_ORIGINS).toBe(values.ALLOWED_ORIGINS);
    expect(values).toEqual({ ALLOWED_ORIGINS: 'http://localhost:5173' });
    expect(parseConfig({ ALLOWED_ORIGINS: 'http://127.0.0.1:5173' }).origins).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
    expect(parseServerConfig({ ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173' }).origins).toHaveLength(2);
    expect(parseServerConfig({ ALLOWED_ORIGINS: 'http://localhost:4173' }).origins).toEqual(['http://localhost:4173', 'http://127.0.0.1:4173']);
    expect(parseServerConfig({}).origins).not.toContain('http://localhost:5174');
  });
  it('parses false and true explicitly', () => {
    expect(parseConfig({ ALLOW_LIVE_API_TESTS: 'false' }).ALLOW_LIVE_API_TESTS).toBe(false);
    expect(parseConfig({ ALLOW_LIVE_API_TESTS: 'true' }).ALLOW_LIVE_API_TESTS).toBe(true);
    expect(() => parseConfig({ ALLOW_LIVE_API_TESTS: 'yes' })).toThrow('ALLOW_LIVE_API_TESTS');
  });
  it('does not validate unused provider settings at server startup', () => {
    expect(parseServerConfig({ SMOKE_TEST_LATITUDE: 'bad', SMOKE_GROCERY_CATEGORY_ID: 'bad' }).PORT).toBe(3001);
    expect(() => parseServerConfig({ OPENAI_REASONING_EFFORT: 'invalid' })).toThrow('OPENAI_REASONING_EFFORT');
    expect(() => parseConfig({ OPENAI_REASONING_EFFORT: 'invalid' })).toThrow('OPENAI_REASONING_EFFORT');
  });
  it('redacts invalid values', () => {
    const canary = 'CANARY_SECRET_123';
    expect(() => parseConfig({ DATABASE_URL: canary })).toThrow('DATABASE_URL');
    try { parseConfig({ DATABASE_URL: canary }); } catch (error) { expect(String(error)).not.toContain(canary); }
    expect(() => parseConfig({ ALLOWED_ORIGINS: 'javascript:bad' })).toThrow('ALLOWED_ORIGINS');
    expect(() => parseConfig({ ALLOWED_ORIGINS: 'https://remote.example' })).toThrow('ALLOWED_ORIGINS');
    expect(() => parseConfig({ ALLOWED_ORIGINS: 'http://localhost.untrusted.example:5173' })).toThrow('ALLOWED_ORIGINS');
    expect(() => parseConfig({ ALLOWED_ORIGINS: 'null' })).toThrow('ALLOWED_ORIGINS');
    expect(() => parseConfig({ SMOKE_TEST_LATITUDE: '91', SMOKE_TEST_LONGITUDE: '1' })).toThrow('SMOKE_TEST_LATITUDE');
    expect(() => parseConfig({ PORT: '70000' })).toThrow('PORT');
  });
  it('guards the dedicated local database', () => {
    expect(() => assertLocalDatabase('postgresql://ppi_app:secret@127.0.0.1:55435/property_price_intelligence')).not.toThrow();
    expect(() => assertLocalDatabase('postgresql://ppi_app:secret@remote.example:55435/property_price_intelligence')).toThrow();
    expect(() => assertLocalDatabase('postgresql://ppi_app:secret@127.0.0.1:55435/other')).toThrow();
  });
});
