"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FloorMap } from "@/types/floor-maps";

interface PendingPoint {
  xPx: number;
  yPx: number;
}

const emptyPendingPoint: PendingPoint | null = null;

const formatNumber = (value: number | null | undefined, precision = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(precision);
};

const dispatchMapsUpdated = () => {
  window.dispatchEvent(new Event("floor-map:updated"));
};

export function FloorMapAdmin() {
  const [maps, setMaps] = useState<FloorMap[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadFloor, setUploadFloor] = useState("");
  const [uploadWidth, setUploadWidth] = useState<number | null>(null);
  const [uploadHeight, setUploadHeight] = useState<number | null>(null);
  const [uploadOriginLat, setUploadOriginLat] = useState("");
  const [uploadOriginLon, setUploadOriginLon] = useState("");
  const [uploadRotation, setUploadRotation] = useState("0");
  const [uploadScale, setUploadScale] = useState("1");
  const [uploadStatus, setUploadStatus] = useState("");

  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(emptyPendingPoint);
  const [pointLabel, setPointLabel] = useState("");
  const [pointSynonyms, setPointSynonyms] = useState("");
  const [adminStatus, setAdminStatus] = useState("");
  const [savingGeoref, setSavingGeoref] = useState(false);
  const [creatingPoint, setCreatingPoint] = useState(false);

  const selectedMap = useMemo(
    () => maps.find((map) => map.id === selectedMapId) ?? (maps.length ? maps[0] : null),
    [maps, selectedMapId],
  );

  const [georefForm, setGeorefForm] = useState({
    name: "",
    floor: "",
    georefOriginLat: "",
    georefOriginLon: "",
    georefRotationDeg: "0",
    georefScaleMPx: "1",
  });

  const loadMaps = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/floor-maps?includePoints=true", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const list: FloorMap[] = payload.maps ?? [];
      setMaps(list);
      setPendingPoint(emptyPendingPoint);
      if (!list.length) {
        setSelectedMapId(null);
        return;
      }
      const currentId = selectedMapId;
      if (currentId === null || !list.some((map) => map.id === currentId)) {
        setSelectedMapId(list[0].id);
      }
    } catch (error) {
      console.error("Failed to load maps", error);
    } finally {
      setLoading(false);
    }
  }, [selectedMapId]);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  useEffect(() => {
    if (!selectedMap) {
      setGeorefForm({
        name: "",
        floor: "",
        georefOriginLat: "",
        georefOriginLon: "",
        georefRotationDeg: "0",
        georefScaleMPx: "1",
      });
      return;
    }
    setGeorefForm({
      name: selectedMap.name,
      floor: selectedMap.floor ?? "",
      georefOriginLat: formatNumber(selectedMap.georefOriginLat, 6),
      georefOriginLon: formatNumber(selectedMap.georefOriginLon, 6),
      georefRotationDeg: formatNumber(selectedMap.georefRotationDeg, 2),
      georefScaleMPx: formatNumber(selectedMap.georefScaleMPx, 4),
    });
  }, [selectedMap]);

  const handleUploadFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setUploadFile(file ?? null);
    setUploadStatus("");
    if (file) {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        setUploadWidth(image.naturalWidth);
        setUploadHeight(image.naturalHeight);
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        setUploadWidth(null);
        setUploadHeight(null);
        URL.revokeObjectURL(url);
      };
      image.src = url;
    } else {
      setUploadWidth(null);
      setUploadHeight(null);
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadName("");
    setUploadFloor("");
    setUploadWidth(null);
    setUploadHeight(null);
    setUploadOriginLat("");
    setUploadOriginLon("");
    setUploadRotation("0");
    setUploadScale("1");
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!uploadFile || !uploadName.trim()) {
      setUploadStatus("Map name and image are required.");
      return;
    }
    if (!uploadWidth || !uploadHeight) {
      setUploadStatus("Could not determine image dimensions. Please choose a standard PNG/JPG/SVG.");
      return;
    }
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("name", uploadName.trim());
    if (uploadFloor.trim()) formData.append("floor", uploadFloor.trim());
    formData.append("width", uploadWidth.toString());
    formData.append("height", uploadHeight.toString());
    if (uploadOriginLat.trim()) formData.append("georefOriginLat", uploadOriginLat.trim());
    if (uploadOriginLon.trim()) formData.append("georefOriginLon", uploadOriginLon.trim());
    if (uploadRotation.trim()) formData.append("georefRotationDeg", uploadRotation.trim());
    if (uploadScale.trim()) formData.append("georefScaleMPx", uploadScale.trim());

    setUploadStatus("Uploading map…");
    try {
      const response = await fetch("/api/floor-maps", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload.error === "string" ? payload.error : "Failed to upload map.";
        setUploadStatus(message);
        return;
      }
      setUploadStatus("Map uploaded successfully.");
      resetUploadForm();
      await loadMaps();
      dispatchMapsUpdated();
    } catch (error) {
      console.error("Upload failed", error);
      setUploadStatus("Upload failed. Check the console for details.");
    }
  };

  const handleMapClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!selectedMap) return;
    const bounding = event.currentTarget.getBoundingClientRect();
    const xRatio = (event.clientX - bounding.left) / bounding.width;
    const yRatio = (event.clientY - bounding.top) / bounding.height;
    const xPx = Math.round(xRatio * selectedMap.width);
    const yPx = Math.round(yRatio * selectedMap.height);
    setPendingPoint({ xPx, yPx });
    setAdminStatus(`Staged point at (${xPx}, ${yPx}). Add a label to save.`);
  };

  const handleMapKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!selectedMap) return;
    const xPx = Math.round(selectedMap.width / 2);
    const yPx = Math.round(selectedMap.height / 2);
    setPendingPoint({ xPx, yPx });
    setAdminStatus(`Staged point at (${xPx}, ${yPx}). Add a label to save.`);
  };

  const handleCreatePoint = async () => {
    if (!selectedMap || !pendingPoint) {
      setAdminStatus("Click the map to choose coordinates first.");
      return;
    }
    if (!pointLabel.trim()) {
      setAdminStatus("Enter a destination label for this point.");
      return;
    }
    setCreatingPoint(true);
    setAdminStatus("Saving point…");
    try {
      const response = await fetch(`/api/floor-maps/${selectedMap.id}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: pointLabel.trim(),
          synonyms: pointSynonyms
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
          xPx: pendingPoint.xPx,
          yPx: pendingPoint.yPx,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload.error === "string" ? payload.error : "Failed to save point.";
        setAdminStatus(message);
        return;
      }
      setAdminStatus(`Saved point ${pointLabel.trim()} at (${pendingPoint.xPx}, ${pendingPoint.yPx}).`);
      setPointLabel("");
      setPointSynonyms("");
      setPendingPoint(emptyPendingPoint);
      await loadMaps();
      dispatchMapsUpdated();
    } catch (error) {
      console.error("Failed to create point", error);
      setAdminStatus("Point creation failed. Check logs for details.");
    } finally {
      setCreatingPoint(false);
    }
  };

  const handleDeletePoint = async (pointId: number) => {
    if (!selectedMap) return;
    try {
      const response = await fetch(`/api/floor-maps/${selectedMap.id}/points/${pointId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload.error === "string" ? payload.error : "Failed to delete point.";
        setAdminStatus(message);
        return;
      }
      setAdminStatus("Point removed.");
      await loadMaps();
      dispatchMapsUpdated();
    } catch (error) {
      console.error("Failed to delete point", error);
      setAdminStatus("Failed to delete point.");
    }
  };

  const handleSaveGeoref = async () => {
    if (!selectedMap) return;
    setSavingGeoref(true);
    setAdminStatus("Saving georeference…");
    try {
      const originLatValue = georefForm.georefOriginLat.trim();
      const originLonValue = georefForm.georefOriginLon.trim();
      const rotationValue = georefForm.georefRotationDeg.trim();
      const scaleValue = georefForm.georefScaleMPx.trim();

      const originLat = originLatValue ? Number(originLatValue) : null;
      const originLon = originLonValue ? Number(originLonValue) : null;
      const rotation = rotationValue ? Number(rotationValue) : 0;
      const scale = scaleValue ? Number(scaleValue) : 1;

      if (originLat !== null && Number.isNaN(originLat)) {
        setAdminStatus("Origin latitude must be numeric.");
        return;
      }
      if (originLon !== null && Number.isNaN(originLon)) {
        setAdminStatus("Origin longitude must be numeric.");
        return;
      }
      if (Number.isNaN(rotation)) {
        setAdminStatus("Rotation must be numeric.");
        return;
      }
      if (Number.isNaN(scale) || scale <= 0) {
        setAdminStatus("Scale must be a positive number.");
        return;
      }

      const response = await fetch(`/api/floor-maps/${selectedMap.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: georefForm.name.trim() || selectedMap.name,
          floor: georefForm.floor.trim() || null,
          georefOriginLat: originLat,
          georefOriginLon: originLon,
          georefRotationDeg: rotation,
          georefScaleMPx: scale,
          includePoints: true,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload.error === "string" ? payload.error : "Failed to update georeference.";
        setAdminStatus(message);
        return;
      }
      setAdminStatus("Map settings updated.");
      await loadMaps();
      dispatchMapsUpdated();
    } catch (error) {
      console.error("Failed to update map", error);
      setAdminStatus("Failed to update map metadata.");
    } finally {
      setSavingGeoref(false);
    }
  };

  return (
    <Card
      header={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-indigo-200/80">Map Administration</p>
            <h3 className="text-xl font-semibold text-slate-100">Upload layouts and annotate destinations</h3>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-200/70">
            {loading ? "Refreshing…" : `${maps.length} map${maps.length === 1 ? "" : "s"}`}
          </div>
        </div>
      }
      className="mt-12"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="space-y-6">
          <form className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/60 p-6" onSubmit={handleUpload}>
            <div>
              <h4 className="text-lg font-semibold text-slate-100">Upload a new floor map</h4>
              <p className="mt-1 text-sm text-slate-400">
                Provide a PNG, JPG, SVG, or WebP file. Enter approximate georeference details so navigation payloads include
                latitude and longitude.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Map name</span>
                <Input value={uploadName} onChange={(event) => setUploadName(event.target.value)} required placeholder="Dock layout" />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Floor / zone (optional)</span>
                <Input value={uploadFloor} onChange={(event) => setUploadFloor(event.target.value)} placeholder="Floor 1" />
              </label>
            </div>
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-slate-300">Map image</span>
              <Input type="file" accept="image/*" onChange={handleUploadFileChange} required />
              {uploadWidth && uploadHeight && (
                <span className="text-xs text-slate-400">Detected dimensions: {uploadWidth} × {uploadHeight} px</span>
              )}
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Origin latitude (optional)</span>
                <Input value={uploadOriginLat} onChange={(event) => setUploadOriginLat(event.target.value)} placeholder="36.123456" />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Origin longitude (optional)</span>
                <Input value={uploadOriginLon} onChange={(event) => setUploadOriginLon(event.target.value)} placeholder="-86.654321" />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Rotation (degrees)</span>
                <Input value={uploadRotation} onChange={(event) => setUploadRotation(event.target.value)} />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Scale (meters per pixel)</span>
                <Input value={uploadScale} onChange={(event) => setUploadScale(event.target.value)} />
              </label>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{uploadStatus}</span>
              <Button type="submit" className="justify-center">
                Upload map
              </Button>
            </div>
          </form>

          {selectedMap ? (
            <div className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-slate-100">Annotate {selectedMap.name}</h4>
                  <p className="text-sm text-slate-400">Click the map to stage a point, then add a label and optional synonyms.</p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <label htmlFor="admin-map-select" className="text-slate-400">
                    Active map
                  </label>
                  <select
                    id="admin-map-select"
                    value={selectedMap.id}
                    onChange={(event) => setSelectedMapId(Number(event.target.value))}
                    className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  >
                    {maps.map((map) => (
                      <option key={map.id} value={map.id}>
                        {map.name}
                        {map.floor ? ` · ${map.floor}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                className="relative overflow-hidden rounded-3xl border border-indigo-400/20 bg-black/50"
                onClick={handleMapClick}
                role="button"
                tabIndex={0}
                onKeyDown={handleMapKeyDown}
              >
                <img src={selectedMap.imageUrl} alt={selectedMap.name} className="h-[420px] w-full cursor-crosshair object-contain" />
                {selectedMap.points.map((point) => (
                  <span
                    key={point.id}
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-indigo-400/90 shadow"
                    style={{
                      left: `${(point.xPx / selectedMap.width) * 100}%`,
                      top: `${(point.yPx / selectedMap.height) * 100}%`,
                    }}
                    title={point.label}
                  />
                ))}
                {pendingPoint && (
                  <span
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400 bg-emerald-500 shadow-lg"
                    style={{
                      left: `${(pendingPoint.xPx / selectedMap.width) * 100}%`,
                      top: `${(pendingPoint.yPx / selectedMap.height) * 100}%`,
                    }}
                  />
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-slate-300">Destination label</span>
                  <Input value={pointLabel} onChange={(event) => setPointLabel(event.target.value)} placeholder="Dock 3" />
                </label>
                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-slate-300">Synonyms (comma separated)</span>
                  <Input
                    value={pointSynonyms}
                    onChange={(event) => setPointSynonyms(event.target.value)}
                    placeholder="D3, Bay 3"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
                <span>
                  {pendingPoint
                    ? `Pending coordinates: (${pendingPoint.xPx}, ${pendingPoint.yPx})`
                    : "Click the map to select coordinates."}
                </span>
                <Button type="button" onClick={handleCreatePoint} disabled={creatingPoint} className="justify-center">
                  {creatingPoint ? "Saving…" : "Add point"}
                </Button>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-100">Existing points</p>
                {selectedMap.points.length ? (
                  <ul className="space-y-3">
                    {selectedMap.points.map((point) => (
                      <li key={point.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm">
                        <div>
                          <p className="font-semibold text-slate-100">{point.label}</p>
                          <p className="text-xs text-slate-400">
                            Synonyms: {point.synonyms.length ? point.synonyms.join(", ") : "—"}
                          </p>
                          <p className="text-xs text-slate-500">
                            px: ({point.xPx}, {point.yPx}) · lat/lon: {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
                          </p>
                        </div>
                        <Button type="button" variant="outline" onClick={() => handleDeletePoint(point.id)}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">No points yet. Click the map to add destinations.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 text-sm text-slate-400">
              Upload a floor map to start annotating destinations.
            </div>
          )}
        </section>

        <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <div>
            <h4 className="text-lg font-semibold text-slate-100">Map settings</h4>
            <p className="text-sm text-slate-400">
              Update georeference details to refine the latitude/longitude calculations shared with the navigation module.
            </p>
          </div>
          {selectedMap ? (
            <div className="space-y-4">
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Name</span>
                <Input
                  value={georefForm.name}
                  onChange={(event) => setGeorefForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Floor / zone</span>
                <Input
                  value={georefForm.floor}
                  onChange={(event) => setGeorefForm((prev) => ({ ...prev, floor: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Origin latitude</span>
                <Input
                  value={georefForm.georefOriginLat}
                  onChange={(event) => setGeorefForm((prev) => ({ ...prev, georefOriginLat: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Origin longitude</span>
                <Input
                  value={georefForm.georefOriginLon}
                  onChange={(event) => setGeorefForm((prev) => ({ ...prev, georefOriginLon: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Rotation (degrees)</span>
                <Input
                  value={georefForm.georefRotationDeg}
                  onChange={(event) => setGeorefForm((prev) => ({ ...prev, georefRotationDeg: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Scale (meters per pixel)</span>
                <Input
                  value={georefForm.georefScaleMPx}
                  onChange={(event) => setGeorefForm((prev) => ({ ...prev, georefScaleMPx: event.target.value }))}
                />
              </label>
              <Button type="button" onClick={handleSaveGeoref} disabled={savingGeoref} className="justify-center">
                {savingGeoref ? "Saving…" : "Save settings"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Select or upload a map to edit its metadata.</p>
          )}
          <div className="rounded-2xl border border-white/10 bg-black/50 p-4 text-xs text-slate-300">
            <p className="font-semibold uppercase tracking-[0.3em] text-indigo-200/80">Status</p>
            <p className="mt-2 text-sm text-slate-100">{adminStatus || "Ready for updates."}</p>
          </div>
        </section>
      </div>
    </Card>
  );
}
