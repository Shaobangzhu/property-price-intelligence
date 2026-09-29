# Milestone 02 handoff

## Components implemented

- Persistent React shell with Dashboard and History navigation, active route styling, demo workspace label, and independent API liveness status.
- Dashboard with fixture-only address search, property summary, price insights, schematic map shell, exclusive map context selector, contextual panel, selectable comparable sales, and reusable empty/error states.
- Shared Offer and Listing analysis dialog with mode-specific fixture content, price scale, focus trap, Escape close, focus restoration, and disabled actions that require later integrations.
- History with fixture search, analysis and status filters, summary cards, two-record pagination, keyboard-selectable rows, and a selected-record detail panel.
- Responsive light UI styles without a component framework or external assets.

## Fixture architecture

`client/src/fixtures/demo.ts` is the sole property/business-content source for this milestone. It exports typed synthetic properties with `source: 'DEMO_FIXTURE'`, comparables, explicitly fixture-assigned schools, grocery examples, and prewritten analyses. `searchDemoProperty` resolves only those addresses and returns `null` for unknown or ambiguous input. The browser calls `/api/health/live` only for server status. No live property request or failure-to-fixture fallback exists. The app labels fixture content wherever a user could mistake it for real property evidence.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed: 24 tests, including UI interaction tests; local loopback permission was required for the existing Supertest tests |
| `npm run test:e2e` | Chromium smoke covers Dashboard → Offer dialog → close → History → selected record, with API liveness mocked and nonlocal requests blocked |
| `npm run build` | Passed |

## Known UX limits

- Address search accepts only four synthetic addresses. The map is a schematic placeholder; comparable selection changes row state and a map-shell note, with no geographic synchronization.
- Fixture status, update dates, price ranges, comparisons, school assignments, and grocery examples are illustrative. The school panel identifies assignments only within the fixture; real attendance assignments remain unverified.
- The wildfire and fault panels report unavailable data. The API badge reports server liveness only. Refresh, Delete, Regenerate, and Save are disabled.
- History state is local to the browser session; there is no database-backed history or mutation.

## Deferred integrations

RentCast search and market data, PostgreSQL business CRUD, ArcGIS map and Places, authoritative school assignments, wildfire and earthquake fault data, deterministic pricing, OpenAI explanation, agent workflows, and deployment remain outside Milestone 02.

## Acceptance criteria

Dashboard and History navigation, responsive UI, accessible pricing dialogs, mutually exclusive context selection, explicit fixture isolation, automated tests, and build are complete. No live provider calls were introduced. Existing Docker/PostgreSQL configuration and user-owned environment files were not changed.
