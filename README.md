# Property Price Intelligence

**A pricing decision prototype for real estate agent workflows, driven by geospatial and market evidence.**

**PPI Core Prototype v0.1 — Feature Freeze** (Milestone 09). The app and database run locally; uncached provider searches and AI explanations require network access. See the [final audit](docs/milestone-09-final-audit.md) for verified behavior and limits.

## Core capabilities

- Property lookup, profile cache, notes, overrides, refresh, and delete.
- Recorded comparable sales and separately labeled active asking prices.
- ArcGIS visualization with synchronized subject/comparable selection.
- Assigned-school context, with unavailable state when assignment is unverified.
- Transient grocery context, wildfire designations, and earthquake-fault context.
- Deterministic Offer and Listing pricing with an explicit insufficient-evidence state.
- OpenAI-assisted structured explanation, versioned analysis History, and exact historical reopen.

## Tech stack and architecture

npm workspaces; TypeScript; React 19 / Vite 8; Express 5; shared Zod contracts; Docker PostgreSQL 17; Prisma 6 schema/migrations with `pg` runtime queries; ArcGIS Maps SDK 4.34; official OpenAI SDK / Responses API; Vitest, Testing Library, and Playwright.

The **deterministic pricing engine + AI explanation** boundary is explicit. Plain TypeScript computes eligible sales, weights, reference range, and strategy prices. OpenAI explains frozen evidence and results; it cannot write numeric pricing fields. Failed or rejected explanations preserve the engine result. Exact historical reads do not call OpenAI or recalculate prices. The server owns provider credentials, validation, application services, and persistence; React owns display and interaction.

## Data sources

| Source | Use |
| --- | --- |
| RentCast | Property records, recorded-sale evidence, active sale-listing asks |
| ArcGIS basemap | Browser map with its restricted frontend key |
| ArcGIS Places | Server-requested, transient grocery display |
| CAL FIRE | California responsibility areas and Fire Hazard Severity Zones |
| California Geological Survey | Mapped Quaternary fault traces |
| OpenAI | Structured explanation of deterministic results |

No verified production school-assignment provider is connected. Schools correctly reports assignment unavailable; nearby schools and unlicensed ratings are never substituted.

## Prerequisites

- Node 24.19.0 (`.nvmrc`) and npm 11.
- Docker Desktop with Compose running on the MacBook. A native PostgreSQL installation is **not required or used** by PPI.

## Start locally

1. Start Docker Desktop.
2. Ensure ignored root `.env`, `server/.env`, and `client/.env.local` exist. **Preserve existing files and values.** If a file is missing, use its `.env.example` only as a guide to create that missing file; never copy a template over an existing file. Compose reads root `.env`; the server reads `server/.env`; Vite reads `client/.env.local`. The root Docker password and the server database URL must agree. Existing process variables take precedence. Provider keys are not required for database commands.
3. Run `npm ci` if dependencies are not installed.
4. Run `npm run db:up` to start only PPI's PostgreSQL service, then `npm run db:check` to verify its read-only connection.
5. Run `npm run db:migrate` to apply forward-only PPI business migrations to the existing database.
6. Run `npm run dev`.

PPI reaches Docker PostgreSQL through `127.0.0.1:55435`, mapped to container port 5432. The `ppi-local` Compose project keeps data in the named `ppi-local_ppi_pgdata` volume. No CPI, PSGI, DGI, or native PostgreSQL service needs to be started for PPI.

Open `http://localhost:5173`. Navigating to `http://127.0.0.1:5173` redirects to localhost so the existing ArcGIS basemap key uses its authorized browser referrer. API listens at `127.0.0.1:3001`; Vite proxies `/api` there. For each configured `ALLOWED_ORIGINS` port, the server accepts both loopback spellings without editing the local env file; other ports and external origins remain blocked. Vite uses strict port 5173. If it conflicts, resolve the conflict or deliberately update frontend origin, CORS, and ArcGIS basemap referrer restrictions before changing ports. Basemap referrer permissions are managed separately from the PPI API's origin checks.

## Property workflow

Dashboard starts without a selected property. Enter a full address, including apartment or unit, and Search. The server returns a fresh saved profile when available; otherwise it makes one RentCast property-record request, validates one exact subject match, and saves a sanitized profile snapshot. An unavailable or ambiguous property displays an error. A provider failure can show a clearly marked stale saved profile, with its original fetched time preserved. No fixture records substitute for live results.

History lists only subjects explicitly searched through PPI. Select a row to view facts, edit notes or supported numeric overrides, explicitly refresh, or delete the PPI record after confirmation. Overrides affect displayed values while original provider fields and snapshots stay intact. Dashboard retrieves up to 25 nearby property records sold within 365 days and up to 25 active sale listings within two miles by default. Recorded sale prices appear only as **Sold Price**; active listing asks appear only as **Asking Price**. Inactive listings and provider AVMs are not used. Select a row or map marker to see the same candidate. Candidates without coordinates remain in the table without a marker. Offer and Listing buttons create or reuse saved analyses with strategy controls, included/excluded-sale reasons, deterministic numbers, and validated explanation. Identical successful analyses are reused; explicit regeneration creates an explanation version from frozen evidence. History loads compact paginated summaries and retrieves full snapshots on demand. Active asks and context layers never adjust the numeric market reference.

