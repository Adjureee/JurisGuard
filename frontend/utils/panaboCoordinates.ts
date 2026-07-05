export interface GeoCoordinate {
  lat: number;
  lng: number;
}

export const PANABO_CITY_HALL_COORDINATES: GeoCoordinate = {
  lat: 7.3004,
  lng: 125.6826,
};

export const PANABO_COORDINATES: Record<string, GeoCoordinate> = {
  "A. O. Floirendo": { lat: 7.3977, lng: 125.5802 },
  Buenavista: { lat: 7.2756, lng: 125.5907 },
  Cacao: { lat: 7.3083, lng: 125.6077 },
  Cagangohan: { lat: 7.2815, lng: 125.6829 },
  Consolacion: { lat: 7.3169, lng: 125.5538 },
  Dapco: { lat: 7.3921, lng: 125.5983 },
  "Datu Abdul Dadia": { lat: 7.3153, lng: 125.6548 },
  Gredu: { lat: 7.2957, lng: 125.6776 },
  "J. P. Laurel": { lat: 7.2759, lng: 125.67 },
  Kasilak: { lat: 7.3268, lng: 125.5951 },
  Katipunan: { lat: 7.3007, lng: 125.6306 },
  Katualan: { lat: 7.2301, lng: 125.5543 },
  Kauswagan: { lat: 7.3102, lng: 125.5831 },
  Kiotoy: { lat: 7.2443, lng: 125.6077 },
  "Little Panay": { lat: 7.2979, lng: 125.6482 },
  "Lower Panaga": { lat: 7.432, lng: 125.564 },
  Mabunao: { lat: 7.2543, lng: 125.5745 },
  Maduao: { lat: 7.2796, lng: 125.6433 },
  Malativas: { lat: 7.2936, lng: 125.5648 },
  Manay: { lat: 7.3456, lng: 125.6022 },
  Nanyo: { lat: 7.3329, lng: 125.6361 },
  "New Malaga": { lat: 7.3442, lng: 125.5725 },
  "New Malitbog": { lat: 7.3339, lng: 125.6209 },
  "New Pandan": { lat: 7.2973, lng: 125.6801 },
  "New Visayas": { lat: 7.3081, lng: 125.6682 },
  Quezon: { lat: 7.3327, lng: 125.6795 },
  Salvacion: { lat: 7.3182, lng: 125.6882 },
  "San Francisco": { lat: 7.3068, lng: 125.6803 },
  "San Nicolas": { lat: 7.2626, lng: 125.6181 },
  "San Pedro": { lat: 7.2973, lng: 125.7106 },
  "San Roque": { lat: 7.2552, lng: 125.5533 },
  "San Vicente": { lat: 7.3088, lng: 125.7003 },
  "Santa Cruz": { lat: 7.2365, lng: 125.5896 },
  "Santo Niño": { lat: 7.3082, lng: 125.6867 },
  Sindaton: { lat: 7.4396, lng: 125.5842 },
  "Southern Davao": { lat: 7.3323, lng: 125.6577 },
  Tagpore: { lat: 7.2743, lng: 125.625 },
  Tibungol: { lat: 7.3947, lng: 125.5555 },
  "Upper Licanan": { lat: 7.2856, lng: 125.6325 },
  Waterfall: { lat: 7.2886, lng: 125.5834 },
};

const BARANGAY_ALIASES: Record<string, string> = {
  "ao floirendo": "A. O. Floirendo",
  "a o floirendo": "A. O. Floirendo",
  floirendo: "A. O. Floirendo",
  "datu abdul dadia": "Datu Abdul Dadia",
  gredu: "Gredu",
  poblacion: "Gredu",
  "gredu poblacion": "Gredu",
  "j p laurel": "J. P. Laurel",
  "jp laurel": "J. P. Laurel",
  laurel: "J. P. Laurel",
  "new pandan": "New Pandan",
  pandan: "New Pandan",
  "new visayas": "New Visayas",
  "san francisco": "San Francisco",
  "san nicolas": "San Nicolas",
  "san pedro": "San Pedro",
  "san roque": "San Roque",
  "san vicente": "San Vicente",
  "santa cruz": "Santa Cruz",
  "santo nino": "Santo Niño",
  "santo niño": "Santo Niño",
  "sto nino": "Santo Niño",
  "sto niño": "Santo Niño",
  "sto. nino": "Santo Niño",
  "sto. niño": "Santo Niño",
  "upper licanan": "Upper Licanan",
  "lower panaga": "Lower Panaga",
  "little panay": "Little Panay",
};

export function normalizeBarangayName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(brgy|barangay|pob|poblacion)\b/gi, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function resolvePanaboBarangay(value: string | null | undefined): string | null {
  const normalized = normalizeBarangayName(value);
  if (!normalized) return null;

  if (BARANGAY_ALIASES[normalized]) {
    return BARANGAY_ALIASES[normalized];
  }

  const exactMatch = Object.keys(PANABO_COORDINATES).find(
    (barangay) => normalizeBarangayName(barangay) === normalized,
  );
  if (exactMatch) return exactMatch;

  return (
    Object.keys(PANABO_COORDINATES).find((barangay) => {
      const candidate = normalizeBarangayName(barangay);
      return candidate.includes(normalized) || normalized.includes(candidate);
    }) ?? null
  );
}

export function getPanaboCoordinate(value: string | null | undefined): GeoCoordinate {
  const barangay = resolvePanaboBarangay(value);
  return barangay ? PANABO_COORDINATES[barangay] : PANABO_CITY_HALL_COORDINATES;
}
