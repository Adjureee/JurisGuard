import { useEffect, useState } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection } from "geojson";

function cityName(value: string) {
  return value.toLowerCase().replace(/\b(city|of|municipality)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export default function OfflineBoundaries({ address }: { address: string | null }) {
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  const map = useMap();
  useEffect(() => {
    const controller = new AbortController();
    fetch("/maps/philippines-cities.geojson", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Missing boundaries"); return response.json(); })
      .then(setData).catch((error) => { if (error.name !== "AbortError") setFailed(true); });
    return () => controller.abort();
  }, []);
  const normalizedAddress = ` ${cityName(address ?? "")} `;
  const matches = data?.features.filter((feature) => {
    const name = cityName(String(feature.properties?.shapeName ?? ""));
    return name.length > 2 && normalizedAddress.includes(` ${name} `);
  }) ?? [];
  const selected = matches.length === 1 ? matches[0] : null;
  useEffect(() => {
    if (selected) map.fitBounds(L.geoJSON(selected).getBounds(), { padding: [35, 35] });
  }, [map, selected]);
  if (failed) return null;
  return data ? <GeoJSON key={selected?.properties?.shapeID ?? "all"} data={data}
    style={(feature) => ({ color: "#64748b", weight: 1, fillColor: feature === selected ? "#704389" : "#e2e8d5", fillOpacity: feature === selected ? 0.6 : 0.85 })}
    onEachFeature={(feature, layer) => {
      const label = document.createElement("span");
      label.textContent = `${feature.properties?.shapeName ?? "City / Municipality"} — city/municipality boundary`;
      layer.bindTooltip(label);
    }} /> : null;
}
