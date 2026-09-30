# Milestone 03 handoff

## Delivered

- Forward Prisma migrations add `Property` and versioned `DataSnapshot` tables to the existing PPI PostgreSQL database, plus a refresh-failure marker. They were applied with `migrate deploy`; no reset, duplicate database, or volume change occurred.
- `PropertyDataProvider` separates the resolver from `RentCastPropertyProvider`. The adapter validates the bounded property-record response and stores only a sanitized address/structural allowlist.
- `PropertyService` implements subject identity, 14-day snapshot caching, explicit stale fallback, singleflight resolves, forced refresh, notes and user overrides, pagination, and deletion. The PostgreSQL repository provides transactional save, identity locks, unique constraints, and snapshot cascade deletion.
- REST endpoints: `POST /api/properties/resolve`, `GET /api/properties`, `GET /api/properties/:id`, `PATCH /api/properties/:id`, `POST /api/properties/:id/refresh`, and `DELETE /api/properties/:id`.
- Dashboard and History now use the API. Dashboard starts empty and shows saved/live source and freshness; History displays persisted subject properties with search, pagination, detail selection, notes/override edits, refresh, and confirmed deletion. Pricing/comparables/GIS remain unavailable and show no invented values.

## Identity, cache, and ownership

The RentCast ID is retained when provided. The normalized full-address key also uniquely identifies a subject and retains the unit token. The resolver accepts exactly one matching property; it returns a structured ambiguity result for multiple matches. Only explicitly searched subjects are saved to History.

`PROPERTY_PROFILE` freshness uses `fetchedAt` and `expiresAt` with a 14-day TTL. Editing notes or overrides changes neither timestamp. Failed refreshes do not create a snapshot or move `fetchedAt`; `refreshFailedAt` keeps the record marked stale across later reads. A successful fetch clears that marker and adds a new snapshot. `STALE_FALLBACK` is returned explicitly when an older profile remains viewable after a provider failure.

Provider fields and user overrides remain separate. Supported override entries store value, `USER` provenance, and timestamp; the API returns original provider fields alongside effective display values. Snapshots contain only validated normalized fields. Owner/contact/identity fields and raw provider records are never stored. Delete removes the chosen PPI subject and its own snapshots only.

## Verification

| Check | Result |
| --- | --- |
| Existing PPI schema inspection before migration | No business tables |
| Forward migration and idempotent `npm run db:migrate` | Passed; PPI public schema has `Property`, `DataSnapshot`, and Prisma migration history |
| Isolated PostgreSQL integration test | Passed with mocked provider in a temporary schema; public property count unchanged |
| Offline/unit and HTTP tests | Passed; no RentCast requests |
| Chromium smoke | Passed with mocked property API and external network blocked |
| Typecheck, lint, build | Passed |
| Live RentCast verification | NOT RUN; no explicit live address supplied; request count 0 |

## Known limits and deferred work

Search requires a full address and exact normalized match, including unit. Provider formatting variants beyond the supported street and unit abbreviations may return no match for manual review. No partial address autocomplete or broad retry/pagination strategy is included. PostgreSQL records are local to this PPI instance; there is no authentication or multiuser ownership model yet.

Comparable sales, listings, authoritative school assignments, ArcGIS map/Places, hazards, pricing, AI explanations, agents, and deployment remain deferred. The property-record endpoint does not verify a current listing ask, so current list price is unavailable. Existing Milestone-02 demo fixtures are not used by Dashboard or History.

## Acceptance criteria

Subject persistence, 14-day cache, provider adapter, Dashboard and PostgreSQL History, view/refresh/notes/overrides/delete, ownership separation, automated tests, and build are complete. Existing PPI Docker resources were reused; unrelated resources and user-owned environment files were untouched.
