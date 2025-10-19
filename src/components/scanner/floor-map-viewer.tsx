"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FloorMap, MapPoint } from "@/types/floor-maps";

interface FloorMapViewerProps {
  activeDestination?: string | null;
}

const normalize = (value: string) => value.trim().toLowerCase();

const buildNavigationPayload = (map: FloorMap, point: MapPoint) => ({
  label: point.label,
  synonyms: point.synonyms,
  coordinates: {
    lat: point.lat,
    lon: point.lon,
    x_px: point.xPx,
    y_px: point.yPx,
  },
  map: {
    id: map.id,
    name: map.name,
    floor: map.floor,
    destination_tag: map.destinationTag,
    georeference: {
      origin_lat: map.georefOriginLat,
      origin_lon: map.georefOriginLon,
      rotation_deg: map.georefRotationDeg,
      scale_m_per_px: map.georefScaleMPx,
    },
  },
  timestamp: new Date().toISOString(),
});

const formatFloorLabel = (map: FloorMap) => {
  const parts = [map.name];
  if (map.floor) parts.push(map.floor);
  if (map.destinationTag) parts.push(`Tag ${map.destinationTag}`);
  return parts.join(' · ');
};

export function FloorMapViewer({ activeDestination }: FloorMapViewerProps) {
  const [maps, setMaps] = useState<FloorMap[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ mapId: number; point: MapPoint }>>([]);
  const [navigationStatus, setNavigationStatus] = useState<string>("");
  const [sending, setSending] = useState(false);

  const loadMaps = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/floor-maps?includePoints=true", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const incomingMaps: FloorMap[] = payload.maps ?? [];
      setMaps(incomingMaps);
      if (!incomingMaps.length) {
        setSelectedMapId(null);
        setSelectedPointId(null);
        return;
      }
      const currentId = selectedMapId;
      if (currentId === null || !incomingMaps.some((map) => map.id === currentId)) {
        setSelectedMapId(incomingMaps[0].id);
      }
    } catch (error) {
      console.error("Failed to load floor maps", error);
    } finally {
      setLoading(false);
    }
  }, [selectedMapId]);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  useEffect(() => {
    const handler = () => {
      loadMaps();
    };
    window.addEventListener("floor-map:updated", handler);
    return () => window.removeEventListener("floor-map:updated", handler);
  }, [loadMaps]);

  const selectedMap = useMemo(
    () => maps.find((map) => map.id === selectedMapId) ?? (maps.length ? maps[0] : null),
    [maps, selectedMapId],
  );

  useEffect(() => {
    if (!selectedMap) {
      setSelectedPointId(null);
      return;
    }
    if (selectedPointId) {
      const stillExists = selectedMap.points.some((point) => point.id === selectedPointId);
      if (!stillExists) {
        setSelectedPointId(null);
      }
    }
  }, [selectedMap, selectedPointId]);

  useEffect(() => {
    if (!activeDestination || !maps.length) {
      setSuggestions([]);
      return;
    }
    const normalizedDestination = normalize(activeDestination);
    const tagMatch = maps.find(
      (map) => map.destinationTag && normalize(map.destinationTag) === normalizedDestination,
    );
    if (tagMatch && tagMatch.id !== selectedMapId) {
      setSelectedMapId(tagMatch.id);
    }
    let matched: { map: FloorMap; point: MapPoint } | undefined;
    const suggestionPool: Array<{ map: FloorMap; point: MapPoint; score: number }> = [];

    for (const map of maps) {
      for (const point of map.points) {
        const labels = [point.label, ...point.synonyms];
        const hasExact = labels.some((value) => normalize(value) === normalizedDestination);
        if (hasExact && !matched) {
          matched = { map, point };
        }
        const partialScore = labels.some((value) => normalize(value).includes(normalizedDestination))
          ? normalizedDestination.length
          : 0;
        if (!hasExact && partialScore > 0) {
          suggestionPool.push({ map, point, score: partialScore });
        }
      }
    }

    if (matched) {
      setSelectedMapId(matched.map.id);
      setSelectedPointId(matched.point.id);
      setSuggestions([]);
      setNavigationStatus(`Resolved ${matched.point.label} on ${matched.map.name}`);
      return;
    }

    suggestionPool.sort((a, b) => b.score - a.score || a.point.label.localeCompare(b.point.label));
    setSuggestions(suggestionPool.slice(0, 5).map(({ map, point }) => ({ mapId: map.id, point })));
    setNavigationStatus(`No map label matched "${activeDestination}". Select a suggestion to continue.`);
  }, [activeDestination, maps, selectedMapId]);

  const selectedPoint = useMemo(() => {
    if (!selectedMap || selectedPointId === null) return null;
    return selectedMap.points.find((point) => point.id === selectedPointId) ?? null;
  }, [selectedMap, selectedPointId]);

  const payloadPreview = useMemo(() => {
    if (!selectedMap || !selectedPoint) return null;
    return buildNavigationPayload(selectedMap, selectedPoint);
  }, [selectedMap, selectedPoint]);

  const handleSelectSuggestion = (mapId: number, point: MapPoint) => {
    setSelectedMapId(mapId);
    setSelectedPointId(point.id);
    setSuggestions([]);
    const map = maps.find((entry) => entry.id === mapId);
    setNavigationStatus(`Pinned ${point.label} on ${map ? formatFloorLabel(map) : "selected map"}`);
  };

  const handleStartNavigation = async () => {
    if (!payloadPreview) return;
    setSending(true);
    setNavigationStatus("Sending navigation payload…");
    try {
      const response = await fetch("/api/navigation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadPreview),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Navigation stub failed");
      }
      const confirmation = await response.json();
      setNavigationStatus(`Navigation queued at ${confirmation.received_at}`);
    } catch (error: any) {
      console.error("Failed to start navigation", error);
      setNavigationStatus(error?.message ?? "Failed to reach navigation module");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card
      header={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-indigo-200/80">Floor Map Navigation</p>
            <h3 className="text-xl font-semibold text-slate-100">Guide pick teams with annotated layouts</h3>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-200/70">
            {activeDestination ? `Active destination: ${activeDestination}` : "Awaiting scan"}
          </div>
        </div>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-300/80">
              {loading
                ? "Loading map catalog…"
                : maps.length
                ? `${maps.length} map${maps.length === 1 ? "" : "s"} available`
                : "Upload a floor map to begin"}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="floor-map-select" className="text-slate-400">
                Active map
              </label>
              <select
                id="floor-map-select"
                className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={selectedMap?.id ?? ""}
                onChange={(event) => setSelectedMapId(Number(event.target.value))}
                disabled={!maps.length}
              >
                {maps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {formatFloorLabel(map)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/50">
            {selectedMap ? (
              <>
                <img
                  src={selectedMap.imageUrl}
                  alt={selectedMap.name}
                  className="h-[420px] w-full object-contain object-center"
                />
                {selectedPoint && (
                  <div
                    className="pointer-events-none absolute left-0 top-0 flex h-full w-full items-center justify-center"
                    aria-hidden
                  >
                    <span
                      className="absolute -translate-x-1/2 -translate-y-full rounded-full border border-emerald-400/70 bg-emerald-500/60 px-3 py-1 text-xs font-semibold text-emerald-50 shadow-lg"
                      style={{
                        left: `${(selectedPoint.xPx / selectedMap.width) * 100}%`,
                        top: `${(selectedPoint.yPx / selectedMap.height) * 100}%`,
                      }}
                    >
                      {selectedPoint.label}
                    </span>
                    <span
                      className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-emerald-400 shadow-lg"
                      style={{
                        left: `${(selectedPoint.xPx / selectedMap.width) * 100}%`,
                        top: `${(selectedPoint.yPx / selectedMap.height) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-[420px] flex-col items-center justify-center gap-4 text-center text-sm text-slate-400">
                <span className="rounded-full border border-dashed border-white/15 px-4 py-2 text-xs uppercase tracking-[0.4em]">
                  No maps uploaded
                </span>
                <p className="max-w-sm text-slate-400/80">
                  Upload a dock layout in the administration panel below to light up the navigation preview.
                </p>
              </div>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <p className="text-sm font-semibold text-slate-100">Possible matches</p>
              <p className="mt-1 text-xs text-slate-400">
                We could not resolve <span className="font-semibold text-slate-100">{activeDestination}</span>. Try a nearby label.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map(({ mapId, point }) => (
                  <button
                    key={`${mapId}-${point.id}`}
                    type="button"
                    onClick={() => handleSelectSuggestion(mapId, point)}
                    className="rounded-xl border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-indigo-100 transition hover:bg-indigo-500/20"
                  >
                    {point.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex h-full flex-col gap-5 rounded-3xl border border-white/10 bg-slate-900/60 p-6 text-sm text-slate-200">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-100">Navigation payload</p>
            <p className="text-xs text-slate-400">
              The payload below is sent to the navigation module stub when you click <strong>Start Navigation</strong>.
            </p>
          </div>
          <div className="flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-4 text-xs text-indigo-100">
            {payloadPreview ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap leading-relaxed">
                {JSON.stringify(payloadPreview, null, 2)}
              </pre>
            ) : (
              <p className="text-slate-400/80">Select or scan a destination to generate a payload.</p>
            )}
          </div>
          <div className="space-y-2 text-xs text-slate-400">
            <p className="font-semibold uppercase tracking-[0.3em] text-indigo-200/80">Status</p>
            <p className="text-sm text-slate-200/90">{navigationStatus || "Awaiting next scan."}</p>
          </div>
          <Button onClick={handleStartNavigation} disabled={!payloadPreview || sending} className="justify-center">
            {sending ? "Sending…" : "Start Navigation"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
