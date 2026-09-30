# PPI architecture through Milestone 03

The browser is a Vite/React app with Dashboard and History routes. Express owns HTTP validation, CORS, security headers, request IDs, and safe errors. Shared Zod contracts define property API inputs and responses. Docker PostgreSQL is the sole supported local database in the existing `ppi-local` Compose project. Prisma 6.12.0 defines and migrates the schema; runtime persistence uses the existing `pg` pool. No separate PostgreSQL service or Prisma Client runtime was introduced.

## Property resolution

`POST /api/properties/resolve` validates a full address and normalizes a key that retains apartment or unit identity. `PropertyService` first reads the latest `PROPERTY_PROFILE` snapshot for a matching saved subject. It returns a cache hit only when `expiresAt` is later than now and no later refresh failure marked the profile stale. A missing, expired, or marked-stale profile causes one call through `PropertyDataProvider`; `RentCastPropertyProvider` is the production implementation. It uses a fixed endpoint, server-only key, eight-second timeout, no redirects or retries, and a bounded response size. Exact normalized address and unit matching must identify one subject. Empty, ambiguous, malformed, and upstream failures produce distinct safe API errors.

The adapter projects only documented, validated structural and address fields into `NormalizedProviderProperty`. This whitelist excludes owner names, mailing addresses, phone numbers, email, unrelated identities, tax/history blobs, and raw provider JSON. The property-record endpoint does not establish a verified current listing price, so `currentListPrice` stays null. No comparable, listing, school, Places, hazard, or AI data is fetched or persisted here.

The service waits for the remote response before opening a database transaction. The repository uses advisory transaction locks on normalized address and provider identity, uniqueness constraints for address key and provider ID, and a versioned snapshot insert. This protects simultaneous resolves and refreshes without holding a transaction through network latency. The browser aborts superseded searches and checks request identity before changing the selected property. In-process singleflight coalesces repeated requests for the same key.

## Data ownership and freshness

`Property` stores provider-normalized fields, subject-only identity, user notes, and JSONB override entries. A stable RentCast ID is preferred where available; a normalized full address including unit is also unique. `DataSnapshot` stores a sanitized normalized payload, hashes, `fetchedAt`, and `expiresAt`; its `PROPERTY_PROFILE` TTL is 14 days. `Property.updatedAt` records edits but never determines provider freshness. A failed refresh leaves the snapshot and fetched time unchanged and sets `refreshFailedAt`, so future reads show stale state until a successful provider fetch clears the marker. `STALE_FALLBACK` is explicit in resolve/refresh responses.

Notes and supported overrides (`bedrooms`, `bathrooms`, `livingAreaSqft`, `yearBuilt`) are user-owned. Each override stores its value, `USER` provenance, and edit timestamp. The API returns both the original provider field and `effectiveValues`; an override changes only the latter. PATCH cannot write provider fields or mutate snapshots. DELETE removes only the selected PPI subject property and cascades its PPI snapshots. Future comparable properties must not be inserted into subject History implicitly.

## UI and future boundaries

Dashboard resolves and displays a saved/live profile with source, fetched time, expiry, and stale status. History reads PostgreSQL with address search and pagination, and supports view, notes/override edits, explicit refresh, and confirmed delete. Pricing labels remain “Not analyzed”; Offer and Listing actions are disabled. The schematic map, mutually exclusive context selector, and unavailable context panels remain without ArcGIS integration. Milestone-02 fixtures remain isolated for historical component use and are not imported into these production routes.

Future services may add comparables, licensed map/Places layers, authoritative attendance assignments, pricing, and AI explanations under separate snapshots and provenance rules. Recorded sale prices and listing asks remain distinct evidence types. Places data remains transient under Esri terms; it is not persisted or forwarded to OpenAI here. The provider smoke CLI remains separate from app startup and property resolution.
