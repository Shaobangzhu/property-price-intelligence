# Milestone 09 — Final local audit and prototype freeze

Audit date: 2026-09-30. Scope: independently inspect and harden the existing Milestone 01–08 local PPI prototype. No cloud/Ubuntu deployment, new provider, authentication system, valuation redesign, or agent workflow was added. Existing local work, ignored environment files, and the PPI Docker volume were preserved. No sibling repository or unrelated Docker resource was inspected or changed.

## Readiness assessment

**PPI Core Prototype v0.1**  
**Feature Freeze**

The core local prototype is ready for the prepared interview demo. The required automated checks pass, including real PPI PostgreSQL integration and the complete synthetic browser workflow. This is a local-prototype freeze, not a production deployment or live-provider certification. School context intentionally reports assignment unavailable until a verified assignment source exists. The other context adapters and their failure paths are covered with synthetic responses; the offline map is explicitly schematic.

**Controlled Agent Workflow intentionally deferred to post-MVP enhancement.**

No Git tag, release, deployment, or push was created by this milestone. Changes remain available for review in the working tree.

## Context and architecture review

Read `AGENTS.md`, README, architecture, provider-capabilities, pricing-engine-v1, AI-analysis, and all milestone handoffs through 08, including 01.5. Inspected scripts, workspace/build configuration, Prisma schema and all three migrations, Compose, templates, client/server/shared modules, and tests. Prior completion claims were treated as historical context; the checks below were executed for this audit.

| Boundary | Finding |
| --- | --- |
| Client | Dashboard delegates subject summary, comparable table, map, and context display. Offer/Listing share one dialog. History remains a larger page component, but API transport and reusable analysis/map presentation are separate; no rewrite was needed. |
| Provider state | API clients and service/adapters own remote requests. Fixtures are confined to explicit test/demo entry points and are never a live-failure fallback. |
| Map | ArcGIS imports are lazy. One MapView is reused across context switches; watcher/event handles and the view are destroyed on unmount. Old context graphics are removed independently of subject/comparable layers. |
| Server | Routes validate contracts, services orchestrate, adapters own fixed provider HTTP endpoints, and repositories own SQL. Provider logic does not enter the pricing domain. |
| Pricing | Shared plain TypeScript; no React, Express, Prisma, ArcGIS, or OpenAI dependency. It owns every numeric pricing field. |
| AI | The SDK adapter produces narrative only. The service persists frozen input/result plus metadata and accepts only locally validated explanation. Failure leaves deterministic results available. |

## Defects found and fixed

