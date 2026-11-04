import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

function layers(source: string): LayerSpecification[] {
  return [
    { id: `${source}-land`, type: "fill", source, "source-layer": "landcover", paint: { "fill-color": "#e0e9d5", "fill-opacity": 0.6 } },
    { id: `${source}-parks`, type: "fill", source, "source-layer": "landuse", filter: ["in", "class", "park", "cemetery", "wood"], paint: { "fill-color": "#d5e5ca", "fill-opacity": 0.7 } },
    { id: `${source}-water`, type: "fill", source, "source-layer": "water", paint: { "fill-color": "#c4deec" } },
    { id: `${source}-waterways`, type: "line", source, "source-layer": "waterway", paint: { "line-color": "#a6cddd", "line-width": 1.3 } },
    { id: `${source}-road-edge`, type: "line", source, "source-layer": "transportation", filter: ["!=", "class", "path"], paint: { "line-color": "#d4c9b5", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 14, 5] } },
    { id: `${source}-roads`, type: "line", source, "source-layer": "transportation", filter: ["!=", "class", "path"], paint: { "line-color": "#fffefa", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 14, 3] } },
    { id: `${source}-buildings`, type: "fill", source, "source-layer": "building", minzoom: 13, paint: { "fill-color": "#dedbd4", "fill-outline-color": "#c9c5bc" } },
    { id: `${source}-places`, type: "symbol", source, "source-layer": "place", layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, 13, 15], "text-max-width": 9 }, paint: { "text-color": "#394951", "text-halo-color": "#ffffff", "text-halo-width": 1.7 } },
    { id: `${source}-road-labels`, type: "symbol", source, "source-layer": "transportation_name", minzoom: 12, layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 11 }, paint: { "text-color": "#56616a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
  ];
}

export function offlineMapStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${origin}/maps/streets/fonts/{fontstack}/{range}.pbf`,
    sources: {
      overview: { type: "vector", tiles: [`${origin}/maps/streets/overview/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 8, bounds: [116.8, 4.5, 126.8, 21.2], attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org">OpenFreeMap</a> · OpenMapTiles' },
      mati: { type: "vector", tiles: [`${origin}/maps/streets/mati/{z}/{x}/{y}.pbf`], minzoom: 9, maxzoom: 14, bounds: [126.05, 6.7, 126.4, 7.18] },
    },
    layers: [{ id: "background", type: "background", paint: { "background-color": "#f4f3ed" } }, ...layers("overview"), ...layers("mati")],
  };
}
