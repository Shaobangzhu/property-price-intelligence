# Milestone 06 handoff: wildfire and earthquake fault context

Completed 2026-09-29. Dashboard now has four mutually exclusive context selectors; all can be off. Subject, recorded-sale, and active-listing markers remain independent of context. Offer and Listing stay disabled, and no hazard data changes pricing.

| Context | Source | Geometry | Meaning | Pricing effect |
| --- | --- | --- | --- | --- |
| Schools | Verified assignment source, then optional reference enrichment | Point when an assignment is verified | Assigned schools; currently unavailable because the provider contract does not verify assignments | None |
| Grocery | ArcGIS Places, requested through Express | Point | Nearby Grocery Store or Supermarket results, never school or subject data | None |
| Wildfire | CAL FIRE SRA and 2025 LRA Fire Hazard Severity Zones | Polygon | Subject intersection with displayed Moderate, High, or Very High hazard zone; LRA data is recommended, SRA designation is effective | None |
| Faults | California Geological Survey 2010 Fault Activity Map, Quaternary Faults | Polyline | Nearest returned mapped fault trace within 20 miles and approximate point-to-line distance | None |

## Verified government layers and semantics

- [CAL FIRE responsibility-area layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/SRA_for_FHSZ_in_LRA/FeatureServer/0): layer 0, polygons, `SRA` field with SRA/LRA/FRA; California responsibility coverage, SRA25_1 dated 2024-11-15. It chooses which Fire Hazard Severity Zone layer to check.
- [CAL FIRE SRA Fire Hazard Severity Zones](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSZSRA_23_3/FeatureServer/0): layer 0, polygons, `FHSZ_Description` and `SRA`; statewide SRA, map dated 2023-09-29, effective 2024-04-01. The displayed classes are Moderate, High, and Very High.
- [CAL FIRE 2025 LRA Fire Hazard Severity Zone recommendations](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSALRA25_v1_All/FeatureServer/0): layer 0, polygons, `FHSZ_Description` and `SRA`; all LRA phases dated 2025-03-24. Local adoption may differ. A `NonWildland` response is outside the **displayed zone**, without any safety conclusion.
- [CGS Fault Activity Map of California, Quaternary Faults](https://gis.conservation.ca.gov/server/rest/services/CGS/FaultActivityMapCA/FeatureServer/21): layer 21, polylines, `FLT_NAME`, `OBJECTID`, `RuleID`; California mapped traces from the 2010 map at 1:750,000 scale. These are not Alquist-Priolo Earthquake Fault Zones or earthquake probabilities.

[CAL FIRE's FHSZ explanation](https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones) distinguishes hazard from risk. The UI uses the source terminology and the disclaimer “Map context is informational and is not an engineering, insurance, or hazard assessment.” It never claims a property is safe.

## Runtime and data boundaries

The server checks only a saved subject point on demand. Wildfire uses a responsibility-area point intersection followed by one applicable zone point intersection. Faults queries within 20 miles, caps returned features, rejects a truncated response, and computes the closest line-segment distance in a local tangent plane. Both routes provide no-coordinates, no-coverage/no-nearby, and unavailable states, source/version, and checked time. Queries have an eight-second timeout and do not log or persist raw source features. Responses use `Cache-Control: no-store`.

The browser draws CAL FIRE polygons from bounded viewport queries, capped at 500 features per source, with an eight-second timeout. The official CGS line layer is active only for Faults. Switching contexts aborts/clears wildfire geometry and removes fault lines; the same `MapView` and core graphics remain. No government dataset is copied into PostgreSQL, no ArcGIS Places record enters these contexts, and no LLM performs geospatial calculations.

## Validation

- Mocked provider tests cover inside, outside (`NonWildland`), no coverage, unavailable, nearest point-to-segment distance, no nearby traces, and truncated fault responses. API and UI tests cover the routes, context switching, source/version text, inactive layers, and persistent core markers. Automated tests make no external GIS calls.
- Live public-service check used **San Francisco City Hall**, 1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102, at approximately 37.7793, -122.4193. The official responsibility query returned LRA; the applicable CAL FIRE LRA point query returned `NonWildland`, and the app normalized it to “Outside the currently displayed hazard zone.” The official CGS 20-mile line query returned Serra fault as the nearest mapped trace, approximately 7.13 miles by the server's segment calculation. No property was saved for this check.
- Browser check at `http://localhost:5173` used a mocked City Hall subject and normalized context responses, with real basemap and public government geometry. The subject marker and basemap rendered without a map or overlay error. Panning the Wildfire map to the Berkeley hills showed classified CAL FIRE polygons; a live CAL FIRE SRA point query at approximately 37.85, -122.2 returned Very High, matching the displayed area. Panning Faults to the northern Peninsula showed the official purple CGS trace. A final browser check used a clearly labeled synthetic Berkeley map point at those coordinates: the subject marker appeared inside the displayed Very High polygon, with no map or overlay error. The source labels, versions, outside-zone wording, and nearest-fault distance were visible in the relevant checks. These browser checks did not call RentCast or use the server Places key.

Verification commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`, and `git diff --check`.

## Remaining boundaries

The 2025 LRA layer shows state recommendations, not a verified local ordinance adoption. The CGS source is a regional-scale 2010 trace map; reported distance is approximate and does not determine a legal fault-zone intersection. A point outside a displayed FHSZ, or a point with no returned nearby fault, is not a safety finding. Pricing and AI analysis remain for later milestones.
