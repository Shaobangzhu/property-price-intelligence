# Milestone 09.1 — Market evidence visibility

Implemented 2026-10-01. Scope: Dashboard map visibility controls only; Prompt 10 has not begun. Earlier ArcGIS and Assigned Schools fixes were preserved. No pricing, AI, database, evidence-selection, or provider integration change was made for 09.1.

## Behavior and state

- A fresh Dashboard starts with Subject Property only. Recorded Sales and Active Listings both default OFF; each is an independent toggle and both can be ON together.
- Dashboard owns `MarketLayerVisibility` separately from the existing nullable `MapContext`. Schools/Grocery/Wildfire/Faults remain mutually exclusive and can all be OFF. Context changes retain both market preferences.
- Property searches retain market/context preferences, abort old requests, clear old results/selections, and load the new subject's data. Explicit Clear clears subject/context; market preferences remain for this Dashboard session. Navigating away/remounting Dashboard starts a new session with defaults.
- Stable sales/listing `GraphicsLayer` instances retain all graphics. Only their `visible` properties change on toggles. Subject is always visible and drawn above optional markers. Toggles do not recreate MapView or change zoom/pan. The existing subject-search lifecycle still unmounts the old map while resolving a new subject; no A graphics remain with B's summary.
- Tables and pricing keep the full evidence arrays. Toggles do not change API requests, analysis inputs, prices, or provider freshness. Table selection of hidden evidence remains supported without automatically showing its layer. Late hit-test results for a hidden market layer are ignored.
- Market legend entries appear only when enabled. Controls reuse existing styling, native buttons, `aria-pressed`, keyboard activation and a visible check mark for the active state.

## Files changed for 09.1

`client/src/features/dashboard/DashboardPage.tsx`, `client/src/features/map/MapShell.tsx`, `client/src/features/map/MapShell.test.tsx`, `client/src/App.test.tsx`, `tests/e2e/navigation.spec.ts`, the map paragraph in `docs/architecture.md`, and this handoff. The separate school investigation is recorded in `docs/provider-capabilities.md`.

## Verification

- Targeted map SDK, Dashboard and school regression suite: **68 passed**. Covers stable view/layer/graphic identity, independent toggle sequences, all contexts, source switching, loading/empty/failed evidence, hidden table selection, unchanged analysis inputs/results and no toggle-triggered provider refresh.
- Existing repository suite: **177 passed**, five separately gated database tests skipped. No database code changed for 09.1.
- Browser E2E: **11 passed**, including the new default/off/on keyboard, legend, context-exclusivity and retained-evidence test; existing workflow/failure/race tests updated to enable market layers explicitly and retain context preferences across subject changes.
- `npm run typecheck`, `npm run lint`, `npm run build`: PASS. Final frontend build also passed after placing the subject layer above optional graphics. Existing ArcGIS chunk-size warning remains.
- `git diff --check`: PASS. Credential/bundle audit: PASS; local environment files were preserved.

## Real browser verification

Chrome on `http://localhost:5173`, using cached real properties `2634 E Scarlett Ln, Ontario, CA 91762` and `7555 Botany St, Chino, CA 91708`:

1. Fresh page: blue subject diamond only, both Market buttons OFF, no Context selected, subject-only legend.
2. Enabled Recorded Sales and Active Listings: green sale circles and orange listing squares appeared independently; 25 sale rows and 25 listing rows remained available on the first subject. Some sale points required zooming out to enter the viewport.
3. Zoomed and panned, then disabled Recorded Sales: sales disappeared, listings and subject remained, and the changed zoom/pan position was preserved.
4. Switched Schools → Grocery → Wildfire → Faults: only one context active; the listing preference and real basemap remained intact. Schools correctly showed the previously fixed source-not-connected state.
5. Searched the second cached subject with Sales ON, Listings OFF and Schools ON: preferences persisted, the old heading disappeared, the map centered on the new subject, and only its evidence graphics appeared.
6. Enabled both markets on the second subject, then turned all optional layers OFF: only the new blue subject remained. Screenshots saved outside the repository at `/tmp/ppi-09.1-market-layers.jpg` and `/tmp/ppi-09.1-subject-only.jpg`.

## Remaining issue

No remaining market-visibility defect was observed. Real CGS fault context returned unavailable for the first sample, so this check does not certify successful fault-line rendering. This existing provider/context limitation did not disrupt the basemap or enabled market graphics; no GIS integration was changed. Schools still requires an authoritative assignment source, as explained in the separate investigation. Stop at 09.1.
