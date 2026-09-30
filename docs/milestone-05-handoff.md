# Milestone 05 handoff: Assigned Schools and Grocery

## Delivered

- `GET /api/properties/:id/assigned-schools` and shared assigned-school contract. Production returns `ASSIGNMENT_UNAVAILABLE` because no verified RentCast attendance assignment source is established. The UI displays “Assigned school information is unavailable for this property.” No nearby schools are labeled assigned.
- A future-ready `VerifiedAssignmentSource` boundary and optional `SchoolReferenceSource`. Reference matching uses exact source ID, name plus district, then name plus city. Ambiguous or absent reference matches remain unmatched; reference data never supplies assignment identity. No CDE dataset or import is present.
- `GET /api/properties/:id/nearby-places?category=grocery` through server-only ArcGIS Places credentials. One category request and one bounded near-point request return normalized display fields only. Results are transient and sent with `Cache-Control: no-store`. No repository write or permanent cache path receives Places payloads.
- Dashboard context list and a dedicated context GraphicsLayer. Schools and Grocery can show normalized list entries and markers; switching or turning off clears the active context. Subject, sales, and listing layers remain visible. Wildfire and Faults remain deferred.

## Verification

Mocked unit, UI, and browser tests cover assignment unavailable, conservative matching, category selection, server-only key placement, allowlist normalization, no repository writes, layer switching, marker/list selection, and preservation of core markers. Typecheck, lint, test, build, and browser test outcomes are recorded in the task response.

## Remaining provider dependency

The [RentCast property schema](https://developers.rentcast.io/reference/property-data-schema) does not establish a verified attendance assignment contract. Before enabling schools in production, verify an authoritative property-specific assignment source and its meaning, then connect it to `VerifiedAssignmentSource`. Only after that should an official school reference source be selected and documented with URL, version, and used fields. No school location or assignment is inferred from proximity.

ArcGIS Places [categories](https://developers.arcgis.com/rest/places/categories-get/) and [near-point](https://developers.arcgis.com/rest/places/near-point-get/) request shapes are implemented from official documentation. Live key privilege, response shape, and coverage have not been checked. Existing ignored local credentials were left untouched.
