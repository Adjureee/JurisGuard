# Offline client-address matcher fix

November 6, 2026. No client/database values or coordinates were changed.

## Causes

The previous matcher removed city qualifiers and searched every municipality name anywhere in the address. Thus Davao in a province name competed with an explicit city. Duplicate names such as Santa Maria had no province metadata to distinguish them. Backend Panabo barangay groups also lost their already-recorded city context when matched on the frontend.

## Changes

- Match explicit City/Municipality phrases and complete locality components instead of arbitrary substrings. Ignore barangay/purok labels as locality evidence. Check province context and reject conflicting locality/province evidence.
- Bundle an attributed offline city/province index for all 1,647 installed boundary shapes. It is built from the pinned [geoBoundaries PHL ADM2 source](https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM2/) using a unique province polygon covering at least 95% of a municipality polygon's area. Source and city-layer checksums are stored in the index. These are geographic labels for disambiguation, not legal provincial jurisdiction over independent cities.
- Recognize Davao de Oro as the current name for the source edition's Compostela Valley; support common Sto./Sta. spelling variants.
- Preserve structured group city hints for Panabo barangays, aggregation and selected-city outlines.
- Cache boundary indexes and the locality expression per immutable feature collection; no external geocoder, fuzzy guess, residential coordinate or cloud request is used.

The builder `scripts/build_city_province_index.py` requires Shapely only when regenerating the development asset. Application runtime uses the bundled JSON entirely offline. License/source details are in `frontend/public/maps/README.md` and the JSON metadata.

## Verification

| Check | Result |
|---|---|
| Fictional complete addresses | 12/100 before → 100/100 after |
| Current actual analytics groups | 101 clients counted → 101 matched |
| Fictional city/municipality aggregation | 100 clients across eight localities |
| Matcher regression tests | 8 passed |
| Rendered map | Selection outline, reset, desktop/mobile verified |
| Browser errors / remote map requests | 0 / 0 |
| Production build | Passed, existing bundle warnings remain |

Synthetic tests cover duplicate municipalities qualified by province, renamed provinces, province-only input, barangay names shared with municipalities, conflicting cities/provinces, city names containing shorter names, Panabo grouping, all 100 demo address combinations, and boundary/index checksum compatibility. CSV/XLSX verification still passes with the corrected matcher. Local screenshots and JSON reports are under `.local/synthetic-records/FICTIONAL-XI-20261106-V2/`.

Reproduce from the repository root, with Vite running on 127.0.0.1:5173 for browser checks:

```powershell
node --test tests/frontend/client_map_data.test.cjs
.\backend\venv\Scripts\python.exe scripts/verify_demo_map.py
.\backend\venv\Scripts\python.exe scripts/verify_demo_export.py
```

Full-project TypeScript validation remains blocked by pre-existing errors in CaseWorkflow, CriminalCases, dashboard analytics and StaffAnalyticsPage (missing/mismatched intake and analytics types). Those files are unchanged by this map fix. Map-specific dependency graph validation is checked separately. Production build does not perform a full typecheck.

Unqualified duplicate names, contradictory addresses, unknown places and unsupported source-edition metadata remain unmatched. The map locates city/municipality reference areas, not individual homes. The backend's optional barangay-point layer remains Panabo-only; the city map now reconciles the broader address counts using the nationwide offline boundary index.
