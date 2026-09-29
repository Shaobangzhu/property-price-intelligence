import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../server/src/config/env.js';
import { RequestBudget } from '../scripts/smoke/budget.js';
import { inspectCategories, inspectList, inspectPlaces, inspectSchools, selectProperty } from '../scripts/smoke/normalize.js';
import { checkOpenAI, inspectOpenAI } from '../scripts/smoke/openai.js';
import { runSmoke } from '../scripts/smoke/runner.js';

const address = '1 Synthetic Avenue, Testville, CA 90000';
const config = (extra: Record<string, string> = {}) => parseConfig({ ...extra });
describe('provider smoke safety', () => {
  it('makes exactly zero requests in dry mode', async () => {
    const transport = vi.fn(); const openaiTransport = vi.fn();
    const result = await runSmoke(config({ ALLOW_LIVE_API_TESTS: 'true', RENTCAST_API_KEY: 'synthetic', OPENAI_API_KEY: 'synthetic', SMOKE_TEST_ADDRESS: address }), { live: false, browserKeyConfigured: false, transport, openaiTransport });
    expect(result.requests.total).toBe(0); expect(transport).not.toHaveBeenCalled(); expect(openaiTransport).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('synthetic');
  });
  it('requires both live gates', async () => {
    await expect(runSmoke(config(), { live: true, browserKeyConfigured: false })).rejects.toThrow('ALLOW_LIVE_API_TESTS');
  });
  it('enforces each cap and counts failed attempts', async () => {
    const budget = new RequestBudget(); const call = vi.fn().mockRejectedValue(new Error('synthetic'));
    await expect(budget.attempt('property', call)).rejects.toThrow();
    await expect(budget.attempt('property', call)).rejects.toThrow('budget');
    expect(call).toHaveBeenCalledTimes(1); expect(budget.snapshot().total).toBe(1);
    for (const operation of ['recordedSales', 'activeListings', 'categories', 'places', 'openai'] as const) await budget.attempt(operation, async () => true);
    await expect(budget.attempt('property', async () => true)).rejects.toThrow('budget');
    expect(budget.snapshot().total).toBe(6);
  });
  it('does not retry failed network calls', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('synthetic'));
    const result = await runSmoke(config({ ALLOW_LIVE_API_TESTS: 'true', RENTCAST_API_KEY: 'synthetic', SMOKE_TEST_ADDRESS: address }), { live: true, browserKeyConfigured: false, transport });
    expect(transport).toHaveBeenCalledTimes(1); expect(result.requests.total).toBe(1);
  });
  it('rejects empty, malformed, unmatched, and ambiguous property records', () => {
    expect(selectProperty([], address)).toEqual({ error: 'empty' });
    expect(selectProperty({}, address)).toEqual({ error: 'malformed' });
    expect(selectProperty([{ formattedAddress: 'different' }], address)).toEqual({ error: 'no_match' });
    const item = { formattedAddress: address, owner: { names: ['SYNTHETIC_CANARY'] } };
    expect(selectProperty([item, item], address)).toEqual({ error: 'ambiguous' });
    expect(JSON.stringify(selectProperty([item], address))).not.toContain('SYNTHETIC_CANARY');
  });
  it('distinguishes school field states without proving assignment', () => {
    expect(inspectSchools({})).toBe('MISSING');
    expect(inspectSchools({ nearbySchools: [] })).toBe('UNVERIFIED');
    expect(inspectSchools({ assignedSchools: [] })).toBe('VERIFIED_STRUCTURE');
  });
  it('rejects malformed listing, category, and Places shapes', () => {
    expect(inspectList({ records: [] }, 'price')).toBeNull();
    expect(inspectCategories({ categories: [{ label: 'Grocery Store', categoryId: 'bad' }] })).toBeNull();
    expect(inspectPlaces({ results: [null] })).toBeNull();
  });
  it('classifies OpenAI success, refusal, incomplete, and malformed output', () => {
    expect(inspectOpenAI({ status: 'completed', output_text: '{"ok":true,"label":"synthetic"}' }).status).toBe('SUCCESS');
    expect(inspectOpenAI({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }).status).toBe('REFUSAL');
    expect(inspectOpenAI({ status: 'incomplete' }).status).toBe('INCOMPLETE');
    expect(inspectOpenAI({ status: 'completed', output_text: 'invalid' }).status).toBe('MALFORMED');
  });
  it('classifies OpenAI transport errors without retries or raw error text', async () => {
    const transport = vi.fn().mockRejectedValue(Object.assign(new Error('CANARY_SECRET'), { status: 401 }));
    const result = await checkOpenAI(config({ OPENAI_API_KEY: 'synthetic' }), new RequestBudget(), transport);
    expect(result).toMatchObject({ status: 'ERROR', note: 'AUTHENTICATION', httpStatus: 401 });
    expect(JSON.stringify(result)).not.toContain('CANARY_SECRET');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
