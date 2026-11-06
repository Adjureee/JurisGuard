import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { BarangayStat } from "../../services/dashboardService";
import provinceData from './cityProvinceIndex.json';

function words(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\bsto\.?\b/g, 'santo').replace(/\bsta\.?\b/g, 'santa')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function localityName(value: string) {
  return words(value).replace(/\b(city|municipality|of|philippines)\b/g, '')
    .replace(/\b\d{4}\b$/, '').trim().replace(/\s+/g, ' ');
}

function provinceName(value: string) {
  const name = words(value).replace(/\b(province|of|philippines)\b/g, '').trim().replace(/\s+/g, ' ');
  // The source boundary edition predates this province's rename.
  return name === 'davao de oro' ? 'compostela valley' : name;
}

type CityIndex = {
  names: Map<string, Feature[]>;
  explicit: RegExp;
  provinces: Set<string>;
};
const indexes = new WeakMap<FeatureCollection, CityIndex>();

function parentProvince(feature: Feature) {
  const properties = feature.properties;
  const parents: Record<string, string> = provinceData.parents;
  // Explicit fixture/import metadata takes precedence over the packaged index.
  return provinceName(String(properties?.province ?? parents[String(properties?.shapeID)] ?? ''));
}

function indexFor(boundaries: FeatureCollection) {
  const cached = indexes.get(boundaries);
  if (cached) return cached;
  const names = new Map<string, Feature[]>();
  const provinces = new Set<string>();
  for (const feature of boundaries.features) {
    const name = localityName(String(feature.properties?.shapeName ?? ''));
    if (name.length < 3) continue;
    names.set(name, [...(names.get(name) ?? []), feature]);
    const province = parentProvince(feature);
    if (province) provinces.add(province);
  }
  // Longest alternatives first preserve names such as San Jose del Monte.
  // One cached expression avoids scanning thousands of patterns per address.
  const alternatives = [...names.keys()].sort((a,b) => b.length-a.length).join('|') || '(?!)';
  const explicit = new RegExp(`(?:^| )(?:city of |municipality of )(?<prefix>${alternatives})(?= |$)|(?:^| )(?<suffix>${alternatives}) (?:city|municipality)(?= |$)`, 'g');
  const index = { names, explicit, provinces };
  indexes.set(boundaries, index);
  return index;
}

/** Resolve only positive locality evidence. Never match a city inside a province
 * or choose arbitrarily among duplicate municipality names. */
export function matchAddressCity(address: string, boundaries: FeatureCollection, cityHint = '') {
  const index = indexFor(boundaries);
  const segments = address.split(/[,;\n]/).map(words).filter(Boolean);
  const barangayWithCityHint = Boolean(cityHint && segments.length === 1 && !/\b(city|municipality|province)\b/.test(segments[0]));
  const provinces = new Set(barangayWithCityHint ? [] : segments.filter((segment, position) =>
    !index.names.has(localityName(segment)) || position === segments.length-1 || /^province\b/.test(segment))
    .map(provinceName).filter(name => index.provinces.has(name)));
  const provinceTails = [...index.provinces, 'davao de oro'].sort((a,b)=>b.length-a.length);
  const localitySegments = segments.map(segment => {
    if (barangayWithCityHint || index.provinces.has(provinceName(segment)) || index.names.has(localityName(segment))
      || (/^(?:purok|prk|sitio|barangay|brgy|bgy)\b/.test(segment) && !/\b(city|municipality)\b/.test(segment))) return segment;
    const tail = provinceTails.find(name => segment.endsWith(` ${name}`)
      && !segment.slice(0, -name.length).trimEnd().endsWith('city of')
      && !segment.slice(0, -name.length).trimEnd().endsWith('municipality of'));
    if (tail) {
      provinces.add(provinceName(tail));
      return segment.slice(0,-tail.length).trim();
    }
    return segment;
  }).filter(segment => !provinces.has(provinceName(segment)) && !/^province\b/.test(segment));
  if (provinces.size > 1) return null;
  const explicit = new Set<string>();
  // Explicit "City of …" / "… City" also works in unpunctuated addresses.
  for (const segment of localitySegments) {
    for (const match of segment.matchAll(index.explicit)) explicit.add(match.groups!.prefix ?? match.groups!.suffix);
  }
  if (explicit.size > 1) return null;
  const hint = localityName(cityHint);
  const names = explicit.size ? explicit : hint && index.names.has(hint) ? new Set([hint]) : new Set(localitySegments
    .filter(segment => !/^(?:purok|prk|sitio|barangay|brgy|bgy)\b/.test(segment))
    .map(localityName).filter(name => index.names.has(name)));
  if (hint && index.names.has(hint)) {
    if (names.size && !names.has(hint)) return null;
    names.add(hint);
  }
  if (names.size !== 1) return null;
  const province = [...provinces][0];
  const candidates = (index.names.get([...names][0]) ?? [])
    .filter(feature => !province || parentProvince(feature) === province);
  return candidates.length === 1 ? candidates[0] : null;
}

export function cityClientFeatures(groups: BarangayStat[], boundaries: FeatureCollection) {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const city = matchAddressCity(group.barangay, boundaries, group.city);
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
