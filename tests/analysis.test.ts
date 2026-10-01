import { describe, expect, it, vi } from 'vitest';
import { calculatePricing, type AnalysisRun, type PricingInput, type PricingPreviewRequest } from '@ppi/shared';
import { compactExplanationInput, ExplanationFailure, validateExplanation, type ExplanationModel } from '../server/src/analysis/explanation.js';
import { analysisHash, AnalysisService } from '../server/src/analysis/service.js';
import type { AnalysisRepository, NewRun } from '../server/src/analysis/repository.js';
import type { PricingPreviewService } from '../server/src/pricing/service.js';

const propertyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const asOf = '2026-09-29T00:00:00.000Z';
const sale = (n: number, price: number, distance = n / 2) => ({ id: `sale:${n}`, providerId: `provider:${n}`, address: `${n} Main St`,
  evidenceType: 'RECORDED_SALE' as const, propertyType: 'Condo', price,
  eventDate: new Date(Date.parse(asOf) - (n + 1) * 30 * 86_400_000).toISOString(),
  distanceMiles: distance, livingAreaSqft: 1000, bedrooms: 2, bathrooms: 2 });
const fixture = (): PricingInput => ({
  subject: { id: propertyId, propertyType: 'Condo', livingAreaSqft: 1000, bedrooms: 2, bathrooms: 2, currentListPrice: null, overrideFields: [] },
  recordedSales: [sale(0, 200000), sale(1, 220000), sale(2, 240000), sale(3, 2000000, 1.9)],
  activeListings: [{ id: 'ask:1', evidenceType: 'ACTIVE_ASKING_PRICE', price: 225000, distanceMiles: 0.5 }],
  mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: null, asOf,
  metadata: { propertyFreshness: 'FRESH', salesFreshness: 'FRESH', listingsFreshness: 'FRESH',
    propertyFetchedAt: asOf, salesFetchedAt: asOf, listingsFetchedAt: asOf,
    salesSource: 'RENTCAST', listingsSource: 'RENTCAST', searchRadiusMiles: 2, saleDateRangeDays: 365 }
});
const valid = { summary: 'The recorded sales support the engine range.', reasons: [{ claim: 'Three included sales support the reference.', evidenceIds: ['ENGINE', 'sale:0'] }],
  strategySteps: ['Review the range.'], assumptions: [], unknowns: [], warnings: [] };

class MemoryRepository implements AnalysisRepository {
  runs: AnalysisRun[] = [];
  async claim(input: NewRun, force: boolean) {
    const old = this.runs.find(run => run.status === 'RUNNING' && run.propertyId === input.propertyId && run.mode === input.mode && run.inputHash === input.inputHash)
      ?? this.runs.find(run => run.id === input.requestKey)
      ?? (!force ? this.runs.find(run => run.status === 'SUCCEEDED' && run.propertyId === input.propertyId && run.mode === input.mode && run.inputHash === input.inputHash) : undefined);
    if (old) return { run: old, claimed: false };
    const run: AnalysisRun = { ...input, id: input.requestKey, status: 'RUNNING', aiResult: null,
      createdAt: asOf, completedAt: null, failureCode: null, tokenUsage: null, latencyMs: null };
    this.runs.unshift(run);
    return { run, claimed: true };
  }
  async get(id: string) { return this.runs.find(run => run.id === id) ?? null; }
  async list(id: string) { const items = this.runs.filter(run => run.propertyId === id); return { items, total: items.length }; }
  async listSummaries(id: string, page: number, pageSize: number) {
    const { items, total } = await this.list(id);
    const summaries = items.map(run => ({ ...run,
      suggestedPrice: (run.mode === 'OFFER' ? run.engineResult.offerResult : run.engineResult.listingResult)?.suggestedPrice ?? null }));
    return { items: summaries.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize,
      latestOffer: summaries.find(item => item.mode === 'OFFER') ?? null, latestListing: summaries.find(item => item.mode === 'LISTING') ?? null };
  }
  async finish(id: string, update: { status: 'SUCCEEDED' | 'FAILED'; aiResult: AnalysisRun['aiResult']; failureCode: string | null; tokenUsage: AnalysisRun['tokenUsage']; latencyMs: number }) {
    const run = this.runs.find(item => item.id === id)!;
    Object.assign(run, update, { completedAt: asOf });
    return run;
  }
}

