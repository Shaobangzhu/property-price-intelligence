# Deterministic pricing engine v1

Version: `ppi-pricing-v1`. This is a TypeScript rule set in `shared/src/pricing.ts`. It uses no React, Express, Prisma, ArcGIS, OpenAI, or LLM. The same validated input and `asOf` timestamp produce the same result. Changing a threshold or formula requires a new engine version. The current endpoint returns an unsaved preview; a future `AnalysisRun` record must store the engine version beside its inputs and result.

## Scope and inputs

The input contains a saved subject's effective living area, type, beds, baths, optional current list price, and names of user-overridden fields; normalized recorded-sale and active-listing candidates; a chosen Offer or Listing strategy; optional Offer maximum budget; an explicit `asOf` time; and property/market source, freshness, and search-bound metadata. The server builds this input from the existing saved property and the configured market-evidence search. User overrides are used in effective subject facts; original provider fields remain intact. No search radius or date range expands automatically.

Active listing asks are competitive context only. Each ask is tagged below, within, or above the observed reference range, or as unpriced/reference-unavailable. They never enter the sold-price statistic. Current list price is context only. Schools, Grocery, Wildfire, and Faults do not affect any numeric output.

## Eligibility, in order

| Rule | V1 threshold or handling | Exclusion reason |
| --- | --- | --- |
| Subject area | Positive effective living area required | `EXCLUDED_SUBJECT_AREA_MISSING` on candidates; `SUBJECT_AREA_MISSING` overall |
| Sold price | Positive recorded sale price required | `EXCLUDED_MISSING_PRICE` |
| Comparable area | Positive living area required | `EXCLUDED_MISSING_AREA` |
| Property type | Same normalized type; aliases for house, condo, and townhouse only | `EXCLUDED_PROPERTY_TYPE` |
| Sale date | Valid and on/before `asOf` | `EXCLUDED_MISSING_DATE` or `EXCLUDED_FUTURE_SALE` |
| Sale age | At most 365 whole UTC days | `EXCLUDED_TOO_OLD` |
| Distance | Known, nonnegative, at most 2 miles | `EXCLUDED_MISSING_DISTANCE` or `EXCLUDED_TOO_FAR` |
| Area ratio | Comparable sqft / subject sqft from 0.70 to 1.30 | `EXCLUDED_SIZE_MISMATCH` |
| Bed/bath compatibility | If both values are known: difference at most 2 beds and 1.5 baths | `EXCLUDED_BEDROOM_MISMATCH` or `EXCLUDED_BATHROOM_MISMATCH` |
| Duplicate | First eligible record for a candidate ID or provider ID; otherwise normalized address plus sale date | `EXCLUDED_DUPLICATE` |
| Extreme sold price per sqft | With at least 4 preliminarily eligible sales, exclude values outside 0.5×–2× their median | `EXCLUDED_PRICE_OUTLIER` |
| Selection cap | Take at most 8 remaining sales, ordered by weight then candidate ID | `EXCLUDED_CAP_REACHED` |

These are transparent prototype heuristics, not appraisal-industry validated rules. Missing bed/bath values do not become zero or force exclusion; they increase the missing-field burden for evidence quality. The source search can be narrower than an engine limit; the engine never requests additional candidates. At least 3 selected sales are required. Missing subject area or type, or fewer than 3 selected sales, yields `INSUFFICIENT_EVIDENCE` with **no** reference or strategy price.

## Weight and reference formulas

For each included sale, set `P = soldPrice / comparableSqft`, `r = comparableSqft / subjectSqft`, `d = distanceMiles`, and `a = floor((asOf − soldAt) / 1 day)`.

```text
distanceFactor = max(0.25, 1 − d / 2)
recencyFactor = max(0.25, 1 − a / 365)
sizeFactor = max(0.25, 1 − |1 − r| / 0.30)
rawWeight = distanceFactor × recencyFactor × sizeFactor
normalizedWeight = rawWeight / sum(rawWeight of selected sales)
```

