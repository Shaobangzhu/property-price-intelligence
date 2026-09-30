import { calculatePricing } from '@ppi/shared';
import { loadServerEnv, parseServerConfig } from '../../server/src/config/env.js';
import { compactExplanationInput, OpenAIExplanationModel, validateExplanation } from '../../server/src/analysis/explanation.js';
import { evaluationFixtures } from './fixtures.js';

loadServerEnv();
if (!process.argv.includes('--live') || process.env.ALLOW_LIVE_API_TESTS !== 'true') {
  process.stdout.write('ALLOW_LIVE_API_TESTS: MISSING\n');
  process.exit(1);
}
const config = parseServerConfig(process.env);
if (!config.OPENAI_API_KEY) {
  process.stdout.write('OPENAI_API_KEY: MISSING\n');
  process.exit(1);
}
const model = new OpenAIExplanationModel(config.OPENAI_API_KEY, config.OPENAI_MODEL, config.OPENAI_REASONING_EFFORT);
for (const fixture of evaluationFixtures) {
  const engine = calculatePricing(fixture.input);
  const input = compactExplanationInput(fixture.input, engine);
  try {
    const response = await model.generate(input);
    try {
      const explanation = validateExplanation(response.output, input);
      process.stdout.write(JSON.stringify({ fixture: fixture.name, engineStatus: engine.status,
        includedCount: engine.includedComparables.length, excludedReasons: engine.excludedComparables.map(item => item.reasonCode),
        explanation, usage: response.usage }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ fixture: fixture.name, engineStatus: engine.status,
        explanationStatus: 'UNAVAILABLE', failureCode: error instanceof Error && 'code' in error ? error.code : 'MODEL_PARSE_FAILED',
        ...(process.argv.includes('--inspect-invalid') ? { syntheticOutput: response.output } : {}) }) + '\n');
    }
  } catch (error) {
    process.stdout.write(JSON.stringify({ fixture: fixture.name, engineStatus: engine.status,
      explanationStatus: 'UNAVAILABLE', failureCode: error instanceof Error && 'code' in error ? error.code : 'MODEL_UNAVAILABLE' }) + '\n');
  }
}
