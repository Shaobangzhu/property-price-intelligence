# Milestone 09.2 — ArcGIS marker popups

Date: 2026-10-14

## Observed defect and shared root cause

The affected live browser showed an empty ArcGIS popup shell for Grocery and an active-listing marker while their normalized data remained available. Its popup container had no content DOM; computed display, opacity, and text color were normal. The console reported failed dynamic imports of a local optimized `calcite-action-bar` module. The browser requested a different hashed filename from the one in the optimizer directory.

The normal development server and the E2E/demo server use the same client root, but different Vite modes and definitions. Both previously used `client/node_modules/.vite`. Starting the demo optimizer could replace lazy ArcGIS/Calcite chunks still referenced by an open development page. This explains the shared failure before layer-specific content renders. The local development server was also stopped when first inspected; it was restarted for verification.

Relevant map history, Graphic construction, and callbacks were checked. The existing callback returned a text DOM node and read normalized values directly, so missing returns, attribute-name drift, unsafe HTML, and hidden text were not the observed root cause. Baseline blank rendering was directly inspected on Grocery and listings; it was not independently captured on all four types before restoring the runtime.

## Changes

- `scripts/demo/server.ts`: give E2E/demo its own `node_modules/.vite-demo` cache; the normal development cache stays unchanged.
- `client/src/features/map/popupContent.ts`: retain safe, fresh DOM text content in a small shared helper; include existing market dates and distances with sold/asking semantics and unavailable-field fallbacks.
- `client/src/features/map/MapShell.tsx`: open the actual selected Graphic at its geometry for market and context list selections. Close selected popups when their layer disappears or the subject changes, and invalidate pending opens. A stale sold popup surviving layer disable was separately reproduced during debugging and fixed here.
- `client/src/features/map/contextMarkers.ts`: include supported school type, rating, provenance, and nearby-school eligibility wording.
- `client/src/features/map/MapShell.test.tsx` and `tests/popup-cache.test.ts`: focused popup, identity, visibility, safety, pending-selection, and optimizer-cache regression coverage.

No dependencies, provider behavior, Grocery deduplication, pricing, AI, History, schema, migrations, or local environment files changed. No Prompt 10 work. Places data was used transiently through the normal UI, without payload fixtures or persistence.

## Automated validation

- Targeted map/cache/application tests: 59 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 270 passed, 5 skipped behind the existing database gate.
- `npm run test:e2e`: 13 passed.
- `npm run build`: passed.
- `npm run audit:secrets`: passed.
- `git diff --check`: passed.

The development page stayed open while the full suite and E2E demo ran. The SHA-256 of the development optimizer metadata was identical before and after E2E; school popups continued to render afterward. The cache regression test resolves the actual Vite configurations and asserts separate cache directories despite the shared client root.

Popup tests cover nonempty sale/listing/school/Grocery content, stable IDs and anchors, unavailable optional fields, text-only handling of provider markup, closing hidden/context-switched/property-switched popups, and cancellation of delayed opens.

## Real browser verification

Chrome, normal local application, real ArcGIS SDK, 7555 Botany St, Chino:

| Layer | Verified interaction and result |
| --- | --- |
| Recorded Sales | Clicked two distinct markers; address, sold price, date, and distance matched selected evidence. |
| Active Listings | Clicked two distinct markers; address, asking price, listing date, and distance matched selected evidence. No sold-price labeling. |
| Schools | Clicked both available school markers; each name, distance, and rating matched its selected side-panel result. Nearby-only disclaimer and Zillapi provenance remained visible. |
| Grocery | Clicked the available marker; name, category, address, and straight-line distance matched its selected side-panel result. |
| Subject | Existing subject popup rendered the correct address and available facts. |

Popup callouts remained attached to their selected markers. Disabling sales, listings, schools, and Grocery closed their selected popup. Switching Schools to Grocery also closed school content. Switching to 7102 Village Dr, Eastvale cleared the previous subject popup; a new-property sale selected from the table and the new subject marker both displayed correct new-property content. Additional fresh-load checks exercised sale/listing/school list-to-popup paths.

No failed dynamic-module import or persistent blank popup recurred after cache isolation and reload. The final fresh-load sale/listing/school/Grocery list-selection pass produced no new console errors. One earlier console entry contained only the opaque SDK message `s$12`, without an explanatory stack; it did not prevent the checks above. It has not recurred during the fresh-load verification, so this handoff does not claim that every earlier console entry was explained or removed.

An already-open page whose dynamic imports have failed needs one reload after the servers use separate caches. Keep the normal development server running while testing the live page.
