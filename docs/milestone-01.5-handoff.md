# Milestone 01.5 status

**Complete:** the existing Docker PostgreSQL environment is the single supported local PPI database path. No duplicate database, Compose project, or volume was created. The PPI service is running after the final persistence check; the verification Express process was stopped.

## Existing state discovered

The milestone-01 repository had `compose.yaml`, project `ppi-local`, service `postgres`, image `postgres:17.6`, database `property_price_intelligence`, user `ppi_app`, and a loopback-only mapping `127.0.0.1:55435 → 5432`. It used the named volume `ppi-local_ppi_pgdata` and network `ppi-local_ppi_network`, with a `pg_isready` healthcheck and no restart policy. Root `.env` owns Docker settings; `server/.env` owns `DATABASE_URL`; client settings stay in `client/.env.local`. Prisma 6.12.0 had a datasource and no business model or migration. `db:up`, `db:down`, `db:check`, and HTTP readiness already existed. The service was initially stopped and the volume existed.

Database configuration alignment was **CONFIGURED**. RentCast, server ArcGIS Places, browser ArcGIS basemap, and OpenAI credentials were each **CONFIGURED** in ignored user-owned files. Their values were neither printed nor changed. Configuration status does not verify provider access.

## Changes made

- Added PPI-scoped `npm run db:ps` and `npm run db:logs`; existing start, stop, and read-only check implementations remain in place.
- Made README and repository instructions explicit that Docker PostgreSQL is the only supported local database, existing env files must be preserved, and native PostgreSQL is unnecessary.
- Corrected the Prisma schema comment to the pinned 6.12 version; no datasource or business schema change.
- Added [local database instructions](database-local.md) and updated provider documentation to reflect configured credentials without changing runtime verification status.

## Docker database and persistence

The PPI container was healthy with `127.0.0.1:55435 → 5432`; metadata queried inside it returned database `property_price_intelligence` and PostgreSQL server version `17.6`. The mount at `/var/lib/postgresql/data` was `ppi-local_ppi_pgdata`. The host-side `db:check` succeeded through the same mapped port, establishing the Docker container as the local database endpoint. A scoped `db:down` left the named volume's identity unchanged; `db:up` reused it. After restart, one PPI-labeled container, one volume, and one network were present. No business tables or test data were created.

## Verification on 2026-09-29

| Check | Result |
| --- | --- |
| `npm run db:up`, `npm run db:ps`, `npm run db:check` | PASS; only PPI service, healthy, read-only connection |
| `npm run db:logs` | PASS; PPI-only command executed with output suppressed during verification |
| `npm run db:down`, volume identity, restart | PASS; volume preserved across stop/restart |
| Compiled `/api/health/live`, `/api/health/ready` with DB running | PASS; 200 / 200 |
| Same server with PPI DB stopped | PASS; 200 / 503 |
| Same server after DB restart | PASS; 200 / 200 |
| `npm run prisma:validate` | PASS; Prisma 6 datasource valid, migrations still deferred |
| `npm run build` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS; 17 offline tests |
| `npm run test:e2e` | PASS; one mocked browser navigation test |

**Native PostgreSQL dependency: NONE FOUND.** No global/native PostgreSQL installation or service was modified. CPI, PSGI, DGI, and unrelated Docker resources were untouched.

## Provider verification and next milestones

RentCast **NOT RUN**; ArcGIS Places **NOT RUN**; ArcGIS basemap **DEFERRED**; OpenAI **NOT RUN**; assigned-school source **unverified**. No live provider request was made in milestone 01.5.

Milestone 02 is UI/UX work under its own instructions. Milestone 03 will define the business PostgreSQL schema and real persistence. Preserve the existing PPI volume and user-owned credentials for those tasks.
