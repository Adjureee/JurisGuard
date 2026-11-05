import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { FeatureCollection } from "geojson";
import { Expand, RotateCcw } from "lucide-react";
import type { GeoAnalyticsMapProps } from "./GeoAnalyticsMap";
import { offlineMapStyle } from "./offlineMapStyle";
import { cityClientFeatures, matchAddressCity } from "./clientMapData";

maplibregl.setWorkerUrl(workerUrl);

function geometryBounds(feature: GeoJSON.Feature) {
  const bounds = new maplibregl.LngLatBounds();
  function visit(value: unknown) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") bounds.extend([value[0], value[1]]);
    else value.forEach(visit);
  }
  if (feature.geometry && "coordinates" in feature.geometry) visit(feature.geometry.coordinates);
  return bounds;
}

export default function ClientAddressMap({ barangays = [], selectedBarangay, onSelectBarangay }: GeoAnalyticsMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const focusBounds = useRef<maplibregl.LngLatBounds | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [boundaries, setBoundaries] = useState<FeatureCollection | null>(null);
  const [hovered, setHovered] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/maps/philippines-cities.geojson", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("City boundaries are missing. Restore the local maps package and reload."); return response.json(); })
      .then(setBoundaries).catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!container.current) return;
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({ container: container.current, style: offlineMapStyle(window.location.origin), center: [123, 12], zoom: 4.5,
        maxBounds: [[115, 3], [129, 23]], maxZoom: 16, attributionControl: { compact: true },
        transformRequest: (url) => {
          if (new URL(url, window.location.origin).origin !== window.location.origin) throw new Error("Remote map requests are disabled");
          return { url };
        },
      });
    } catch {
      setError("The map needs WebGL. Enable hardware acceleration in your browser, then reload. Client address counts remain available beside the map.");
      return;
    }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    instance.on("load", () => setReady(true));
    instance.on("error", (event) => {
      if (event.error?.message?.includes("404")) setError("Some local map files are missing. Run scripts/download_offline_map.py to restore the offline package.");
    });
    const resize = new ResizeObserver(() => {
      instance.resize();
      if (focusBounds.current) instance.fitBounds(focusBounds.current, { padding: 45, maxZoom: 12, duration: 0 });
    });
    resize.observe(container.current);
    return () => { resize.disconnect(); instance.remove(); map.current = null; };
  }, []);

  const cityData = useMemo(() => boundaries ? cityClientFeatures(barangays, boundaries) : null, [barangays, boundaries]);
  const selected = useMemo(() => boundaries && selectedBarangay ? matchAddressCity(selectedBarangay, boundaries) : null, [boundaries, selectedBarangay]);
  const total = barangays.reduce((sum, item) => sum + item.total_cases, 0);
  const located = cityData?.features.reduce((sum, feature) => sum + Number(feature.properties?.clientCount ?? 0), 0) ?? 0;

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !cityData) return;
    if (!instance.getSource("counts")) {
      instance.addSource("selection", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({ id: "selected-city", type: "line", source: "selection", paint: { "line-color": "#542469", "line-width": 3 } });
      instance.addSource("counts", { type: "geojson", cluster: true, clusterRadius: 55, clusterMaxZoom: 13,
        clusterProperties: { clientTotal: ["+", ["get", "count"]] }, data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({ id: "count-circles", type: "circle", source: "counts", paint: { "circle-color": "#704389", "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "clientTotal"], ["get", "count"]], 1, 17, 100, 27, 1000, 34], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
      instance.addLayer({ id: "count-labels", type: "symbol", source: "counts", layout: { "text-field": ["to-string", ["coalesce", ["get", "clientTotal"], ["get", "count"]]], "text-font": ["Noto Sans Regular"], "text-size": 13, "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } });
      instance.on("mousemove", "count-circles", (event) => { const properties = event.features?.[0]?.properties; instance.getCanvas().style.cursor = properties?.cluster ? "pointer" : ""; setHovered(`${properties?.clientTotal ?? properties?.count} client(s)${properties?.cluster ? ' across nearby cities · Click or zoom in to separate' : ` · ${properties?.city ?? 'City'}`}`); });
      instance.on("mouseleave", "count-circles", () => { instance.getCanvas().style.cursor = ""; setHovered(""); });
      instance.on("click", "count-circles", async (event) => {
        const feature = event.features?.[0];
        if (!feature?.properties?.cluster || feature.geometry.type !== "Point") return;
        try {
          const zoom = await (instance.getSource("counts") as GeoJSONSource).getClusterExpansionZoom(feature.properties.cluster_id);
          instance.easeTo({ center: feature.geometry.coordinates as [number, number], zoom, duration: 0 });
        } catch { setHovered("Use the zoom controls to inspect nearby cities."); }
      });
    }
    const countFeatures = cityData.features.filter((feature) => Number(feature.properties?.clientCount) > 0).map((feature) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: geometryBounds(feature).getCenter().toArray() }, properties: { count: feature.properties?.clientCount, city: feature.properties?.shapeName } }));
    (instance.getSource("counts") as GeoJSONSource).setData({ type: "FeatureCollection", features: countFeatures });
    (instance.getSource("selection") as GeoJSONSource).setData({ type: "FeatureCollection", features: selected ? [selected] : [] });
    const focus = selected ? [selected] : cityData.features.filter((feature) => Number(feature.properties?.clientCount) > 0);
    if (focus.length) {
      const bounds = new maplibregl.LngLatBounds();
      focus.forEach((feature) => bounds.extend(geometryBounds(feature)));
      focusBounds.current = bounds;
      instance.fitBounds(bounds, { padding: 55, maxZoom: 12, duration: 0 });
    } else {
      focusBounds.current = null;
      instance.fitBounds([[116.8, 4.5], [126.8, 21.2]], { padding: 30, duration: 0 });
    }
  }, [ready, cityData, selected]);

  return <section ref={panel} className="overflow-hidden rounded-xl border border-[#CBD5E1] bg-white" aria-label="Offline client address map">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div><h3 className="font-semibold text-[#2B3642]">Client address map</h3><p className="mt-1 text-sm text-[#4B5563]">{located} of {total} clients matched to a city · Offline</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={() => { focusBounds.current = null; onSelectBarangay?.(""); map.current?.fitBounds([[116.8, 4.5], [126.8, 21.2]], { padding: 30, duration: 0 }); }} className="flex min-h-11 items-center gap-2 rounded-md border border-[#CBD5E1] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]"><RotateCcw size={16} /> Reset view</button>
        <button type="button" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void panel.current?.requestFullscreen().catch(() => setError("Full-screen mode is unavailable in this browser.")); }} className="flex min-h-11 items-center gap-2 rounded-md border border-[#CBD5E1] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]"><Expand size={16} /> Full screen</button>
      </div>
    </div>
    {error && <p role="alert" className="px-4 pb-3 text-sm text-red-800">{error}</p>}
    <div className="relative"><div ref={container} className="h-[520px] min-h-[360px] w-full bg-[#c4deec]" role="region" aria-label="Interactive city map. Use arrow keys to pan and plus or minus to zoom." />
      {!ready && !error && <p role="status" className="absolute left-4 top-4 rounded-md bg-white px-3 py-2 text-sm">Loading offline map…</p>}
      {hovered && <p className="pointer-events-none absolute bottom-12 left-3 rounded-md bg-white px-3 py-2 text-sm text-[#2B3642]">{hovered}</p>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-[#4B5563]"><span><span className="mr-2 inline-block h-3 w-3 rounded-full bg-[#704389]" />Unique clients · Nearby cities combine; zoom in to separate · Outline marks selected city</span><span>Nationwide overview · Street detail: Mati area</span></div>
    <p className="px-4 pb-3 text-xs text-[#4B5563]">{total - located > 0 ? `${total - located} client address(es) need a unique city match. ` : ""}City boundaries: geoBoundaries / OCHA, CC BY 3.0 IGO.</p>
  </section>;
}
