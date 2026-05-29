import { useEffect, useMemo, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { BarangayStat, HeatmapPoint } from "../../services/dashboardService";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface GeoAnalyticsMapProps {
  center: { lat: number; lng: number };
  points: HeatmapPoint[];
  barangays: BarangayStat[];
  selectedBarangay: string | null;
  onSelectBarangay: (barangay: string) => void;
}

function createClusterIcon(total: number, terminated: number) {
  const color = terminated > 0 && terminated === total ? "#DC2626" : "#2F80ED";
  return L.divIcon({
    className: "",
    html: `<div style="height:38px;width:38px;border-radius:999px;background:${color};color:white;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 12px 26px rgba(17,24,39,.25);font-size:13px;font-weight:800">${total}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function HeatLayer({ points }: { points: HeatmapPoint[] }) {
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
        options: Record<string, unknown>
      ) => L.Layer;
    };
    if (typeof leafletWithHeat.heatLayer !== "function") {
      return;
    }
    const heatPoints = points.map((point) => [point.latitude, point.longitude, point.weight] as [number, number, number]);
    const heatLayer = leafletWithHeat.heatLayer(heatPoints, {
      radius: 34,
      blur: 26,
      minOpacity: 0.35,
      gradient: {
        0.2: "#60A5FA",
        0.45: "#22C55E",
        0.7: "#F59E0B",
        1: "#DC2626",
      },
    });
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

export default function GeoAnalyticsMap({
  center,
  points,
  barangays,
  selectedBarangay,
  onSelectBarangay,
}: GeoAnalyticsMapProps) {
  const safeCenter = Number.isFinite(center.lat) && Number.isFinite(center.lng)
    ? center
    : { lat: 7.3081, lng: 125.6841 };
  const mappedBarangays = useMemo(
    () => barangays.filter((item) => item.latitude !== null && item.longitude !== null),
    [barangays]
  );
  const selectedPoints = useMemo(
    () =>
      selectedBarangay
        ? points.filter((point) => point.barangay === selectedBarangay)
        : points,
    [points, selectedBarangay]
  );

  return (
    <div className="overflow-hidden rounded-lg border border-[#D1D5DB] bg-white">
      <div className="h-[460px]">
        <MapContainer
          center={[safeCenter.lat, safeCenter.lng]}
          zoom={11}
          scrollWheelZoom
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <HeatLayer points={selectedPoints} />
          <FocusBarangay barangay={selectedBarangay} stats={barangays} />
          {mappedBarangays.map((barangay) => (
            <Marker
              key={barangay.barangay}
              position={[barangay.latitude ?? safeCenter.lat, barangay.longitude ?? safeCenter.lng]}
              icon={createClusterIcon(barangay.total_cases, barangay.terminated_cases)}
              eventHandlers={{ click: () => onSelectBarangay(barangay.barangay) }}
            >
              <Popup>
                <div className="min-w-52">
                  <p className="text-sm font-bold text-[#111827]">{barangay.barangay}</p>
                  <p className="text-xs text-[#6B7280]">{barangay.city}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-[#EFF6FF] p-2">
                      <p className="text-base font-bold text-[#1D4ED8]">{barangay.total_cases}</p>
                      <p className="text-[10px] uppercase text-[#1E40AF]">Total</p>
                    </div>
                    <div className="rounded-md bg-[#DCFCE7] p-2">
                      <p className="text-base font-bold text-[#166534]">{barangay.active_cases}</p>
                      <p className="text-[10px] uppercase text-[#166534]">Active</p>
                    </div>
                    <div className="rounded-md bg-[#FEE2E2] p-2">
                      <p className="text-base font-bold text-[#991B1B]">{barangay.terminated_cases}</p>
                      <p className="text-[10px] uppercase text-[#991B1B]">Closed</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-[#374151]">
                    Common type: <span className="font-semibold">{barangay.most_common_category}</span>
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
          {selectedPoints.slice(0, 100).map((point) => (
            <CircleMarker
              key={`${point.case_id}-${point.latitude}-${point.longitude}`}
              center={[point.latitude, point.longitude]}
              radius={point.source === "coordinates" ? 5 : 3}
              pathOptions={{
                color: point.status === "Terminated" ? "#DC2626" : "#2563EB",
                fillColor: point.status === "Terminated" ? "#FCA5A5" : "#93C5FD",
                fillOpacity: 0.55,
                weight: 1,
              }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
