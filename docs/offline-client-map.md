# Offline client address map

The Analytics map uses MapLibre GL JS with locally served OpenMapTiles vector
tiles from OpenFreeMap. No client address is sent to a map provider. At runtime,
map sources, fonts, the worker, and administrative boundaries load from the
JurisGuard frontend origin. External source requests are rejected.

## Installed coverage

- Philippines overview: longitude 116.8–126.8, latitude 4.5–21.2, zoom 0–8.
- Mati detail: longitude 126.05–126.4, latitude 6.7–7.18, zoom 9–14.
- Outside the detail region the overview overzooms; it does not add street-level
  detail. This is not a complete nationwide street-level download.
- 704 tiles; initial download approximately 10.8 MB. Files are in
  `frontend/public/maps/streets/` and are copied into the frontend build.

Setup/recovery: `backend\venv\Scripts\python.exe scripts/download_offline_map.py`.
This explicit setup step requires internet; ordinary map viewing does not.
The downloader sends an identifying User-Agent and uses at most four download
threads, with a 3,000 tile / 50 MB package limit. It resumes existing files.

Source: https://tiles.openfreemap.org/planet (20261101_080013_pt build at setup).
Provider policy: https://openfreemap.org/ . Attribution: OpenFreeMap,
OpenMapTiles, OpenStreetMap contributors. OpenStreetMap data is licensed under
ODbL: https://www.openstreetmap.org/copyright . Glyphs are the provider's
Noto Sans Regular Latin range, from the Noto fonts (SIL Open Font License).
Administrative boundary source/license is documented in
`frontend/public/maps/README.md`.

## What the counts mean

The backend counts distinct accessible client profiles, including profiles
without cases. City polygons are matched conservatively against address text;
multiple matching cities remain unmatched. Several address groups in one city
are summed into one city count. City markers use the boundary bounding-box
center as an approximate city reference, not a residential coordinate.
No crime incidence, legal status, or precise home location is inferred.

Unselected city polygons are not shaded. Nearby city count markers cluster at
lower zoom levels, with cluster labels summing clients rather than cities.
Zooming in separates city markers; clicking a cluster zooms to its expansion
level. Only a selected city's outline is highlighted. Zoom controls and keyboard
zoom remain available without requiring a pointer click on a cluster.

The nationwide ADM3 layer supplies city/municipality outlines, not barangay
boundaries. Barangay text remains available in the address groups. Matching
still needs improvement for aliases, abbreviations, and repeated municipality
names; unresolved profiles stay listed and are excluded from mapped counts.

## Verification

`backend\venv\Scripts\python.exe tests/frontend/offline_map_browser_smoke.py`
mounts the actual map component with synthetic Mati clients in Edge, blocks
external requests, exercises reset, checks responsive overflow, and captures
desktop/mobile screenshots under ignored `.local/offline-map-review/`.
This tests the component without accessing legal records or credentials.
MapLibre requires a browser with WebGL support. The UI supplies recovery copy
when map initialization fails. Typecheck/build are also required.
