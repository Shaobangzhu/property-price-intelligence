import type { AppConfig } from '../../server/src/config/env.js';
import { ZillapiClient, ZillapiError } from '../../server/src/context/zillapi.js';

type Config = Pick<AppConfig, 'ALLOW_LIVE_API_TESTS' | 'ZILLAPI_API_KEY' | 'SMOKE_TEST_ADDRESS'>;
export async function runZillapiSmoke(config: Config, options: { live: boolean; transport?: typeof fetch }) {
  if (!options.live || !config.ALLOW_LIVE_API_TESTS) return { status: 'NOT_RUN', reason: 'LIVE_FLAG_AND_ENV_GATE_REQUIRED', requestCount: 0 } as const;
  if (!config.ZILLAPI_API_KEY || !config.SMOKE_TEST_ADDRESS) return { status: 'NOT_RUN', reason: 'KEY_AND_SMOKE_ADDRESS_REQUIRED', requestCount: 0 } as const;
  try {
    const result = await new ZillapiClient(config.ZILLAPI_API_KEY, options.transport).inspectSchools(config.SMOKE_TEST_ADDRESS);
    return { status: 'COMPLETED_UNVERIFIED', ...result } as const;
  } catch (error) {
    if (error instanceof ZillapiError) return { status: 'FAILED', code: error.code, requestCount: error.requests.length,
      requests: error.requests, semanticsVerified: false } as const;
    return { status: 'FAILED', code: 'UPSTREAM', requestCount: 0, semanticsVerified: false } as const;
  }
}
