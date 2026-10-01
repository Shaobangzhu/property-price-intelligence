# Local database: Docker PostgreSQL

Docker Desktop is the only supported local PostgreSQL runtime for PPI. A native macOS PostgreSQL service is not required. The Express server and Prisma connect through the loopback-mapped port; no other project needs to be started.

```text
PPI application → 127.0.0.1:55435 → ppi-local-postgres-1:5432
                                        ↓
                             ppi-local_ppi_pgdata
```

## Existing PPI resources

| Item | Value |
| --- | --- |
| Compose file / project | `compose.yaml` / `ppi-local` |
| Service / image | `postgres` / `postgres:17.6` |
| Database / user | `property_price_intelligence` / `ppi_app` |
| Host binding / container port | `127.0.0.1:55435` / `5432` |
| Named data volume | `ppi-local_ppi_pgdata` |
| Compose network | `ppi-local_ppi_network` |
| Healthcheck | `pg_isready` for the configured PPI database and user |
| Restart policy | None configured; start with `npm run db:up` after Docker Desktop starts |

Root `.env` owns Compose database settings. `server/.env` owns the application database URL and server/provider settings. `client/.env.local` owns browser settings only. These ignored files are user-owned: preserve existing values. Never put the database password or URL in Vite configuration. The checked local settings resolve to the dedicated PPI database; no credential values are recorded here.

## Commands

Run from the repository root after Docker Desktop starts:

| Command | Action |
| --- | --- |
| `npm run db:up` | Start only PPI PostgreSQL, reusing its named volume |
| `npm run db:ps` | Show only the PPI PostgreSQL Compose status |
| `npm run db:check` | Open a short-lived connection, run read-only `SELECT 1`, close the pool |
| `npm run db:migrate` | Apply tracked forward Prisma migrations to this PPI database only |
| `npm run db:logs` | Show the last 100 PPI PostgreSQL log lines only; avoid sharing logs without reviewing them |
| `npm run db:down` | Stop PPI Compose services; preserve the named volume |

The startup order is `npm run db:up`, `npm run db:check`, `npm run db:migrate`, then `npm run dev`. `db:down` removes the PPI container and network, but **does not delete the volume**. The same volume identity survived a stop/restart check in milestone 01.5. Do not use `down -v` for normal shutdown.

## Prisma

Prisma 6.12.0 defines `Property`, `DataSnapshot`, and versioned `AnalysisRun` records and tracks forward migrations in `prisma/migrations`. `npm run prisma:validate` checks schema syntax; `npm run db:migrate` applies pending migrations without resetting data. Runtime queries use the existing `pg` pool and target the same schema. No native PostgreSQL server is used. `npm run audit:database` verifies applied migration names and checks persisted JSON for known Places keys in a read-only transaction, printing only PASS/FAIL. This heuristic complements the provider allowlists and regression tests; it is not a content-provenance proof.

## Troubleshooting

- **Docker Desktop is stopped:** start Docker Desktop, then rerun `npm run db:up`.
- **Port 55435 is occupied:** the startup guard refuses an unrelated listener. Identify the owner of that port; do not stop another project's process automatically.
- **Container is unhealthy:** use `npm run db:ps` and review only the PPI logs with `npm run db:logs`.
- **`DATABASE_URL` is missing or inconsistent:** compare the local root and server configuration privately; correct only the missing or invalid setting and preserve all provider keys. `db:up` checks that the two PPI database configurations agree.
- **Readiness returns 503:** verify `npm run db:ps` and `npm run db:check`. Liveness can remain 200 while the database is unavailable.

Do not delete the volume as a troubleshooting step. No reset or destructive migration command is part of this workflow.
