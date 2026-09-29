import OpenAI from 'openai';
import { z } from 'zod';
import type { AppConfig } from '../../server/src/config/env.js';
import type { RequestBudget } from './budget.js';

const outputSchema = z.object({ ok: z.boolean(), label: z.string().max(40) });
export function inspectOpenAI(value: unknown): { status: 'SUCCESS' | 'REFUSAL' | 'INCOMPLETE' | 'MALFORMED'; usage?: { inputTokens: number; outputTokens: number } } {
  if (!value || typeof value !== 'object') return { status: 'MALFORMED' };
  const response = value as { status?: string; output_text?: string; output?: Array<{ content?: Array<{ type?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const usage = typeof response.usage?.input_tokens === 'number' && typeof response.usage?.output_tokens === 'number' ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined;
  if (response.output?.some(item => item.content?.some(part => part.type === 'refusal'))) return { status: 'REFUSAL', usage };
  if (response.status === 'incomplete') return { status: 'INCOMPLETE', usage };
  if (response.status !== 'completed' || typeof response.output_text !== 'string') return { status: 'MALFORMED', usage };
  try { return { status: outputSchema.safeParse(JSON.parse(response.output_text)).success ? 'SUCCESS' : 'MALFORMED', usage }; } catch { return { status: 'MALFORMED', usage }; }
}
export async function checkOpenAI(config: AppConfig, budget: RequestBudget, transport?: (options: { model: string; effort: AppConfig['OPENAI_REASONING_EFFORT'] }) => Promise<unknown>) {
  if (!config.OPENAI_API_KEY) return { status: 'SKIPPED' as const, note: 'key missing' };
  const execute = transport ?? (async () => {
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: 0, timeout: 8000, fetch: (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== 'https://api.openai.com' || url.pathname !== '/v1/responses') throw new Error('Unexpected SDK destination');
      return budget.attempt('openai', () => fetch(input, { ...init, redirect: 'error' }));
    } });
    return client.responses.create({ model: config.OPENAI_MODEL, reasoning: { effort: config.OPENAI_REASONING_EFFORT }, input: 'Return ok=true and label="synthetic". This is a synthetic capability check.', max_output_tokens: 800, store: false, text: { format: { type: 'json_schema', name: 'smoke_check', strict: true, schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, label: { type: 'string' } }, required: ['ok', 'label'] } } } }, { signal: AbortSignal.timeout(8000) });
  });
  try { const response = transport ? await budget.attempt('openai', () => execute({ model: config.OPENAI_MODEL, effort: config.OPENAI_REASONING_EFFORT })) : await execute({ model: config.OPENAI_MODEL, effort: config.OPENAI_REASONING_EFFORT }); const result = inspectOpenAI(response); return { status: result.status === 'SUCCESS' ? 'SUCCESS' as const : 'ERROR' as const, note: result.status, usage: result.usage }; }
  catch (error) { const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number' ? error.status : undefined; return { status: 'ERROR' as const, note: status === 401 ? 'AUTHENTICATION' : status === 403 ? 'PERMISSION' : status === 429 ? 'RATE_LIMIT' : status === 400 ? 'UNSUPPORTED_CONFIGURATION' : error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'REQUEST_FAILED', httpStatus: status }; }
}
