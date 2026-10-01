import { describe, expect, it, vi } from 'vitest';
import { calculatePricing } from '@ppi/shared';
import { evaluationFixtures } from '../scripts/eval/fixtures.js';
import { compactExplanationInput, ExplanationFailure, OpenAIExplanationModel } from '../server/src/analysis/explanation.js';

const fixture = evaluationFixtures[0].input;
const input = compactExplanationInput(fixture, calculatePricing(fixture));
const explanation = { summary: 'Recorded sales support the reference.', reasons: [{ claim: 'The engine uses recorded sales.', evidenceIds: ['ENGINE'] }],
  strategySteps: [], assumptions: [], unknowns: [], warnings: [] };
const usage = { input_tokens: 42, output_tokens: 24, total_tokens: 66, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 4 } };
const outputMessage = (text: string) => ({ type: 'message', id: 'msg_synthetic', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }] });
const response = (overrides: Record<string, unknown> = {}) => ({ id: 'resp_synthetic', object: 'response', created_at: 0,
  status: 'completed', output: [outputMessage(JSON.stringify(explanation))], usage, ...overrides });
const model = () => new OpenAIExplanationModel('synthetic-test-key', 'gpt-5.6-luna', 'low');

describe('OpenAI Responses adapter with an offline transport', () => {
  it('sends bounded strict Structured Outputs and returns the parsed explanation and metered usage', async () => {
    const transport = vi.fn(async () => Response.json(response()));
    vi.stubGlobal('fetch', transport);
    const result = await model().generate(input);
    expect(result).toEqual({ output: explanation, usage: { inputTokens: 42, outputTokens: 24 } });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(options.body));
    expect(body).toMatchObject({ model: 'gpt-5.6-luna', reasoning: { effort: 'low' }, store: false, max_output_tokens: 1400,
      text: { format: { type: 'json_schema', strict: true, name: 'ppi_pricing_explanation', schema: { additionalProperties: false } } } });
    expect(JSON.parse(body.input)).toEqual(input);
  });

  it.each([
    ['MODEL_REFUSAL', { output: [{ type: 'message', id: 'msg_synthetic', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'Declined.' }] }] }],
    ['MODEL_INCOMPLETE', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }],
    ['MODEL_INCOMPLETE', { output: [] }],
    ['MODEL_PARSE_FAILED', { output: [outputMessage('{invalid JSON')] }]
  ])('classifies %s and preserves returned token usage', async (code, overrides) => {
    const transport = vi.fn(async () => Response.json(response(overrides)));
    vi.stubGlobal('fetch', transport);
    await expect(model().generate(input)).rejects.toMatchObject({ code, usage: { inputTokens: 42, outputTokens: 24 } });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([[401, 'MODEL_AUTH_FAILED'], [429, 'MODEL_RATE_LIMIT'], [400, 'MODEL_UNAVAILABLE'], [404, 'MODEL_UNAVAILABLE'], [500, 'MODEL_UNAVAILABLE']])(
    'maps HTTP %s to %s without retry or remote error disclosure', async (status, code) => {
      const transport = vi.fn(async () => Response.json({ error: { message: 'REMOTE_ERROR_CANARY', type: 'api_error' } }, { status: Number(status) }));
      vi.stubGlobal('fetch', transport);
      const error = await model().generate(input).catch(value => value);
      expect(error).toBeInstanceOf(ExplanationFailure);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('REMOTE_ERROR_CANARY');
      expect(transport).toHaveBeenCalledTimes(1);
    }
  );

  it('reports missing configuration without making a request', async () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    await expect(new OpenAIExplanationModel('', 'gpt-5.6-luna', 'low').generate(input)).rejects.toMatchObject({ code: 'OPENAI_KEY_MISSING' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('classifies network failure without retry', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('REMOTE_NETWORK_CANARY'));
    vi.stubGlobal('fetch', transport);
    await expect(model().generate(input)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', message: 'MODEL_UNAVAILABLE' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('aborts at the configured timeout without retry', async () => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }));
      vi.stubGlobal('fetch', transport);
      const result = expect(model().generate(input)).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(12_001);
      await result;
      expect(transport).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
