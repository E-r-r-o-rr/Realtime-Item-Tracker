"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type BaseFloorMap = {
  id: number;
  name: string;
  image_path: string;
  width: number;
  height: number;
  georef_origin_lat: number | null;
  georef_origin_lon: number | null;
  georef_rotation_deg: number | null;
  georef_scale_m_per_px: number | null;
  floor: string;
  created_at: string;
  updated_at: string;
  image_url: string;
};

type FloorMapSummary = BaseFloorMap & { point_count: number };

type MapPoint = {
  id: number;
  map_id: number;
  label: string;
  x_px: number;
  y_px: number;
  lat: number | null;
  lon: number | null;
  created_at: string;
  updated_at: string;
  synonyms: string[];
};

interface FloorMapModuleProps {
  destinationLabel?: string;
  floorHint?: string;
  sectionHint?: string;
  lastUpdatedKey?: string | number;
}

interface SearchResult {
  match: MapPoint | null;
  alternatives: MapPoint[];
}

const initialUploadState = {
  name: "",
  floor: "",
  originLat: "",
  originLon: "",
  rotation: "",
  scale: "",
};

const formatCoord = (value: number | null) => {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(6);
};

const formatMetric = (value: number | null, unit: string) => {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)} ${unit}`;
};

const normalize = (value?: string) => value?.toLowerCase().trim() ?? "";

const parseSynonyms = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const buildMarkerStyle = (point: Pick<MapPoint, "x_px" | "y_px">, map: Pick<FloorMapSummary, "width" | "height">) => {
  const left = (point.x_px / map.width) * 100;
  const top = (point.y_px / map.height) * 100;
  return {
    left: `${left}%`,
    top: `${top}%`,
  } as const;
};

export function FloorMapModule({ destinationLabel, floorHint, sectionHint, lastUpdatedKey }: FloorMapModuleProps) {
  const [maps, setMaps] = useState<FloorMapSummary[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [mapDetail, setMapDetail] = useState<{ map: FloorMapSummary; points: MapPoint[] } | null>(null);
  const [mapImageUrl, setMapImageUrl] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResult>({ match: null, alternatives: [] });
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [navStatus, setNavStatus] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState(initialUploadState);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number } | null>(null);
  const [annotationLabel, setAnnotationLabel] = useState("");
  const [annotationSynonyms, setAnnotationSynonyms] = useState("");
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const mapClickRef = useRef<HTMLDivElement | null>(null);

  const refreshMaps = useCallback(async () => {
    try {
      setLoadingMaps(true);
      setMapError(null);
      const res = await fetch("/api/floor-maps");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { maps: FloorMapSummary[] };
      setMaps(data.maps);
    } catch (err) {
      console.error(err);
      setMapError("Failed to load floor maps.");
    } finally {
      setLoadingMaps(false);
    }
  }, []);

  useEffect(() => {
    refreshMaps();
  }, [refreshMaps]);

  useEffect(() => {
    if (!maps.length) return;
    if (selectedMapId && maps.some((map) => map.id === selectedMapId)) return;
    const targetSection = normalize(sectionHint);
    const targetFloor = normalize(floorHint);
    const sectionMatch = targetSection
      ? maps.find((map) => {
          const name = normalize(map.name);
          const image = normalize(map.image_path);
          return name.includes(targetSection) || image.includes(targetSection);
        })
      : undefined;
    const floorMatch = maps.find((map) => normalize(map.floor) === targetFloor);
    const next = sectionMatch ?? floorMatch ?? maps[0];
    setSelectedMapId(next?.id ?? null);
  }, [maps, selectedMapId, floorHint, sectionHint]);

  useEffect(() => {
    if (!selectedMapId) {
      setMapDetail(null);
      setMapImageUrl(null);
      return;
    }
    let cancelled = false;
    const loadDetail = async () => {
      try {
        setSearchStatus("Loading map…");
        const res = await fetch(`/api/floor-maps/${selectedMapId}`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { map: BaseFloorMap; points: MapPoint[] };
        if (cancelled) return;
        const enrichedMap: FloorMapSummary = {
          ...data.map,
          point_count: data.points.length,
        };
        setMapDetail({ map: enrichedMap, points: data.points });
        setMapImageUrl(`${data.map.image_url}?ts=${Date.now()}`);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setSearchStatus("Failed to load map detail.");
          setMapDetail(null);
          setMapImageUrl(null);
        }
      }
    };
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedMapId]);

  useEffect(() => {
    const label = destinationLabel?.trim();
    if (!selectedMapId || !label) {
      setSearchResult({ match: null, alternatives: [] });
      setSelectedPoint(null);
      if (!label) setSearchStatus("Awaiting destination from scan.");
      return;
    }
    const controller = new AbortController();
    const fetchMatch = async () => {
      try {
        setSearchStatus("Resolving destination on map…");
        const res = await fetch(`/api/floor-maps/${selectedMapId}/points/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, lastUpdatedKey }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { match: MapPoint | null; alternatives: MapPoint[] };
        setSearchResult({ match: data.match, alternatives: data.alternatives });
        setSelectedPoint(data.match ?? null);
        if (data.match) {
          setSearchStatus(`Found ${data.match.label} on the map.`);
        } else if (data.alternatives.length) {
          setSearchStatus("Map label not found. Review suggestions.");
        } else {
          setSearchStatus("Map label not found.");
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error(err);
        setSearchStatus("Failed to resolve destination on map.");
      }
    };
    fetchMatch();
    return () => controller.abort();
  }, [selectedMapId, destinationLabel, lastUpdatedKey]);

  const handleMapChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value);
    setSelectedMapId(Number.isFinite(value) ? value : null);
    setSearchStatus(null);
  };

  const handleUploadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!uploadFile) {
      setAdminStatus("Select a map image before uploading.");
      return;
    }
    try {
      setUploading(true);
      setAdminStatus("Uploading map…");
      const formData = new FormData();
      formData.append("image", uploadFile);
      if (uploadState.name) formData.append("name", uploadState.name);
      if (uploadState.floor) formData.append("floor", uploadState.floor);
      if (uploadState.originLat) formData.append("georef_origin_lat", uploadState.originLat);
      if (uploadState.originLon) formData.append("georef_origin_lon", uploadState.originLon);
      if (uploadState.rotation) formData.append("georef_rotation_deg", uploadState.rotation);
      if (uploadState.scale) formData.append("georef_scale_m_per_px", uploadState.scale);
      const res = await fetch("/api/floor-maps", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const created = (await res.json()) as { map: FloorMapSummary };
      await refreshMaps();
      setSelectedMapId(created.map.id);
      setUploadFile(null);
      setUploadState(initialUploadState);
      setAdminStatus("Map uploaded successfully.");
    } catch (err) {
      console.error(err);
      setAdminStatus("Failed to upload map.");
    } finally {
      setUploading(false);
    }
  };

  const selectedMap: BaseFloorMap | null = useMemo(() => {
    if (!selectedMapId) return null;
    return maps.find((map) => map.id === selectedMapId) ?? mapDetail?.map ?? null;
  }, [maps, selectedMapId, mapDetail]);

  const allPoints = mapDetail?.points ?? [];
  const pointsForOverlay = useMemo(() => {
    if (!selectedMap) return [];
    return allPoints;
  }, [selectedMap, allPoints]);

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!mapDetail?.map || !mapImageUrl) return;
    const container = mapClickRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * mapDetail.map.width;
    const y = ((event.clientY - rect.top) / rect.height) * mapDetail.map.height;
    setDraftPoint({ x, y });
    setAnnotationLabel(annotationLabel || destinationLabel || "");
    setAdminStatus(`Selected point at (${Math.round(x)}, ${Math.round(y)})`);
  };

  const handleSavePoint = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedMapId || !draftPoint) return;
    const label = annotationLabel.trim();
    if (!label) {
      setAdminStatus("Label is required to save a point.");
      return;
    }
    try {
      setAnnotationSaving(true);
      setAdminStatus("Saving map point…");
      const res = await fetch(`/api/floor-maps/${selectedMapId}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          x_px: draftPoint.x,
          y_px: draftPoint.y,
          synonyms: parseSynonyms(annotationSynonyms),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await fetch(`/api/floor-maps/${selectedMapId}`);
      if (updated.ok) {
        const data = (await updated.json()) as { map: BaseFloorMap; points: MapPoint[] };
        setMapDetail({ map: { ...data.map, point_count: data.points.length }, points: data.points });
        setMaps((prev) => prev.map((m) => (m.id === data.map.id ? { ...m, point_count: data.points.length } : m)));
        setAdminStatus("Point saved to map.");
        setDraftPoint(null);
        setAnnotationLabel("");
        setAnnotationSynonyms("");
      } else {
        setAdminStatus("Point saved but failed to refresh map.");
      }
    } catch (err) {
      console.error(err);
      setAdminStatus("Failed to save map point.");
    } finally {
      setAnnotationSaving(false);
    }
  };

  const handleStartNavigation = async () => {
    if (!selectedPoint || !selectedMap) {
      setNavStatus("Select a destination point first.");
      return;
    }
    try {
      setNavStatus("Sending navigation payload…");
      const payload = {
        label: selectedPoint.label,
        lat: selectedPoint.lat,
        lon: selectedPoint.lon,
        x_px: selectedPoint.x_px,
        y_px: selectedPoint.y_px,
        map_id: selectedMap.id,
        floor: selectedMap.floor,
        timestamp: new Date().toISOString(),
        original_destination: destinationLabel ?? "",
      };
      const res = await fetch("/api/navigation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setNavStatus("Navigation payload queued.");
    } catch (err) {
      console.error(err);
      setNavStatus("Failed to send navigation payload.");
    }
  };

  const displayPoint = selectedPoint;

  return (
    <div className="space-y-12">
      <Card
        header={
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold text-slate-100">Floor Map Navigation</h3>
            <p className="text-sm text-slate-300/80">
              Resolve scanned destinations against your uploaded floor maps and send the location to the navigation module.
            </p>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5">
                <p className="text-sm font-semibold text-slate-300/90">Current destination</p>
                <p className="text-2xl font-semibold text-slate-100">{destinationLabel || "—"}</p>
                {searchStatus && <p className="mt-2 text-sm text-slate-400">{searchStatus}</p>}
              </div>
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <label className="flex-1 text-sm text-slate-300/80">
                  <span className="mb-1 block font-medium text-slate-100">Active map</span>
                  <select
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                    value={selectedMapId ?? ""}
                    onChange={handleMapChange}
                  >
                    <option value="" disabled>
                      {loadingMaps ? "Loading maps…" : "Select a map"}
                    </option>
                    {maps.map((map) => (
                      <option key={map.id} value={map.id}>
                        {map.name} · {map.floor}
                      </option>
                    ))}
                  </select>
                </label>
                <Button variant="secondary" onClick={refreshMaps} disabled={loadingMaps}>
                  Refresh
                </Button>
              </div>
              {mapError && <p className="text-sm text-rose-400">{mapError}</p>}
            </div>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-5">
              <p className="text-sm font-semibold text-slate-300/90">Navigation payload</p>
              <dl className="space-y-2 text-sm text-slate-300/80">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Label</dt>
                  <dd className="font-medium text-slate-100">{displayPoint?.label ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Latitude</dt>
                  <dd className="font-mono text-slate-200">{formatCoord(displayPoint?.lat ?? null)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Longitude</dt>
                  <dd className="font-mono text-slate-200">{formatCoord(displayPoint?.lon ?? null)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Local X / Y</dt>
                  <dd className="font-mono text-slate-200">
                    {displayPoint ? `${displayPoint.x_px.toFixed(1)}, ${displayPoint.y_px.toFixed(1)}` : "—"}
                  </dd>
                </div>
              </dl>
              <Button className="w-full" onClick={handleStartNavigation} disabled={!displayPoint}>
                Start navigation
              </Button>
              {navStatus && <p className="text-xs text-slate-400">{navStatus}</p>}
            </div>
          </div>

          {mapImageUrl && selectedMap && (
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5">
              <img src={mapImageUrl} alt={selectedMap.name} className="w-full object-contain" />
              {displayPoint && (
                <span
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 bg-indigo-500 p-1 shadow-[0_0_20px_rgba(129,140,248,0.6)]"
                  style={buildMarkerStyle(displayPoint, selectedMap)}
                  title={displayPoint.label}
                />
              )}
            </div>
          )}

          {!displayPoint && searchResult.alternatives.length > 0 && (
            <div className="rounded-2xl border border-amber-300/60 bg-amber-500/10 p-5 text-amber-100">
              <p className="text-sm font-semibold uppercase tracking-wide text-amber-200">Suggestions</p>
              <ul className="mt-3 space-y-2 text-sm">
                {searchResult.alternatives.map((alt) => (
                  <li key={alt.id}>
                    <button
                      onClick={() => {
                        setSelectedPoint(alt);
                        setNavStatus(`Using suggestion ${alt.label}.`);
                      }}
                      className="text-left font-medium text-indigo-200 hover:text-white hover:underline"
                    >
                      {alt.label}
                    </button>
                    {alt.synonyms.length > 0 && <span className="ml-2 text-xs text-amber-200/80">Synonyms: {alt.synonyms.join(", ")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      <Card
        header={
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold text-slate-100">Map Administration</h3>
            <p className="text-sm text-slate-300/80">
              Upload new maps and annotate destination points. These annotations power the runtime destination lookup.
            </p>
          </div>
        }
      >
        <div className="space-y-6">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleUploadSubmit}>
            <div className="md:col-span-2">
              <label className="text-sm text-slate-300/80">
                <span className="mb-1 block font-medium text-slate-100">Floor map image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  className="block w-full cursor-pointer text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-indigo-500/20 file:px-4 file:py-2 file:text-indigo-200 file:transition hover:file:bg-indigo-500/30"
                />
              </label>
            </div>
            <label className="text-sm text-slate-300/80">
              <span className="mb-1 block font-medium text-slate-100">Map name</span>
              <Input
                value={uploadState.name}
                onChange={(event) => setUploadState((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g. Main Floor"
              />
            </label>
            <label className="text-sm text-slate-300/80">
              <span className="mb-1 block font-medium text-slate-100">Floor identifier</span>
              <Input
                value={uploadState.floor}
                onChange={(event) => setUploadState((prev) => ({ ...prev, floor: event.target.value }))}
                placeholder="e.g. floor1"
              />
            </label>
            <label className="text-sm text-slate-300/80">
              <span className="mb-1 block font-medium text-slate-100">Origin latitude</span>
              <Input
                value={uploadState.originLat}
                onChange={(event) => setUploadState((prev) => ({ ...prev, originLat: event.target.value }))}
                placeholder="Optional"
              />
            </label>
            <label className="text-sm text-slate-300/80">
              <span className="mb-1 block font-medium text-slate-100">Origin longitude</span>
              <Input
                value={uploadState.originLon}
                onChange={(event) => setUploadState((prev) => ({ ...prev, originLon: event.target.value }))}
                placeholder="Optional"
              />
            </label>
            <label className="text-sm text-slate-300/80">
              <span className="mb-1 block font-medium text-slate-100">Rotation (° clockwise)</span>
              <Input
                value={uploadState.rotation}
                onChange={(event) => setUploadState((prev) => ({ ...prev, rotation: event.target.value }))}
                placeholder="0"
              />
            </label>
            <label className="text-sm text-slate-300/80">
              <span className="mb-1 block font-medium text-slate-100">Scale (meters per pixel)</span>
              <Input
                value={uploadState.scale}
                onChange={(event) => setUploadState((prev) => ({ ...prev, scale: event.target.value }))}
                placeholder="1"
              />
            </label>
            <div className="md:col-span-2">
              <Button type="submit" disabled={uploading || !uploadFile}>
                {uploading ? "Uploading…" : "Upload floor map"}
              </Button>
            </div>
          </form>
          {adminStatus && <p className="text-sm text-slate-300/80">{adminStatus}</p>}

          {mapImageUrl && mapDetail?.map && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 text-sm text-slate-300/80">
                <div>
                  <span className="font-semibold text-slate-100">Selected map:</span> {mapDetail.map.name} ({mapDetail.map.floor})
                </div>
                <div>
                  <span className="font-semibold text-slate-100">Dimensions:</span> {mapDetail.map.width} × {mapDetail.map.height} px
                </div>
                <div>
                  <span className="font-semibold text-slate-100">Scale:</span> {formatMetric(mapDetail.map.georef_scale_m_per_px, "m/px")}
                </div>
              </div>
              <div className="relative overflow-hidden rounded-3xl border border-dashed border-indigo-400/40 bg-indigo-500/10">
                <div
                  ref={mapClickRef}
                  className="relative cursor-crosshair"
                  onClick={handleMapClick}
                  role="presentation"
                >
                  <img src={mapImageUrl} alt={mapDetail.map.name} className="w-full object-contain" />
                  {pointsForOverlay.map((point) => (
                    <span
                      key={point.id}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 bg-emerald-500 p-1"
                      style={buildMarkerStyle(point, mapDetail.map)}
                      title={point.label}
                    />
                  ))}
                  {draftPoint && (
                    <span
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 bg-orange-500 p-2"
                      style={buildMarkerStyle(draftPoint, mapDetail.map)}
                      title="New point"
                    />
                  )}
                </div>
              </div>
              {draftPoint && (
                <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSavePoint}>
                  <div className="md:col-span-2 text-sm text-slate-300/80">
                    New point at <span className="text-slate-100">{draftPoint.x.toFixed(1)}, {draftPoint.y.toFixed(1)}</span> (pixels)
                  </div>
                  <label className="text-sm text-slate-300/80">
                    <span className="mb-1 block font-medium text-slate-100">Destination label</span>
                    <Input value={annotationLabel} onChange={(event) => setAnnotationLabel(event.target.value)} />
                  </label>
                  <label className="text-sm text-slate-300/80">
                    <span className="mb-1 block font-medium text-slate-100">Synonyms (comma separated)</span>
                    <Input value={annotationSynonyms} onChange={(event) => setAnnotationSynonyms(event.target.value)} />
                  </label>
                  <div className="md:col-span-2 flex gap-3">
                    <Button type="submit" disabled={annotationSaving}>
                      {annotationSaving ? "Saving…" : "Save point"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setDraftPoint(null);
                        setAnnotationLabel("");
                        setAnnotationSynonyms("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              <div>
                <h4 className="text-sm font-semibold text-slate-100">Annotated points</h4>
                <div className="mt-2 max-h-64 overflow-y-auto">
                  {pointsForOverlay.length === 0 ? (
                    <p className="text-sm text-slate-300/80">No points have been added to this map yet.</p>
                  ) : (
                    <table className="min-w-full divide-y divide-white/10 text-sm">
                      <thead className="bg-white/5 text-left text-xs font-semibold uppercase tracking-wider text-slate-300/80">
                        <tr>
                          <th scope="col" className="px-3 py-2">
                            Label
                          </th>
                          <th scope="col" className="px-3 py-2">
                            Coordinates (px)
                          </th>
                          <th scope="col" className="px-3 py-2">
                            Lat / Lon
                          </th>
                          <th scope="col" className="px-3 py-2">
                            Synonyms
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {pointsForOverlay.map((point) => (
                          <tr key={point.id} className="hover:bg-white/5">
                            <td className="px-3 py-2 font-medium text-slate-100">{point.label}</td>
                            <td className="px-3 py-2 font-mono text-slate-300/90">
                              {point.x_px.toFixed(1)}, {point.y_px.toFixed(1)}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-300/90">
                              {formatCoord(point.lat)} / {formatCoord(point.lon)}
                            </td>
                            <td className="px-3 py-2 text-slate-300/80">
                              {point.synonyms.length ? point.synonyms.join(", ") : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default FloorMapModule;
