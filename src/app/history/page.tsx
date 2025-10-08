"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  HistoryRecord,
  loadHistoryRecords,
  clearHistoryRecords,
  persistHistoryRecords,
} from "@/lib/localStorage";

const formatDateTime = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    setHistory(loadHistoryRecords());
  }, []);

  const handleClearHistory = () => {
    clearHistoryRecords();
    setHistory([]);
  };

  const handleRemoveEntry = (index: number) => {
    setHistory((prev) => {
      const next = prev.filter((_, i) => i !== index);
      persistHistoryRecords(next);
      return next;
    });
  };

  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-10 flex flex-col gap-4">
        <h1 className="text-4xl font-semibold text-slate-100">
          Scan history <span className="text-gradient">timeline</span>
        </h1>
        <p className="max-w-3xl text-base text-slate-300/90">
          Every saved live buffer snapshot is preserved with timestamps to audit shipments, recover data, and keep the
          warehouse in sync without rescanning documents.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={handleClearHistory} disabled={history.length === 0}>
            Clear history
          </Button>
        </div>
      </div>

      <Card header={<span className="text-lg font-semibold text-slate-100">Saved scans</span>}>
        {history.length === 0 ? (
          <p className="text-sm text-slate-300/80">
            No saved history yet. Capture a document and save it from the scanner to build your audit trail.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-left text-xs font-medium uppercase tracking-wide text-slate-300/80">
                <tr>
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
                {history.map((entry, index) => (
                  <tr key={`${entry.trackingId}-${entry.savedAt}`} className="border-b border-white/10 last:border-0">
                    <td className="px-4 py-3 text-slate-200">{formatDateTime(entry.savedAt)}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.destination || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.itemName || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.trackingId || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.truckNumber || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.shipDate || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.expectedDepartureTime || "—"}</td>
                    <td className="px-4 py-3 text-slate-200">{entry.origin || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" onClick={() => handleRemoveEntry(index)}>
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

