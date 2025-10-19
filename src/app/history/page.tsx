"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface HistoryEntry {
  id: number;
  scanId: string;
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  originLocation: string;
  recordedAt: string;
}

const formatDateTime = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/history");
      const payload: { history?: HistoryEntry[]; error?: string } = await response
        .json()
        .catch(() => ({ error: "Failed to parse response" }));
      if (!response.ok) {
        throw new Error(payload.error || response.statusText || "Failed to load history");
      }
      setHistory(Array.isArray(payload.history) ? payload.history : []);
    } catch (err) {
      console.error("Failed to load history", err);
      setError(err instanceof Error ? err.message : "Failed to load history");
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleClearHistory = async () => {
    try {
      setError(null);
      const response = await fetch("/api/history", { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || response.statusText || "Failed to clear history");
      }
      setHistory([]);
    } catch (err) {
      console.error("Failed to clear history", err);
      setError(err instanceof Error ? err.message : "Failed to clear history");
    }
  };

  const handleRemoveEntry = async (id: number) => {
    try {
      setError(null);
      const response = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || response.statusText || "Failed to remove entry");
      }
      setHistory((prev) => prev.filter((entry) => entry.id !== id));
    } catch (err) {
      console.error("Failed to remove history entry", err);
      setError(err instanceof Error ? err.message : "Failed to remove entry");
    }
  };

  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-10 flex flex-col gap-4">
        <h1 className="text-4xl font-semibold text-slate-100">
          Scan history <span className="text-gradient">timeline</span>
        </h1>
        <p className="max-w-3xl text-base text-slate-300/90">
          Every scan that synchronizes with the live buffer is logged automatically with a unique Scan ID so you can
          audit shipments, recover data, and keep the warehouse in sync without rescanning documents.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={handleClearHistory} disabled={loading || history.length === 0}>
            Clear history
          </Button>
        </div>
      </div>

      <Card header={<span className="text-lg font-semibold text-slate-100">Saved scans</span>}>
        {error && (
          <p className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </p>
        )}
        {loading ? (
          <p className="text-sm text-slate-300/80">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-300/80">
            No saved history yet. Scan an order to populate the live buffer and it will be added automatically.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-left text-xs font-medium uppercase tracking-wide text-slate-300/80">
                <tr>
                  <th className="px-4 py-3">Scan ID</th>
                  <th className="px-4 py-3">Saved at</th>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Item name</th>
                  <th className="px-4 py-3">Tracking ID</th>
                  <th className="px-4 py-3">Truck number</th>
                  <th className="px-4 py-3">Ship date</th>
                  <th className="px-4 py-3">Expected departure</th>
                  <th className="px-4 py-3">Origin</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/10 last:border-0">
                    <td className="px-4 py-3 text-slate-200">{entry.scanId}</td>
                    <td className="px-4 py-3 text-slate-200">{formatDateTime(entry.recordedAt)}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.destination || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.itemName || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.trackingId || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.truckNumber || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.shipDate || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.expectedDepartureTime || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.originLocation || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" onClick={() => handleRemoveEntry(entry.id)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