| Finding | Fix and verification |
| --- | --- |
| Refresh could recreate a subject deleted during a pending provider request | Transaction requires the original property ID to exist. Unit and real PostgreSQL integration regressions cover deletion during refresh. |
| Failed refresh could return notes/overrides from before concurrent edits | Reload saved state before returning stale fallback; preserve original provider fetched time. |
| Legacy address keys concatenate tokens and can collide | Token-aware equality guards reject conflicting cache hits/writes. In-flight identity is token-aware. Concurrent conflicting addresses cannot overwrite one another. No migration was imposed. |
| Abbreviations could fail to exclude the subject from comparable candidates | Address comparison recognizes street and apartment variants while retaining unit identity. |
| Independent property reads could mix subject versions while preparing pricing | Capture one validated subject envelope and request market evidence for that snapshot. |
| Rounded weights could select the wrong weighted percentile at an exact boundary | Calculate quantiles with full-precision raw weights; round normalized weights only for display. Formula/thresholds remain unchanged, and new analysis hashes include actual engine results. |
| A truncated wildfire query could imply an outside-zone result | Treat exceeded transfer limits as unavailable. |
| Untrusted browser requests could reach paid local provider routes despite CORS response restrictions | Reject untrusted Origins and cross-site/same-site browser requests lacking Origin before routes; retain configured origin, same-origin proxy, and local CLI support. |
| History modal depended on mutable visible rows | Bind historical run and owning property independently; cancel obsolete detail retrieval. Table refresh/search cannot relabel or crash an open analysis. |
| History loading failures appeared as “Not analyzed” | Show unavailable/retry state. Fetch compact, bounded summaries with pagination and independent latest Offer/Listing records. Full frozen snapshots load only on exact View. |
| React StrictMode could send duplicate initial analysis POSTs | Defer initial effect until setup is stable. Pending guards and reused retry UUIDs prevent duplicate generation and preserve frozen regeneration identity. Browser test asserts exactly two POSTs for one Offer plus one Listing. |
| Polling failures could obscure an already saved engine result | Keep deterministic values and expose status retry. Cancel requests on property change/unmount and reject mismatched response identity. |
| Row keyboard handlers intercepted nested History buttons | Only handle row-level keyboard events. Native button activation remains available. |
| Map popup titles could interpret provider text; late hit tests could select removed contexts | Use a static title and DOM textContent; check context identity before selecting a late hit. |
| Low-contrast metadata, status tags, and focus outlines | Darkened secondary foregrounds, status text, and focus outline. Measured representative text/background pairs are 4.98–6.11:1; focus outline on white is 5.44:1. |
| RUNNING analysis could remain stuck after restart or same-key retry | Expire runs older than 45 seconds before request replay and on get/list. Real database tests cover interrupted replay and exact reads. |
| Concurrent request-key reuse with different hashes could surface a SQL uniqueness error | Serialize request identity separately; return safe 409 conflict. Verified concurrently against PostgreSQL. |
| AI guards ran before sanitization and an unanchored disclaimer exempted additional unsupported claims | Validate exactly the sanitized text; the no-GIS disclaimer must occupy the entire field. Reject markup-joined unsupported words. |
| A price occurring elsewhere in evidence, or a range endpoint, could be mislabeled as reference/suggested price | Validate scalar labels against the exact scalar, range labels against corresponding endpoints, cited amounts against cited evidence, and reject shorthand prices. Added Offer/Listing regressions. |
| Compact input could omit evidence IDs at the configured maximum result count | Retain all bounded sale/listing IDs; test the 100+100 limit. |
| Known API usage was lost when output failed local validation | Persist available usage on rejected, refused, incomplete, and malformed output. Prompt contract version is now `ppi-explanation-v1.1`; older runs remain frozen. |

## Database and ownership

- Docker PostgreSQL is the only supported local database path: `ppi-local`, service `postgres`, image `postgres:17.6`, loopback port 55435. The PPI service was already running and healthy; no restart or volume change was needed.
- Prisma validation passed. All three tracked migrations are applied. Runtime uses the existing `pg` pool; no schema migration was added in this audit.
- Property identity retains units, plus unique provider identity and normalized address constraints. Rare legacy token-key collisions now fail safely; storing both conflicting addresses requires a future key migration.
- DataSnapshot belongs to its subject through a cascading foreign key. Kind/query hashes distinguish profile, recorded-sale, and active-listing snapshots. Provider values and snapshots remain separate from user overrides.
- AnalysisRun is versioned with frozen normalized input, engine result, validated explanation, mode/strategy, prompt/model/engine metadata, request identity, timestamps, usage, and failure state. Its partial unique RUNNING index limits concurrent identical work.
- Property `updatedAt` tracks edits. Provider freshness uses snapshot `fetchedAt`/`expiresAt`, plus the refresh-failure marker. Notes do not advance provider freshness.
- Cascade deletion is restricted to the selected PPI subject's snapshots and analyses. Integration tests create and drop only a random test schema and verify the public subject count remains unchanged.
- Existing property/snapshot/analysis indexes support subject, mode, hash, and recency reads. History no longer downloads up to 100 complete analysis snapshots for every visible property.

## Credential and Places audit

`npm run audit:secrets` passed against current tracked/untracked nonignored source, templates, and the final production browser bundle. It privately compares populated server secrets, checks credential patterns, checks ignored local env files, and examines Git history for non-template env filenames. Its only connection-string pattern exception is the exact synthetic database-target canary in `tests/config.test.ts`; the actual-value check still applies. This is a scoped repository audit, not forensic scanning of every historical source blob or third-party machine.

