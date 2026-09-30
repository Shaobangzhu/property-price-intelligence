# Milestone 08 handoff

## Delivered

- Forward-only `AnalysisRun` migration on the existing dedicated Docker PostgreSQL database. It adds frozen inputs/results, statuses, model and prompt metadata, hash, idempotency key, usage, latency, and cascade deletion. No database reset or environment-file replacement was performed.
- Official OpenAI SDK Responses adapter with strict Structured Outputs, Zod and evidence/price/claim validation, safe error classification, bounded time and output, no retries or expensive fallback.
- Saved Offer and Listing analysis generation, matching-success reuse, in-flight coalescing, explicit regeneration, exact historical retrieval, and graceful explanation failure.
- Dashboard dialog with AI-assisted reasons and strategy below deterministic prices; History latest analyses and version links; normalized synthetic manual-evaluation fixtures.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run prisma:validate` passed.
- Focused analysis, client, and config tests passed. Isolated-schema PostgreSQL integration tests passed against the dedicated PPI container; the migration was then applied with `npm run db:migrate`.
- Three synthetic live explanation fixtures were inspected. See [AI analysis](ai-analysis.md) for scope and observed behavior. No benchmark score is claimed.

## Operational notes

The application default is `gpt-5.6-luna` with low reasoning effort. Existing ignored local `server/.env` values override defaults and were preserved. Missing `OPENAI_API_KEY` yields a saved failed explanation while retaining deterministic pricing. The model may produce content that passes the local guard but still needs human judgment; this tool is decision support, not an appraisal. Historical runs are snapshots and are never recomputed on open.

The existing preview endpoint remains available for deterministic-only callers. The new analysis endpoint is the Dashboard's saved workflow. The History list currently loads analyses for the visible property page (five properties) and the API caps each property response at 100 recent runs while reporting its total.