describe('structured explanation validation', () => {
  const input = compactExplanationInput(fixture(), calculatePricing(fixture()));
  it('accepts supplied evidence and strips display markup', () => {
    expect(validateExplanation({ ...valid, summary: '<b>Recorded sales</b> support the range.' }, input).summary).toBe('Recorded sales support the range.');
    expect(input.evidence.find(item => item.id === 'sale:3')?.kind).toBe('EXCLUDED_SALE');
  });
  it('rejects malformed output, unknown evidence, invented prices, and unsupported facts', () => {
    const reject = (value: unknown, code: string) => expect(() => validateExplanation(value, input)).toThrowError(new ExplanationFailure(code));
    reject({ summary: 'missing arrays' }, 'MODEL_PARSE_FAILED');
    reject({ ...valid, reasons: [{ claim: 'Invented.', evidenceIds: ['sale:absent'] }] }, 'INVALID_EVIDENCE_REFERENCE');
    reject({ ...valid, summary: 'Offer $999,999.' }, 'NUMERIC_PRICE_MISMATCH');
    reject({ ...valid, summary: 'This home is assigned to West School.' }, 'UNSUPPORTED_CLAIM');
    reject({ ...valid, reasons: [{ claim: 'The active listing sold for $225,000.', evidenceIds: ['ask:1'] }] }, 'UNSUPPORTED_CLAIM');
    reject({ ...valid, summary: 'The active listing sold at 225000.' }, 'UNSUPPORTED_CLAIM');
    reject({ ...valid, summary: 'The excluded outlier was used in the reference price.' }, 'UNSUPPORTED_CLAIM');
    reject({ ...valid, summary: 'The wildfire zone is low risk.' }, 'UNSUPPORTED_CLAIM');
  });
  it('contains no live Places payload or owner data', () => {
    const source = { ...fixture(), grocery: [{ name: 'DO_NOT_SEND_PLACES' }], ownerName: 'DO_NOT_SEND_OWNER' };
    const payload = JSON.stringify(compactExplanationInput(source, calculatePricing(source)));
    expect(payload).not.toContain('DO_NOT_SEND_PLACES');
    expect(payload).not.toContain('DO_NOT_SEND_OWNER');
  });
  it('validates sanitized text, exact GIS disclaimer, price labels, shorthand and cited prices', () => {
    for (const summary of ['The sch<b></b>ool is excellent.', 'No school or hazard adjustments were applied. The school is excellent.']) {
      expect(() => validateExplanation({ ...valid, summary }, input)).toThrow('UNSUPPORTED_CLAIM');
    }
    for (const summary of ['Reference price is $225,000.', 'Suggested offer is $240,000.', 'Offer $210k.']) {
      expect(() => validateExplanation({ ...valid, summary }, input)).toThrow('NUMERIC_PRICE_MISMATCH');
    }
    expect(() => validateExplanation({ ...valid, reasons: [{ claim: 'The recorded sale was $220,000.', evidenceIds: ['sale:0'] }] }, input)).toThrow('NUMERIC_PRICE_MISMATCH');
    expect(validateExplanation({ ...valid, summary: 'Reference price is $220,000.', reasons: [{ claim: 'The outlier was not included.', evidenceIds: ['sale:3'] }] }, input).summary).toContain('$220,000');
  });
  it('retains evidence IDs at the maximum provider result limits', () => {
    const large = fixture();
    large.activeListings = Array.from({ length: 100 }, (_, n) => ({ id: `ask:${n}`, evidenceType: 'ACTIVE_ASKING_PRICE', price: 225000, distanceMiles: 1 }));
    large.recordedSales = Array.from({ length: 100 }, (_, n) => sale(n, 200000));
    const compact = compactExplanationInput(large, calculatePricing(large));
    expect(compact.evidence).toHaveLength(200);
    expect(compact.evidence.some(item => item.id === 'ask:99')).toBe(true);
  });
  it('requires exact singular prices and exact endpoints for explicitly labeled ranges', () => {
    for (const summary of [
      'Reference price is $200,000.', 'Suggested offer is $205,000.', '$205,000 is the suggested offer.',
      'The recommended offer range is $205,000 to $210,000.',
      'Reference price is $200,000, with a reference range of $200,000 to $220,000.'
    ]) expect(() => validateExplanation({ ...valid, summary }, input)).toThrow('NUMERIC_PRICE_MISMATCH');
    for (const summary of [
      'Reference price is $220,000.', 'The market reference range is $200,000 to $220,000.',
      'Suggested offer is $210,000.', 'The recommended offer range is $205,000 to $215,000.',
      'Reference price is $220,000, with a reference range of $200,000 to $220,000.',
      'Suggested offer is $210,000, with a recommended range of $205,000 to $215,000.'
    ]) expect(validateExplanation({ ...valid, summary }, input).summary).toBe(summary);
    const listing = { ...fixture(), mode: 'LISTING' as const };
    const listingInput = compactExplanationInput(listing, calculatePricing(listing));
    expect(() => validateExplanation({ ...valid, summary: 'Suggested listing price is $205,000.' }, listingInput)).toThrow('NUMERIC_PRICE_MISMATCH');
    expect(validateExplanation({ ...valid, summary: 'Suggested listing price is $210,000.' }, listingInput).summary).toContain('$210,000');
  });
  it('hashes the actual engine result so a corrected calculation cannot reuse an older result', () => {
    const source = fixture(); const engine = calculatePricing(source);
    expect(analysisHash(source, engine, 'model')).not.toBe(analysisHash(source, { ...engine, referencePrice: 230000 }, 'model'));
  });
});