Configuration results: `RENTCAST_API_KEY`, `OPENAI_API_KEY`, `ARCGIS_PLACES_API_KEY`, `POSTGRES_PASSWORD`, `DATABASE_URL`, and `VITE_ARCGIS_API_KEY`: **CONFIGURED**. This confirms presence/format, not provider authentication. No values, connection strings, raw records, or Places content were printed. No credential rotation is indicated by the observed scan.

Root `.env`, `server/.env`, and `client/.env.local` remain ignored and were not overwritten, regenerated, renamed, or committed. Templates contain placeholders/blank secret fields. The intended browser configuration is only its API base and frontend ArcGIS basemap key. Server keys were absent from browser source/bundles. The demo disables env loading and uses an empty basemap key.

The Grocery service has no persistence dependency. Places responses use `no-store`, remain in client memory, and are cleared on context/property change. Property/market adapters and pricing/AI inputs use allowlists. Regression canaries verify that Places and owner fields do not enter persistence/model boundaries. Code review found no Places logging, analytics, filesystem cache, committed live fixture, or OpenAI prompt path. Demo Places records are hand-authored synthetic data.

The read-only PPI database audit found no known Places keys in persisted JSON. This heuristic supports the architectural/test evidence; absence of known keys alone cannot prove arbitrary-content provenance. No known Places persistence violation remains.

## Data semantics and pricing

- Recorded sale prices are distinct from active asking prices. Inactive asks and provider AVMs do not feed the sale-price calculation. Missing price/area remains null; insufficient eligible evidence produces no numeric recommendation.
- Every included/excluded sale has traceable reasons. Distance, recency, and size weights are deterministic. Active asks are competitive context and all GIS contexts are excluded from numeric pricing.
- Nearby schools cannot become assigned schools. Production assignment is unavailable until verified; no unsupported GreatSchools score is displayed. Optional school-reference failures are tested independently.
- Wildfire uses factual dataset classification/outside/no-coverage/unavailable wording, never “safe” or “no fire risk.” Fault context reports a mapped trace/distance, not earthquake prediction, structural safety, or insurance requirements.
- Explanation numeric fields cannot replace engine fields. Invalid output is rejected, while failed explanations leave the frozen engine result readable.

## Race, failure, performance, and accessibility checks

The combined component, service, database, and browser suites cover late A search after B; property switches during comparable/context loading; Offer and Listing property switches; duplicate analysis clicks/StrictMode setup; current refresh while viewing frozen analysis; deletion after analysis and during refresh; rapid context switching; and exact historical reopen after current source data changes.

Mocked failures cover RentCast unavailable/malformed; basemap failure; Places unavailable; unavailable school assignment and failed enrichment; wildfire/fault failure; OpenAI missing/auth/rate-limit/unavailable/refusal/timeout/incomplete/malformed/invalid evidence/incorrect prices; PostgreSQL unavailable; and insufficient pricing evidence. Useful property/engine data remains visible where available.

The 10-test Playwright suite includes all 21 requested demo steps, table/map selection in both directions, four mutually exclusive context controls and off state, persistent core markers, deterministic Offer/Listing amounts, prepared explanation, exact historical run IDs after refresh, notes freshness, and delete. All external browser requests are blocked; no paid live APIs are involved. Real ArcGIS lifecycle behavior is separately exercised through mocked SDK components.

Singleflight/cache behavior bounds duplicate property and market calls. Analysis hashes, request locks, and client guards bound duplicate model calls. History summaries address oversized history payloads. No uncontrolled view recreation or watcher leak was found. ArcGIS still produces several chunks above 500 kB; the build warns but succeeds. Further bundle optimization is deferred.

Modal focus trapping, Escape, focus restoration, labels, button semantics, row keyboard behavior, and error/status announcements are exercised or inspected. Contrast was measured for the corrected text/status/focus styles. This is a sanity audit, not full WCAG certification or an assistive-technology/browser matrix.

## Commands actually executed

