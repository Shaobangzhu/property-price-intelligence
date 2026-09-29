# Provider capability findings

Official documentation checked **2026-09-29**. “Documented” describes the provider reference; “observed” requires a live response and is **NOT RUN** here because keys and the user-selected address/coordinates are absent. Credential presence, when supplied later, does not establish access.

Implementation versions are pinned in the root lockfile. Prisma datasource syntax follows the [Prisma ORM v6 schema reference](https://www.prisma.io/docs/orm/v6/prisma-schema/overview); the client environment boundary follows the [Vite environment guide](https://vite.dev/guide/env-and-mode).

| Operation | Documentation status | Runtime status | Open question |
| --- | --- | --- | --- |
| RentCast property by address | [Records endpoint](https://developers.rentcast.io/reference/property-records) and [property schema](https://developers.rentcast.io/reference/property-data-schema) checked | NOT RUN | Sample field availability, exact property identity, school semantics |
| RentCast nearby recorded sales | [Records endpoint](https://developers.rentcast.io/reference/property-records): coordinates, radius in miles, `saleDateRange`, limit | NOT RUN | Recorded sale price/date coverage in selected area |
| RentCast active sale listings | [Sale listings endpoint](https://developers.rentcast.io/reference/sale-listings): `status=Active`, coordinates, radius, limit | NOT RUN | Active asking-price coverage |
| ArcGIS category lookup | [Categories endpoint](https://developers.arcgis.com/rest/places/categories-get/): `filter`, category label and ID | NOT RUN | Unique grocery/supermarket category ID for the live catalog |
| ArcGIS near-point Places | [Near-point endpoint](https://developers.arcgis.com/rest/places/near-point-get/): x=longitude, y=latitude, radius meters, categoryIds, pageSize | NOT RUN | Server key privilege and response shape |
| ArcGIS basemap | Browser key presence check only | DEFERRED to milestone 04 | Browser rendering and referrer allowlist at `http://localhost:5173` |
| OpenAI structured output | [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [structured output](https://developers.openai.com/api/docs/guides/structured-outputs) checked | NOT RUN | Account/model access, SDK response and token usage |
| CDE, school matching, wildfire, faults | No endpoint selected | DEFERRED | Authoritative source and licensing selection in later milestones |

The RentCast property schema documents ID, formatted address and `addressLine2` unit, coordinates, type, beds/baths, living/lot area, year built, last sale date/price, sale history, and owner details. It does not establish photos, current listing status/asking price, or an assigned-school contract for this project. The runner reports field presence/type for these candidates on an unambiguous sample and drops owner/contact data before normalization or reporting. A single absent field will not be treated as globally unsupported. Sale-listing `price` is an ask, distinct from property `lastSalePrice`. Inactive listing data is not a recorded transaction.

**Assigned-school dependency:** The checked property schema does not document a verified attendance-assignment field. The smoke runner can distinguish no school field, a school-related field of unverified meaning, and an `assignedSchools` array shape if observed; none alone proves an authoritative assignment. Milestone 05 must source and validate actual assignment data, otherwise show “assignment unavailable.” Never infer assignment from proximity or an LLM.

ArcGIS Places requires a separate server credential with Places privilege. The runner resolves a grocery/supermarket category with one categories request, including verification of an optional supplied ID, then performs at most one near-point request. Places content is inspected in memory and discarded. Esri states that Places may not be permanently stored; no Places records go to PostgreSQL, fixtures, snapshots, logs, docs, or OpenAI. The browser key is basemap-only and is never used for Places.

OpenAI defaults are configurable `gpt-6-luna` and `low`, both documented for the Responses API. One tiny synthetic structured-output request has `store:false`, no tools, max 800 output tokens, an 8-second timeout, and SDK retries disabled. No fallback model or repair request is attempted. Actual usage is recorded only when returned. Authentication, permission, rate-limit, unsupported configuration, refusal, incomplete output, timeout, and malformed output remain distinct outcomes.
