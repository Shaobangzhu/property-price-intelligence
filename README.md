# Property Price Intelligence

PPI is a local-first prototype for real estate pricing decisions. Milestone 01 supplies only the React/Express foundation, a dedicated PostgreSQL setup, and gated provider capability checks. Dashboard and History are placeholders; no property or pricing workflow exists yet. Local-first means the app and database run locally, while later provider checks still require third-party services.

## Prerequisites and setup

- Node 24.19.0 (`.nvmrc`), npm 11, Docker with Compose for database runtime checks.
- `npm ci`
- Copy `.env.example` to `.env`, `server/.env.example` to `server/.env`, and `client/.env.example` to `client/.env.local`. These paths are loaded independently: Compose uses root `.env`, server uses `server/.env`, Vite uses `client/.env.local`. Existing process variables take precedence on the server. Set the same development PostgreSQL password in root `.env` and the `DATABASE_URL` in `server/.env`; never commit either. Paid keys may remain blank.
- `npm run db:up`, then `npm run db:check`, then `npm run dev`.
- Open `http://localhost:5173`. API listens at `127.0.0.1:3001`; Vite proxies `/api` there. Vite uses strict port 5173. If it conflicts, resolve the conflict or deliberately update frontend origin, CORS, and ArcGIS basemap referrer restrictions before changing ports.

## Commands

`npm run dev`, `dev:client`, `dev:server`, `build`, `start`, `typecheck`, `lint`, `test`, `test:e2e`, `db:up`, `db:down`, `db:check`, `prisma:validate`, `smoke:providers` run from the repository root. `db:down` stops only PPI containers and preserves the PPI volume. Never use `down -v` for routine stopping. `db:check` runs a read-only `SELECT 1` with a short timeout. Database management commands check the Compose project name and dedicated port. The server validates `DATABASE_URL` targets `127.0.0.1`/`localhost` and database `property_price_intelligence`.

`npm run smoke:providers` is a zero-request dry run. To permit a bounded live run, set `ALLOW_LIVE_API_TESTS=true` yourself in `server/.env` or the process environment, provide only the smoke inputs and keys you intend to test, then run `npm run smoke:providers -- --live`. The runner makes at most six requests, counts failures, disables retries, and writes no raw provider records. Leave the flag false for ordinary work. The browser `VITE_ARCGIS_API_KEY` is for basemap access only; `ARCGIS_PLACES_API_KEY` is server-only. Key presence never proves authentication.

See [architecture](docs/architecture.md), [provider findings](docs/provider-capabilities.md), and [milestone handoff](docs/milestone-01-handoff.md).
