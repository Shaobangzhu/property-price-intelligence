# Milestone 04 handoff

## Delivered

- `GET /api/properties/:id/market-context` returns separately typed recorded-sale and active-listing candidates, each with source, freshness, cache status, bounded query metadata, and its own snapshot. The existing `DataSnapshot.kind` text column supports `RECORDED_SALES` and `ACTIVE_LISTINGS`; no migration or database reset was needed.
- RentCast geographic searches use the saved subject coordinates. Default bounds are two miles, 25 results per endpoint, and 365 days for sales. Each endpoint is called at most once per expired query, with no offset, broadening, retry, or raw response persistence. Sale candidates require a valid `lastSalePrice` and `lastSaleDate`; only Active sale listings enter the asking-price group. Optional missing fields remain null. Stable IDs combine evidence type and provider ID or normalized address.
- The Dashboard has a real ArcGIS Maps SDK map with distinct subject, recorded-sale, and active-listing graphics, safe normalized popups, and a legend. The comparable table uses **Sold Price** and **Asking Price** in separate sections. Selecting a row highlights its marker; clicking a marker selects its row and detail panel. Candidates without coordinates remain visible in the table.
- Four context selectors remain exclusive and deferred. Pricing and OpenAI remain untouched. Map errors show a fallback while the Dashboard remains usable.

## Freshness and lifecycle

`PROPERTY_PROFILE` remains 14 days by default and is configurable. `RECORDED_SALES` defaults to seven days and `ACTIVE_LISTINGS` to 24 hours. The server has bounded configuration variables in `server/.env.example`. Query coordinates and limits are stored in the normalized snapshot payload, and the query hash prevents old bounds from being treated as fresh. A failed provider refresh leaves fetched time intact and returns an explicit stale fallback when available.

The map creates one `MapView` per mounted subject view. Row selection and context buttons do not recreate it. The component removes click and layer-error handlers and destroys the view on unmount. Starting a new property search aborts the prior property and market requests, clears old evidence, and accepts market results only for the visible subject ID. A late A response cannot display under B.

## Verification on 2026-09-29

| Check | Result |
| --- | --- |
| Existing PPI database readiness and schema metadata | PASS; `Property` and `DataSnapshot` columns present; no migration |
| `npm run typecheck`, `npm run lint`, `npm run build` | PASS |
| `npm test` | PASS; 42 tests passed, two database-gated tests skipped in the default run |
| `PPI_INTEGRATION_TESTS=true npx vitest run tests/persistence.integration.test.ts` | PASS; two tests, temporary schema, public property count preserved |
| `npm run test:e2e` | PASS; one Chromium test, mocked API and map-safe mode, external calls blocked |
| Browser ArcGIS check at `http://localhost:5173` | PASS; one mocked subject, rendered map canvas, 108 ArcGIS-domain HTTP 200 responses, zero RentCast calls; localhost referrer accepted. A later visual check also showed distinct subject diamond, sale circle, and listing square markers with two mocked candidates. |
| Synthetic invalid browser key | PASS; ArcGIS returned an auth failure, map fallback appeared, subject remained usable, and SDK token-bearing console logging was suppressed |
| Live RentCast market coverage | NOT RUN; no user-supplied subject address; provider call count 0 |

The browser check used the existing frontend basemap credential without printing or changing it. All local environment files remain user-owned and ignored. No raw provider response, owner or listing-agent data, or credential was logged or committed. The existing Docker PPI service and volume were reused; no unrelated resources were changed.

## Remaining limits

Map tiles were verified in Chromium with a mocked subject, but recorded-sale and active-listing coverage for a real address is still unverified. The candidate list is not a final comparable selection or pricing model. Inactive asks and provider AVMs are not used. Schools, grocery Places, wildfire, faults, pricing, and AI explanations remain for later milestones.
