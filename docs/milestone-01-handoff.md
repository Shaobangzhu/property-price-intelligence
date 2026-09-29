# Milestone 01 handoff

## Implemented

Runnable npm workspace with React/Vite client, Express server, browser-safe shared contracts, local PostgreSQL Compose service, read-only readiness check, Prisma 6 groundwork, opt-in provider smoke CLI, focused offline tests, and one mocked browser navigation test. Placeholder Dashboard and History contain no property data. Local ignored env files were created with a random development database password and blank provider keys; existing files were not overwritten. No business schema or migration was created.

## Verification on 2026-09-29

| Command/check | Result |
| --- | --- |
| `npm ci` | PASS; locked dependencies installed, audit reported zero vulnerabilities |
| `npm run build` | PASS; shared, compiled server, Vite client |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS; 17 offline tests, run with local loopback binding permitted for Supertest |
| `npm run test:e2e` | PASS; one Chromium navigation test, mocked API |
| `npm run prisma:validate` | PASS; datasource schema valid, no business models |
| `npm run db:up` / `npm run db:check` | PASS; dedicated PostgreSQL service, read-only `SELECT 1` |
| `npm run db:down` | PASS; PPI container stopped and network removed; persistent volume preserved |
| Compiled `npm run start` plus loopback health requests | PASS; live=200, ready=200 |
| `npm run smoke:providers` | PASS dry run, exactly zero external requests |
| Live provider requests | NOT RUN; keys, supplied address/coordinates, and explicit live authorization flag absent |

## Next inputs and boundaries

Before milestone 02, use the existing local env files or supply consistent local database settings. UI design work requires its own milestone instructions. Before any live provider validation, supply the intended RentCast address, relevant server keys, optional explicit coordinates, and set `ALLOW_LIVE_API_TESTS=true` yourself, then pass `--live`. Verify ArcGIS key privileges separately: basemap referrer `http://localhost:5173` and server Places privilege. Do not treat a configured key as a successful API test. The selected OpenAI model must be available to the account; no fallback occurs.

Business persistence, cache policies, data adapters, school assignment, maps, pricing, and AI explanations remain deferred. Assigned-school availability is a product dependency. The local Docker volume persists; the service is currently stopped and can be restarted with `npm run db:up`. Foundation runtime verification passed; live provider capability verification is pending.
