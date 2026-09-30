# Milestone 07 handoff: deterministic pricing engine

Completed 2026-09-29. `ppi-pricing-v1` now calculates an unsaved Offer or Listing preview from a saved property's effective subject facts and the existing configured market-evidence set. The numeric engine lives in pure TypeScript in `shared/src/pricing.ts`. It calls no OpenAI or other AI service and has no React, Express, Prisma, or GIS dependency.

## Delivered

- Versioned eligibility configuration: 365-day sale age, 2-mile distance, 0.70–1.30 living-area ratio, compatible type, bed/bath tolerances, three-sale minimum, eight-sale maximum, duplicate detection, and a 2× median price-per-sqft outlier screen. Every sale candidate has an inclusion weight/factors or an exclusion reason.
- A weighted median sold price per sqft times effective subject area produces the reference price. Weighted observed 20th–80th sale percentiles produce the **Market Reference Range**. Evidence quality is Strong, Moderate, Limited, or Insufficient under explicit descriptive rules. The result includes assumptions, warnings, reason codes, and calculation trace.
- Offer strategies: Conservative, Balanced, Competitive, with an optional hard maximum budget. Listing goals: Quick Sale, Balanced, Test Market. All positions are within the observed reference range. Active listing asks appear only as competitive context, never as recorded sales.
- `POST /api/properties/:id/pricing/preview` validates strategy settings, gathers and validates saved property and configured market evidence, and returns `ppi-pricing-v1` with `Cache-Control: no-store`. The endpoint does not persist a preview or create an `AnalysisRun`. A future persisted run must store the engine version.
- Dashboard Offer and Listing buttons open the existing modal layout with live preview values, strategy controls, visible evidence decisions, and explicit insufficient-evidence or budget-below-range states. AI explanation is identified as a later milestone. Old demo analysis fixtures are not used by production routes.

## Boundaries

No automatic radius/date broadening occurs. No school, grocery, wildfire, or fault value changes a price. An active listing ask and a current list price are context only. If subject area/type or at least three eligible sales are missing, the engine returns `INSUFFICIENT_EVIDENCE` and no numeric reference or strategy recommendation. The result is a rule-based market reference, not a formal appraisal, validated AVM, statistical confidence interval, or claim about seller acceptance.

The exact thresholds, formula, examples, quality rules, and limitations are in [pricing engine v1](pricing-engine-v1.md). Provider access and RentCast live coverage remain as documented in [provider findings](provider-capabilities.md); no live provider request was needed for this milestone.

## Verification

Synthetic domain tests cover repeatability, weighted median and range, individual weight factors, missing/old/distant/type/size/bed/bath exclusions, duplicate and cap handling, an extreme sale, insufficient evidence, evidence-quality grades, each Offer and Listing profile, budget rounding, active asks staying outside the sale statistic, ignored context-layer fields, and engine version. Mocked service, HTTP, React, and Playwright tests cover effective overrides, route validation, strategy controls, no-price UI, and end-to-end navigation. No automated test calls a live provider.

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`, and `git diff --check` from the repository root. Existing local environment files and the Docker PostgreSQL configuration remain user-owned and unchanged.
