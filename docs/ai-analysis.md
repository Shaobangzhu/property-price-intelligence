# AI-assisted pricing explanation

Milestone 08 adds a versioned explanation layer over `ppi-pricing-v1`. The deterministic engine is the only component that calculates the Market Reference Range, offer/listing range, and suggested price. OpenAI supplies narrative, strategy steps, assumptions, unknowns, and warnings. The UI labels the split explicitly.

## Model and prompt

The server uses the official OpenAI JavaScript SDK and the Responses API with strict JSON Schema Structured Outputs. The default `OPENAI_MODEL` is `gpt-5.6-luna`; the default `OPENAI_REASONING_EFFORT` is `low`. Existing ignored local environment values take precedence. The server keeps the API key server-side. `PROMPT_VERSION` is `ppi-explanation-v1`; changing the prompt or output behavior requires a version bump. There is no LangChain dependency because the single SDK adapter already provides a replaceable model boundary without a second abstraction.

The request sets `store: false`, `max_output_tokens: 1400`, a 12-second timeout, and zero automatic SDK retries. There is no model fallback. The model adapter is the only OpenAI-specific component; `AnalysisService` depends on its `ExplanationModel` interface.

Official references: [GPT-5.6 Luna capabilities](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [reasoning effort](https://developers.openai.com/api/docs/guides/reasoning).

## Input contract

The server builds `PricingInput` from the saved subject's effective values and normalized market evidence. The analysis stores the actual normalized input, source fetched times, engine configuration and version, user settings, and engine result in `AnalysisRun`. The UTC analysis date is pinned to midnight so a same-day request with unchanged snapshots and settings has a stable hash. The hash also includes model, reasoning effort, engine version, and prompt version.

The compact model input contains effective subject type, area, beds, baths, current list price, overridden field names, mode and strategy, the deterministic engine result, included recorded-sale evidence, excluded-sale IDs and reasons, and active listing asks. Included sales and asks retain their distinct evidence kinds. `ENGINE` is an allowed evidence ID for claims about engine calculations and limits. The model input is projected from an allowlist; it does not contain raw RentCast payloads, owner/contact fields, ArcGIS Places records, notes, unrelated rows, or live Grocery data. GIS facts are omitted in this version.

## Output and validation

The strict output object has `summary`, `reasons[{claim,evidenceIds}]`, `strategySteps`, `assumptions`, `unknowns`, and `warnings`. Local Zod validation enforces nonempty bounded text, required cited reasons, and array limits after Structured Outputs. Every cited ID must equal `ENGINE` or an ID supplied in the compact evidence. Display text has markup and control characters removed, and React renders it as text.

The post-model guard rejects unknown IDs, dollar amounts or explicit large price numbers absent from deterministic results, unsupported school or hazard facts, guarantees, asking prices asserted as sold, and excluded sales asserted as included. It conservatively rejects price-per-square-foot prose. This is a rule-based guard, not a proof of semantic correctness; model claims should still be reviewed by users. Invalid content is never displayed as an explanation.

## Persistence, API, and cost behavior

`AnalysisRun` stores `RUNNING`, `SUCCEEDED`, or `FAILED`; mode and strategy; engine/prompt/model/effort metadata; user inputs; frozen normalized input; frozen engine result; validated AI result; hash; timestamps; safe failure code; token usage; and latency. It cascades only when the owning PPI subject property is deleted. No Places content is stored. A partial unique index permits one RUNNING run per property, mode, and hash. A request UUID serves as an idempotency key; the same key returns the same run. Stale RUNNING claims older than 45 seconds become `INTERRUPTED`.

- `POST /api/properties/:id/analyses` computes and stores a new run, or returns a matching successful/running run. An identical successful run incurs no new model call.
- `GET /api/properties/:id/analyses` returns up to 100 recent versions and a total count.
- `GET /api/analyses/:id` retrieves an exact frozen version without recalculation.
- `POST /api/analyses/:id/regenerate-explanation` requires an `Idempotency-Key` UUID and explicitly creates a new explanation version over the old frozen input and engine result.

The dialog disables duplicate actions while a request is pending. History shows the latest Offer and Listing runs, analysis dates and prices, and exact versions. A failed or unavailable explanation leaves the stored deterministic result visible. Failure codes distinguish missing key, authentication, rate limit, timeout, refusal, incomplete response, parse failure, invalid evidence, unsupported claim, numeric mismatch, and model unavailable. Provider error bodies and secret values are never returned or logged. A database write failure returns a safe server error.

## Manual evaluation

`scripts/eval/fixtures.ts` contains three synthetic inputs: a normal five-sale case, a stale two-sale insufficient-evidence case, and an outlier exclusion case. `scripts/eval/inspect.ts` requires both `--live` and `ALLOW_LIVE_API_TESTS=true`; it prints only synthetic outputs and safe status/usage fields. On 2026-09-29, the three live fixtures were manually inspected after validator adjustment. All three passed local validation. The limited case stated that no numeric offer was available; the outlier case identified the excluded sale; and active asks remained context rather than sales. This is a small manual inspection, not a measured quality benchmark.