| Command/check | Final result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS: shared/server/client/scripts, including demo/E2E types |
| `npm test` | PASS: **141 tests**, 15 files; 5 gated PostgreSQL tests skipped in this ordinary invocation |
| `PPI_INTEGRATION_TESTS=true npx vitest run tests/persistence.integration.test.ts` | PASS: **5 tests**, isolated schema on PPI Docker PostgreSQL |
| `npm run test:e2e` | PASS: **10 Chromium tests**, complete synthetic workflow plus failures/races |
| `npm run build` | PASS: shared/server/client; 4,685 client modules transformed; ArcGIS chunk-size warning retained |
| `npm run prisma:validate` | PASS |
| `npm run db:check` | PASS: read-only database readiness |
| `npm run db:ps` | PASS: only PPI postgres service inspected, healthy |
| `docker compose -p ppi-local --project-directory /Users/luchaora/Documents/Projects/property-price-intelligence -f compose.yaml --env-file .env config --quiet` | PASS; no expanded configuration printed |
| `npm run audit:database` | PASS: tracked migrations applied; persisted Places-key check |
| `npm run audit:secrets` | PASS against final build |
| `npm run demo` / headed launcher | PASS: controlled synthetic browser opened; stopped after verification |
| `git diff --check` | PASS |

The ordinary suite includes backend, API, domain, client components, and 13 actual-SDK adapter tests using mocked fetch; the latter verify one request/no retry and the 12-second abort. These are included in 141, not additional counts. Socket-dependent tests and database/Docker checks needed sandbox escalation to use local loopback/Docker access; they then passed. An intermediate validator typecheck/test failure was corrected before the final passes. The secret scanner's initial macOS Git executable incompatibility and synthetic-canary false positive were corrected; the final scan passed.

**NOT RUN:** paid/live RentCast, Places, OpenAI evaluation, and remote GIS/basemap smoke. This audit uses mocks and did not request live smoke execution or enable its explicit live gate. Existing credentials were preserved without authenticating them. **NOT RUN:** cloud deployment, Ubuntu deployment, agent workflow, formal accessibility certification, or statistical AVM validation; these are outside this milestone.

## Deliverables and remaining limits

README now describes the actual saved-analysis product, stack, sources, Docker setup, commands, limitations, and deferred work. `docs/demo-script.md` supplies the repeatable 5–7 minute interview flow, using `npm run demo` without provider reliability or charges.

Remaining limits: no verified school-assignment source; live entitlement/coverage not reverified; California-specific informational GIS; approximate fault distance; simple pricing rules not statistically validated; conservative but incomplete natural-language claim validation; legacy address-key conflicts safely rejected; sizable ArcGIS bundles; local single-user prototype security only. These limits are visible/documented and do not block the prepared local core demonstration.

Stop at Milestone 09. Deployment and Controlled Agent Evidence Expansion require their own briefs.

## Follow-up correction — local search 403

The user reported Search returning 403 from `http://127.0.0.1:5173`. The new origin guard compared exact origins, while the existing allowed origin used `localhost`. Earlier mocked browser tests bypassed the server, and the API tests covered only the localhost spelling, so this integration mismatch escaped the initial audit.

Reproduced through the running Vite proxy with an empty address (no provider calls or writes): localhost reached input validation with `400 INVALID_INPUT`, while 127.0.0.1 returned `403 REQUEST_ORIGIN_NOT_ALLOWED`. Configuration now expands a validated loopback origin to both spellings on exactly the configured port, shared by admission and CORS. Local env files remain unchanged. The client also explains origin rejection instead of showing only a generic search failure.

After the fix, both loopback origins reached input validation on the running app; port 5174 and an external origin still returned 403. Regression tests verify successful mocked search POSTs and preflight responses for both origins, preservation of configured values, and rejection of wrong ports/deceptive domains/null origins. Follow-up checks: **146 tests passed** (5 database tests remain separately gated); lint, typecheck, and build passed. The existing ArcGIS chunk-size warning remains. No live provider search was used to validate this correction.
