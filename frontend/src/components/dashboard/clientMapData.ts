import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { BarangayStat } from "../../services/dashboardService";

function normalized(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(city|municipality|of)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchAddressCity(address: string, boundaries: FeatureCollection) {
  const value = ` ${normalized(address)} `;
  const matches = boundaries.features.filter((feature) => {
    const name = normalized(String(feature.properties?.shapeName ?? ""));
    return name.length > 2 && value.includes(` ${name} `);
  });
  return matches.length === 1 ? matches[0] : null;
}

export function cityClientFeatures(groups: BarangayStat[], boundaries: FeatureCollection) {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const city = matchAddressCity(group.barangay, boundaries);
    if (city) {
      const id = String(city.properties?.shapeID);
      counts.set(id, (counts.get(id) ?? 0) + group.total_cases);
    }
  }
  const features: Feature<Geometry>[] = boundaries.features.map((feature) => ({ ...feature,
    properties: { ...feature.properties, clientCount: counts.get(String(feature.properties?.shapeID)) ?? 0 },
  }));
  return { type: "FeatureCollection" as const, features };
}
