"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";

interface FloorMapRecord {
  id: number;
  destination: string;
  latitude: number;
  longitude: number;
}

const FALLBACK_POINTS: FloorMapRecord[] = [
  { id: -1, destination: "North Dock", latitude: 37.4223, longitude: -122.084 },
  { id: -2, destination: "Outbound QC", latitude: 37.4215, longitude: -122.0821 },
  { id: -3, destination: "Yard Gate", latitude: 37.4204, longitude: -122.0856 },
  { id: -4, destination: "Inbound Staging", latitude: 37.4211, longitude: -122.0869 },
];

const clamp = (value: number) => Math.min(100, Math.max(0, value));

export default function FloorMapPlaceholder() {
  const [points, setPoints] = useState<FloorMapRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/floor-maps", { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.maps)) {
          setPoints(data.maps);
        }
      } catch (err) {
        console.warn("Failed to load floor maps", err);
        if (!cancelled) {
          setLoadError("Unable to load floor maps. Showing demo layout.");
          setPoints([]);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const displayPoints = points.length > 0 ? points : FALLBACK_POINTS;

  const bounds = useMemo(() => {
    if (displayPoints.length === 0) {
      return { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 };
    }
    return displayPoints.reduce(
      (acc, point) => ({
        minLat: Math.min(acc.minLat, point.latitude),
        maxLat: Math.max(acc.maxLat, point.latitude),
        minLon: Math.min(acc.minLon, point.longitude),
        maxLon: Math.max(acc.maxLon, point.longitude),
      }),
      {
        minLat: Number.POSITIVE_INFINITY,
        maxLat: Number.NEGATIVE_INFINITY,
        minLon: Number.POSITIVE_INFINITY,
        maxLon: Number.NEGATIVE_INFINITY,
      },
    );
  }, [displayPoints]);

  const rangeLat = bounds.maxLat - bounds.minLat || 1;
  const rangeLon = bounds.maxLon - bounds.minLon || 1;

  return (
    <Card
      header={<span className="text-lg font-semibold text-slate-100">Floor map routing preview</span>}
      className="overflow-visible"
    >
      <div className="space-y-4">
        <div className="relative isolate h-80 w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.18),_transparent_65%)]" />
          <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,_rgba(148,163,184,0.08),_rgba(148,163,184,0.08)_1px,_transparent_1px,_transparent_72px)]" />
          <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,_rgba(148,163,184,0.08),_rgba(148,163,184,0.08)_1px,_transparent_1px,_transparent_72px)]" />

          {displayPoints.map((point) => {
            const latPct = clamp(100 - ((point.latitude - bounds.minLat) / rangeLat) * 100);
            const lonPct = clamp(((point.longitude - bounds.minLon) / rangeLon) * 100);
            return (
              <div
                key={point.id}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ top: `${latPct}%`, left: `${lonPct}%` }}
              >
                <span className="mb-1 inline-flex h-3 w-3 items-center justify-center rounded-full border border-indigo-200/80 bg-indigo-500/80 shadow-lg" />
                <span className="whitespace-nowrap rounded-full bg-slate-900/85 px-2.5 py-1 text-xs font-medium text-slate-100 shadow-md">
                  {point.destination}
                </span>
              </div>
            );
          })}

          <div className="absolute bottom-3 left-3 rounded-lg bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
            <p className="font-semibold text-slate-100">Legend</p>
            <p className="text-[11px] text-slate-300/80">Destinations projected from stored floor map coordinates.</p>
          </div>
        </div>
        <div className="text-sm text-slate-300/80">
          <p>
            Live routing is being refit to the new logistics database. The placeholder above visualises either saved
            floor map coordinates or a demo layout so operators can keep spatial context while scanning.
          </p>
          {loadError && <p className="mt-2 text-xs font-medium text-rose-300/80">{loadError}</p>}
        </div>
      </div>
    </Card>
  );
}
