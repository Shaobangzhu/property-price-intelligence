import { createHash, randomUUID } from 'node:crypto';
import { AnalysisRun, calculatePricing, PricingPreviewResponse, type PricingInput, type PricingPreviewRequest } from '@ppi/shared';
import type { PricingPreviewService } from '../pricing/service.js';
import { PropertyError } from '../properties/service.js';
import { compactExplanationInput, ExplanationFailure, PROMPT_VERSION, validateExplanation, type ExplanationModel } from './explanation.js';
import type { AnalysisRepository, NewRun } from './repository.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function analysisHash(input: PricingInput, model: string, effort = 'low'): string {
  return createHash('sha256').update(stable({ input, model, effort, promptVersion: PROMPT_VERSION,
    engineVersion: 'ppi-pricing-v1' })).digest('hex');
}

export class AnalysisService {
  constructor(private readonly pricing: PricingPreviewService, private readonly repository: AnalysisRepository,
    private readonly explanation: ExplanationModel, private readonly model: string, private readonly effort: string) {}

  async create(propertyId: string, request: PricingPreviewRequest, requestKey: string = randomUUID()) {
    const input = await this.pricing.prepareInput(propertyId, request);
    // The engine compares sale ages by whole UTC days. Pinning this date makes identical requests reusable for the day.
    input.asOf = `${input.asOf.slice(0, 10)}T00:00:00.000Z`;
    const engine = PricingPreviewResponse.parse(calculatePricing(input));
    return this.run({ propertyId, mode: request.mode, strategyProfile: request.strategyProfile,
      engineVersion: engine.engineVersion, promptVersion: PROMPT_VERSION, model: this.model, reasoningEffort: this.effort,
      userInputs: request, inputSnapshot: input, engineResult: engine, inputHash: analysisHash(input, this.model, this.effort), requestKey }, false);
  }

  async regenerate(id: string, requestKey: string) {
    const original = await this.get(id);
    const input = original.inputSnapshot as PricingInput;
    // This is a new explanation over the exact historical input and deterministic result.
    return this.run({ propertyId: original.propertyId, mode: original.mode, strategyProfile: original.strategyProfile,
      engineVersion: original.engineVersion, promptVersion: PROMPT_VERSION, model: this.model, reasoningEffort: this.effort,
      userInputs: original.userInputs, inputSnapshot: input, engineResult: original.engineResult,
      inputHash: analysisHash(input, this.model, this.effort), requestKey }, true);
  }

  async get(id: string): Promise<AnalysisRun> {
    const run = await this.repository.get(id);
    if (!run) throw new PropertyError('ANALYSIS_NOT_FOUND', 404);
    return run;
  }

  async list(propertyId: string) { return this.repository.list(propertyId); }

  private async run(input: NewRun, force: boolean): Promise<AnalysisRun> {
    const { run, claimed } = await this.repository.claim(input, force);
    if (!claimed) return run;
    const start = Date.now();
    try {
      const compact = compactExplanationInput(input.inputSnapshot as PricingInput, input.engineResult);
      const response = await this.explanation.generate(compact);
      const aiResult = validateExplanation(response.output, compact);
      return this.repository.finish(run.id, { status: 'SUCCEEDED', aiResult, failureCode: null,
        tokenUsage: response.usage, latencyMs: Date.now() - start });
    } catch (error) {
      const failureCode = error instanceof ExplanationFailure ? error.code : 'MODEL_UNAVAILABLE';
      return this.repository.finish(run.id, { status: 'FAILED', aiResult: null, failureCode,
        tokenUsage: null, latencyMs: Date.now() - start });
    }
  }
}
