import { useEffect, useMemo, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type {
  BarangayStat,
  EnrichedGeoCase,
  HeatmapPoint,
  RawGeoCase,
} from "../../services/dashboardService";
import {
  buildLocalHeatmap,
  enrichCasesWithCoordinates,
} from "../../services/dashboardService";
import {
  getPanaboCoordinate,
  PANABO_CITY_HALL_COORDINATES,
} from "../../utils/panaboCoordinates";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

type CaseStatus = "Active" | "Pending" | "Terminated" | string;

interface CaseMapPoint {
  id: number | string;
  clientName: string;
  barangay: string;
  caseType: string;
  caseStatus: CaseStatus;
  latitude: number;
  longitude: number;
  source: "coordinates" | "barangay";
  weight: number;
}

interface GeoAnalyticsMapProps {
  cases?: RawGeoCase[];
  center?: { lat: number; lng: number };
  points?: HeatmapPoint[];
  barangays?: BarangayStat[];
  selectedBarangay?: string | null;
  onSelectBarangay?: (barangay: string) => void;
  tileLayerUrl?: string;
}

const STATUS_STYLE: Record<
  string,
  { stroke: string; fill: string; label: string; badge: string }
> = {
  active: {
    stroke: "#23875C",
    fill: "#6EE7B7",
    label: "Active",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  pending: {
    stroke: "#D97706",
    fill: "#FCD34D",
    label: "Pending",
    badge: "bg-amber-50 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-400/30",
  },
  terminated: {
    stroke: "#DC2626",
    fill: "#FCA5A5",
    label: "Terminated",
    badge: "bg-red-50 dark:bg-red-400/10 text-red-700 dark:text-red-300 ring-red-200 dark:ring-red-400/30",
  },
};

function statusStyle(status: CaseStatus) {
  return STATUS_STYLE[String(status).trim().toLowerCase()] ?? STATUS_STYLE.pending;
}

function getTileLayerConfig(explicitUrl?: string) {
  const configuredUrl = explicitUrl || import.meta.env.VITE_LEAFLET_TILE_URL;
  const forceOfflineTiles = import.meta.env.VITE_LEAFLET_OFFLINE_TILES === "true";

  if (configuredUrl || forceOfflineTiles) {
    return {
      attribution: "Local OSM tiles",
      url: configuredUrl || "/tiles/{z}/{x}/{y}.png",
    };
  }

  return {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  };
}

function isValidCoordinate(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function toCoordinateNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createClusterIcon(total: number, terminated: number) {
  const color = terminated > 0 && terminated === total ? "#DC2626" : "#23875C";
  return L.divIcon({
    className: "",
    html: `<div style="height:38px;width:38px;border-radius:999px;background:${color};color:white;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 12px 26px rgba(17,24,39,.25);font-size:13px;font-weight:800">${total}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function HeatLayer({ points }: { points: CaseMapPoint[] }) {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (points.length === 0) return;

    const leafletWithHeat = L as typeof L & {
      heatLayer?: (
        data: Array<[number, number, number]>,
        options: Record<string, unknown>,
      ) => L.Layer;
    };

    if (typeof leafletWithHeat.heatLayer !== "function") return;

    const heatLayer = leafletWithHeat.heatLayer(
      points.map((point) => [point.latitude, point.longitude, point.weight]),
      {
        radius: 34,
        blur: 26,
        minOpacity: 0.35,
        gradient: {
          0.2: "#14B8A6",
          0.45: "#22C55E",
          0.7: "#F59E0B",
          1: "#DC2626",
        },
      },
    );

    heatLayer.addTo(map);
    layerRef.current = heatLayer;

    return () => {
      map.removeLayer(heatLayer);
      layerRef.current = null;
    };
  }, [map, points]);

  return null;
}

function FocusBarangay({
  barangay,
  stats,
}: {
  barangay: string | null;
  stats: BarangayStat[];
}) {
  const map = useMap();

  useEffect(() => {
    if (!barangay) return;
    const target = stats.find((item) => item.barangay === barangay);
    if (target?.latitude && target.longitude) {
      map.flyTo([target.latitude, target.longitude], 13, { duration: 0.8 });
    }
  }, [barangay, map, stats]);

  return null;
}

function ResizeMapWhenReady() {
  const map = useMap();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [map]);

  return null;
}

function toCaseMapPoint(record: EnrichedGeoCase): CaseMapPoint {
  return {
    id: record.case_id,
    clientName: record.client_name,
    barangay: record.barangay,
    caseType: record.case_type,
    caseStatus: record.case_status,
    latitude: record.latitude,
    longitude: record.longitude,
    source:
      record.coordinate_source === "case_coordinates" ? "coordinates" : "barangay",
    weight: record.case_status.toLowerCase() === "terminated" ? 0.65 : 1,
  };
}

function heatmapPointToCaseMapPoint(point: HeatmapPoint): CaseMapPoint {
  const fallback = getPanaboCoordinate(point.barangay);
  const latitude = toCoordinateNumber(point.latitude) ?? fallback.lat;
  const longitude = toCoordinateNumber(point.longitude) ?? fallback.lng;

  return {
    id: point.case_id,
    clientName: "Case record",
    barangay: point.barangay,
    caseType: point.category,
    caseStatus: point.status,
    latitude,
    longitude,
    source: point.source,
    weight: point.weight,
  };
}

export default function GeoAnalyticsMap({
  cases,
  center,
  points = [],
  barangays = [],
  selectedBarangay = null,
  onSelectBarangay,
  tileLayerUrl,
}: GeoAnalyticsMapProps) {
  const enrichedCases = useMemo(
    () => (cases?.length ? enrichCasesWithCoordinates(cases) : []),
    [cases],
  );

  const localHeatmap = useMemo(
    () => (enrichedCases.length ? buildLocalHeatmap(enrichedCases) : null),
    [enrichedCases],
  );

  const safeCenter =
    center && isValidCoordinate(center.lat, center.lng)
      ? center
      : localHeatmap?.center ?? PANABO_CITY_HALL_COORDINATES;

  const mappedBarangays = useMemo(() => {
    const source = localHeatmap?.barangays ?? barangays;
    return source
      .map((item) => {
        const fallback = getPanaboCoordinate(item.barangay);
        const latitude = toCoordinateNumber(item.latitude) ?? fallback.lat;
        const longitude = toCoordinateNumber(item.longitude) ?? fallback.lng;

        return {
          ...item,
          latitude,
          longitude,
        };
      })
      .filter((item) => isValidCoordinate(item.latitude, item.longitude));
  }, [barangays, localHeatmap]);

  const mappedPoints = useMemo(() => {
    const source = enrichedCases.length
      ? enrichedCases.map(toCaseMapPoint)
      : points.map(heatmapPointToCaseMapPoint);

    return source.filter((point) =>
      isValidCoordinate(point.latitude, point.longitude),
    );
  }, [enrichedCases, points]);

  const visiblePoints = useMemo(
    () =>
      selectedBarangay
        ? mappedPoints.filter((point) => point.barangay === selectedBarangay)
        : mappedPoints,
    [mappedPoints, selectedBarangay],
  );

  const tileLayer = getTileLayerConfig(tileLayerUrl);

  return (
    <div className="relative z-0 overflow-hidden rounded-lg border border-line bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card-2 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            PAO Case Distribution
          </p>
          <p className="text-xs text-muted">
            Local barangay geocoding, no external geocoding API required
          </p>
        </div>
        <div className="flex gap-2 text-xs font-semibold">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 ring-1 ring-blue-200">
            Active
          </span>
          <span className="rounded-full bg-amber-50 dark:bg-amber-400/10 px-2.5 py-1 text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-400/30">
            Pending
          </span>
          <span className="rounded-full bg-red-50 dark:bg-red-400/10 px-2.5 py-1 text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/30">
            Terminated
          </span>
        </div>
      </div>

      <div className="relative z-0 h-[460px] min-h-[360px]">
        <MapContainer
          center={[safeCenter.lat, safeCenter.lng]}
          zoom={12}
          scrollWheelZoom
          className="z-0 h-full w-full"
        >
          <ResizeMapWhenReady />
          <TileLayer
            attribution={tileLayer.attribution}
            url={tileLayer.url}
            minZoom={10}
            maxZoom={18}
          />
          <HeatLayer points={visiblePoints} />
          <FocusBarangay barangay={selectedBarangay} stats={mappedBarangays} />

          {mappedBarangays.map((barangay) => (
            <Marker
              key={barangay.barangay}
              position={[barangay.latitude ?? safeCenter.lat, barangay.longitude ?? safeCenter.lng]}
              icon={createClusterIcon(
                barangay.total_cases,
                barangay.terminated_cases,
              )}
              eventHandlers={{
                click: () => onSelectBarangay?.(barangay.barangay),
              }}
            >
              <Popup>
                <div className="min-w-52">
                  <p className="text-sm font-bold text-ink">
                    {barangay.barangay}
                  </p>
                  <p className="text-xs text-muted">{barangay.city}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-brand-50 dark:bg-brand-400/10 p-2">
                      <p className="text-base font-bold text-brand-600 dark:text-brand-400">
                        {barangay.total_cases}
                      </p>
                      <p className="text-[10px] uppercase text-brand-700 dark:text-brand-300">
                        Total
                      </p>
                    </div>
                    <div className="rounded-lg bg-brand-50 dark:bg-brand-400/10 p-2">
                      <p className="text-base font-bold text-brand-600 dark:text-brand-400">
                        {barangay.active_cases}
                      </p>
                      <p className="text-[10px] uppercase text-brand-600 dark:text-brand-400">
                        Active
                      </p>
                    </div>
                    <div className="rounded-lg bg-red-100 dark:bg-red-400/15 p-2">
                      <p className="text-base font-bold text-red-800 dark:text-red-300">
                        {barangay.terminated_cases}
                      </p>
                      <p className="text-[10px] uppercase text-red-800 dark:text-red-300">
                        Closed
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Common type:{" "}
                    <span className="font-semibold">
                      {barangay.most_common_category}
                    </span>
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}

          {visiblePoints.slice(0, 250).map((point) => {
            const style = statusStyle(point.caseStatus);

            return (
              <CircleMarker
                key={`${point.id}-${point.latitude}-${point.longitude}`}
                center={[point.latitude, point.longitude]}
                radius={point.source === "coordinates" ? 7 : 5}
                pathOptions={{
                  color: style.stroke,
                  fillColor: style.fill,
                  fillOpacity: 0.78,
                  weight: 2,
                }}
              >
                <Tooltip direction="top" offset={[0, -4]} opacity={0.95}>
                  <span className="text-xs font-semibold">
                    {point.clientName}
                  </span>
                </Tooltip>
                <Popup>
                  <div className="min-w-56">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-ink">
                          {point.clientName}
                        </p>
                        <p className="text-xs text-muted">
                          {point.barangay}, Panabo City
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${style.badge}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    <div className="mt-3 rounded-lg border border-line bg-card-2 p-3">
                      <p className="text-[11px] font-semibold uppercase text-muted">
                        Case Type
                      </p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {point.caseType}
                      </p>
                    </div>
                    <p className="mt-2 text-[11px] text-muted">
                      Coordinate source:{" "}
                      {point.source === "coordinates"
                        ? "encoded coordinates"
                        : "local barangay dictionary"}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