Factors and weights are returned for every included sale. The weighted median of `P` is the reference price per sqft. The **Market Reference Range** uses discrete weighted 20th and 80th percentiles of observed `P`; both are multiplied by subject sqft. Reference price and bounds are rounded to the nearest $100. This range is a description of selected sales, **not** a confidence interval or prediction interval. The outlier rule and weighted median reduce the effect of one extreme price; they cannot make heterogeneous properties truly comparable.

Synthetic example: a 1,000 sqft condo with three eligible 1,000 sqft sales at $200,000, $220,000, and $240,000, respectively 30/60/90 days old and 0/0.5/1 miles away, produces a $220,000 reference and a $200,000–$220,000 Market Reference Range. The closer, newer sales receive higher weights. A fourth $2,000,000 sale at 1.9 miles and 300 days is marked `EXCLUDED_PRICE_OUTLIER`; it does not move the reference or range.

## Evidence quality

Quality describes **this evidence set**, not model accuracy. `INSUFFICIENT` applies whenever no numeric result is allowed. With enough evidence:

- `STRONG`: at least 5 sales, fresh subject and sales data, subject bed/bath present, weighted median age at most 180 days, weighted median distance at most 1 mile, missing comparable bed/bath rate at most 20%, and `(weighted P80 − weighted P20) / weighted median` at most 20%.
- `MODERATE`: at least 4 sales, fresh subject and sales data, median age at most 270 days, median distance at most 1.5 miles, missing-field rate at most 40%, and dispersion at most 35%.
- `LIMITED`: at least 3 sales but neither stronger rule passes. Stale property or sales evidence cannot be Strong or Moderate.

The response includes count, age, distance, dispersion, missing rate, source freshness, warnings, reason codes, and the versioned configuration. A stale saved market snapshot may be used with a warning; unavailable or too sparse sales produce no invented price.

## Strategy positions

Let `L` and `H` be the Market Reference Range bounds and `S = H − L`. Every strategy stays inside those observed bounds.

| Mode/profile | Recommended range | Suggested price |
| --- | --- | --- |
| Offer Conservative | `L` to `L + 0.5S` | `L` |
| Offer Balanced | `L + 0.25S` to `H − 0.25S` | `L + 0.5S` |
| Offer Competitive | `L + 0.5S` to `H` | `H` |
| Listing Quick Sale | `L` to `L + 0.5S` | `L + 0.2S` |
| Listing Balanced | `L + 0.25S` to `H − 0.25S` | `L + 0.5S` |
| Listing Test Market | `L + 0.5S` to `H` | `H` |

All strategy prices round to $100. An optional Offer budget caps the upper range and suggestion after rounding the budget **down** to $100, so the output never exceeds it. If the budget is below `L`, the market reference is still returned but the Offer strategy reports `BUDGET_BELOW_REFERENCE_RANGE` and no offer price. A binding budget may shift a chosen profile toward the lower part of the observed range; the result includes that reason. These positions express the user's chosen strategy, not a prediction of seller acceptance or days on market.

For the synthetic example above, Offer suggestions are $200,000 / $210,000 / $220,000 and Listing suggestions are $204,000 / $210,000 / $220,000 in the order shown in the table.

## API and limits

`POST /api/properties/:id/pricing/preview` accepts only `{ "mode": "OFFER", "strategyProfile": "BALANCED", "maxBudget": null }` or a Listing mode with `QUICK_SALE`, `BALANCED`, or `TEST_MARKET`. The server reads the saved subject and current configured market evidence, validates both, and returns a versioned result with `Cache-Control: no-store`. It makes no OpenAI request, does not persist a preview, and does not copy ArcGIS Places or government GIS data into pricing.

The engine does not verify sale condition, concessions, exact property identity beyond existing normalized records, remodel quality, location micro-markets, local regulations, or market direction. The source's limited candidate set and heuristic thresholds can leave too few comparables. This is **not** a formal appraisal or validated automated valuation model.