Choose one map context at a time. **Schools** shows “Assigned school information is unavailable for this property” because the current RentCast property contract does not verify attendance assignments. Nearby schools are never substituted. The assignment source determines school identity; an optional reference source may enrich only a verified identity. **Grocery** requests nearby places through Express when selected and displays a list and markers. **Wildfire** queries the saved subject point against CAL FIRE responsibility and Fire Hazard Severity Zone layers; the map draws official zone polygons for the current view. SRA zones are effective designations; the 2025 LRA layer is recommended and local adoption can differ. An outside result does not mean the property is safe from wildfire. **Faults** checks CGS mapped Quaternary fault traces within 20 miles and displays the approximate nearest mapped distance. These lines are not Alquist-Priolo Earthquake Fault Zones and do not express earthquake probability. Turning any context off removes its context result and geometry. Core subject and comparable markers stay visible. None of the contexts changes pricing.

The browser uses only `VITE_ARCGIS_API_KEY` for the ArcGIS basemap. The server-only Places key is never sent to it. Grocery results are transient: no PostgreSQL, snapshot, log, fixture, file cache, or OpenAI prompt receives Places records. Wildfire and fault context responses are also on demand and are not persisted. A missing, blocked, or failed map shows an unavailable message while subject facts and market evidence remain usable. Cache and bounded market settings can be changed with `PROPERTY_PROFILE_TTL_DAYS`, `MARKET_RADIUS_MILES`, `MARKET_RESULT_LIMIT`, `MARKET_SALE_DATE_DAYS`, `MARKET_SALES_TTL_HOURS`, and `MARKET_LISTINGS_TTL_HOURS` in the existing `server/.env`; Grocery uses `GROCERY_RADIUS_METERS` (1–10000, default 1600) and `GROCERY_RESULT_LIMIT` (1–20, default 10). Preserve current values when editing that user-owned file. Defaults are in `server/.env.example`. Changes to market search settings generate a distinct snapshot query hash. Grocery makes one category lookup and one near-point request when selected, with no pagination or retry.

## Commands

`npm run dev`, `dev:client`, `dev:server`, `build`, `start`, `typecheck`, `lint`, `test`, `test:e2e`, `db:up`, `db:down`, `db:ps`, `db:logs`, `db:check`, `db:migrate`, `prisma:validate`, and `smoke:providers` run from the repository root. `db:ps` shows only PPI service status; `db:logs` shows only recent PPI PostgreSQL logs. `db:check` runs a read-only `SELECT 1` with a short timeout. `db:migrate` applies only the tracked forward migrations and suppresses Prisma's raw output. The server validates `DATABASE_URL` targets the dedicated local PPI database.

To stop PPI PostgreSQL, run `npm run db:down`. It stops PPI's Compose service and preserves the database volume. Do not use `down -v` for routine stopping.

`npm run smoke:providers` is a zero-request dry run. To permit a bounded live run, set `ALLOW_LIVE_API_TESTS=true` yourself in `server/.env` or the process environment, provide only the smoke inputs and keys you intend to test, then run `npm run smoke:providers -- --live`. The runner makes at most six requests, counts failures, disables retries, and writes no raw provider records. Leave the flag false for ordinary work. The browser `VITE_ARCGIS_API_KEY` is for basemap access only; `ARCGIS_PLACES_API_KEY` is server-only. Key presence never proves authentication.

## Offline interview demo and verification

Run `npm run demo` to open a controlled Chromium window with a clearly labeled synthetic dataset, prepared explanation, schematic map, and in-memory History. Click Search on the prefilled address. No env files, live providers, or database writes are used. Closing the window resets the demo. Chromium must be installed for Playwright; if missing, run `npx playwright install chromium`. See the [5–7 minute demo script](docs/demo-script.md).

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
PPI_INTEGRATION_TESTS=true npx vitest run tests/persistence.integration.test.ts
npm run prisma:validate
npm run db:check
npm run audit:database
npm run audit:secrets
```

Integration tests use a temporary schema inside the dedicated PPI database and remove only that schema. `audit:database` is read-only and reports migration/Places-key checks without records. `audit:secrets` checks ignored files, source, templates, and the built browser bundle without printing values; run the build first. Playwright blocks external requests. Ordinary tests never call paid providers. `eval:analysis` is a live evaluation command requiring `ALLOW_LIVE_API_TESTS=true` and is not part of these checks.

## Limitations

- A prototype, not a formal appraisal or a statistically validated AVM. The simple pricing model requires agent review.
- Hazard context is informational; mapped faults do not predict earthquakes or establish structural safety or insurance obligations. GIS coverage is California-specific.
- School assignment depends on verified provider data and is currently unavailable in production.
- Grocery Places data is transient and cannot be reopened from saved analysis History.
- The AI claim validator is conservative and rule based; it cannot prove every natural-language statement correct.
- ArcGIS requires online basemap access and has sizable SDK chunks. The offline demo verifies schematic interaction, not live rendering or provider entitlement.
- Local loopback use only; no authentication, multi-user access, or deployment readiness claim. Rare legacy address-key collisions are rejected safely and need a future key migration to store both addresses.

## Future work

Cloud deployment (Milestone 10), Ubuntu deployment (Milestone 11), and **Controlled Agent Evidence Expansion** (Milestone 12) are deferred.

**Controlled Agent Workflow intentionally deferred to post-MVP enhancement.**

See [local database](docs/database-local.md), [architecture](docs/architecture.md), [pricing engine v1](docs/pricing-engine-v1.md), [AI analysis](docs/ai-analysis.md), [provider findings](docs/provider-capabilities.md), and the [final audit](docs/milestone-09-final-audit.md).