describe('saved analysis generation', () => {
  const request: PricingPreviewRequest = { mode: 'OFFER', strategyProfile: 'BALANCED', maxBudget: null };
  const setup = (model: ExplanationModel = { generate: vi.fn().mockResolvedValue({ output: valid, usage: { inputTokens: 42, outputTokens: 24 } }) }) => {
    let current = fixture();
    const pricing = { prepareInput: vi.fn(async () => structuredClone(current)) } as unknown as PricingPreviewService;
    const repository = new MemoryRepository();
    const service = new AnalysisService(pricing, repository, model, 'gpt-5.6-luna', 'low');
    return { service, repository, model, change: (next: PricingInput) => { current = next; } };
  };
  it('saves success, reuses identical input, and creates a version after evidence changes', async () => {
    const { service, repository, model, change } = setup();
    const first = await service.create(propertyId, request, '11111111-1111-4111-8111-111111111111');
    expect(first.status).toBe('SUCCEEDED');
    expect(first.engineResult.referencePrice).toBe(220000);
    expect(first.aiResult?.reasons[0]?.evidenceIds).toContain('sale:0');
    const reopened = await service.create(propertyId, request, '22222222-2222-4222-8222-222222222222');
    expect(reopened.id).toBe(first.id);
    expect(model.generate).toHaveBeenCalledTimes(1);
    const changed = fixture(); changed.recordedSales[0]!.price = 210000; change(changed);
    const second = await service.create(propertyId, request, '33333333-3333-4333-8333-333333333333');
    expect(second.id).not.toBe(first.id);
    expect(repository.runs).toHaveLength(2);
    expect((await service.get(first.id)).inputSnapshot).toEqual(first.inputSnapshot);
    expect((await service.get(first.id)).engineResult).toEqual(first.engineResult);
  });
  it('coalesces a duplicate in-flight click and makes explicit regeneration a new version', async () => {
    let release!: (value: { output: typeof valid; usage: null }) => void;
    const model = { generate: vi.fn().mockImplementation(() => new Promise(resolve => { release = resolve; })) };
    const { service, repository } = setup(model);
    const first = service.create(propertyId, request, '44444444-4444-4444-8444-444444444444');
    await vi.waitFor(() => expect(model.generate).toHaveBeenCalledTimes(1));
    const duplicate = await service.create(propertyId, request, '55555555-5555-4555-8555-555555555555');
    expect(duplicate.status).toBe('RUNNING');
    expect(repository.runs).toHaveLength(1);
    release({ output: valid, usage: null }); await first;
    const renewed = service.regenerate(duplicate.id, '66666666-6666-4666-8666-666666666666');
    await vi.waitFor(() => expect(model.generate).toHaveBeenCalledTimes(2));
    release({ output: valid, usage: null });
    expect((await renewed).id).not.toBe(duplicate.id);
  });
  it.each([
    ['MODEL_REFUSAL', new ExplanationFailure('MODEL_REFUSAL')],
    ['MODEL_TIMEOUT', new ExplanationFailure('MODEL_TIMEOUT')],
    ['MODEL_PARSE_FAILED', new ExplanationFailure('MODEL_PARSE_FAILED')]
  ])('preserves engine price after %s', async (code, error) => {
    const { service } = setup({ generate: vi.fn().mockRejectedValue(error) });
    const run = await service.create(propertyId, request);
    expect(run.status).toBe('FAILED');
    expect(run.failureCode).toBe(code);
    expect(run.engineResult.offerResult?.suggestedPrice).toBe(210000);
    expect(run.aiResult).toBeNull();
  });
  it('keeps metered usage when the returned explanation fails validation', async () => {
    const { service } = setup({ generate: vi.fn().mockResolvedValue({ output: { ...valid, summary: 'Offer $999,999.' }, usage: { inputTokens: 42, outputTokens: 24 } }) });
    const run = await service.create(propertyId, request);
    expect(run.failureCode).toBe('NUMERIC_PRICE_MISMATCH');
    expect(run.tokenUsage).toEqual({ inputTokens: 42, outputTokens: 24 });
  });
});
