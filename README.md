# Property Price Intelligence

PPI is a local-first prototype for real estate pricing decisions. It has a React/Express workspace and a dedicated Docker PostgreSQL database. Dashboard searches RentCast for a subject property when its 14-day PPI cache is missing or stale; History shows saved subject properties. Comparable sales, pricing, and GIS data remain deferred. Local-first means the app and database run locally while uncached property searches require RentCast.

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

Open `http://localhost:5173`. API listens at `127.0.0.1:3001`; Vite proxies `/api` there. Vite uses strict port 5173. If it conflicts, resolve the conflict or deliberately update frontend origin, CORS, and ArcGIS basemap referrer restrictions before changing ports.

## Property workflow

Dashboard starts without a selected property. Enter a full address, including apartment or unit, and Search. The server returns a fresh saved profile when available; otherwise it makes one RentCast property-record request, validates one exact subject match, and saves a sanitized profile snapshot. An unavailable or ambiguous property displays an error. A provider failure can show a clearly marked stale saved profile, with its original fetched time preserved. No fixture records substitute for live results.

History lists only subjects explicitly searched through PPI. Select a row to view facts, edit notes or supported numeric overrides, explicitly refresh, or delete the PPI record after confirmation. Overrides affect displayed values while original provider fields and snapshots stay intact. Offer and Listing remain “Not analyzed” and their buttons are disabled. The map and context panels remain placeholders.

## Commands

`npm run dev`, `dev:client`, `dev:server`, `build`, `start`, `typecheck`, `lint`, `test`, `test:e2e`, `db:up`, `db:down`, `db:ps`, `db:logs`, `db:check`, `db:migrate`, `prisma:validate`, and `smoke:providers` run from the repository root. `db:ps` shows only PPI service status; `db:logs` shows only recent PPI PostgreSQL logs. `db:check` runs a read-only `SELECT 1` with a short timeout. `db:migrate` applies only the tracked forward migrations and suppresses Prisma's raw output. The server validates `DATABASE_URL` targets the dedicated local PPI database.

To stop PPI PostgreSQL, run `npm run db:down`. It stops PPI's Compose service and preserves the database volume. Do not use `down -v` for routine stopping.

`npm run smoke:providers` is a zero-request dry run. To permit a bounded live run, set `ALLOW_LIVE_API_TESTS=true` yourself in `server/.env` or the process environment, provide only the smoke inputs and keys you intend to test, then run `npm run smoke:providers -- --live`. The runner makes at most six requests, counts failures, disables retries, and writes no raw provider records. Leave the flag false for ordinary work. The browser `VITE_ARCGIS_API_KEY` is for basemap access only; `ARCGIS_PLACES_API_KEY` is server-only. Key presence never proves authentication.

See [local database](docs/database-local.md), [architecture](docs/architecture.md), [provider findings](docs/provider-capabilities.md), and [milestone 03 handoff](docs/milestone-03-handoff.md).
