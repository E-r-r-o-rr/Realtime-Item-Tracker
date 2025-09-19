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
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-gray-900">Scan History</h1>
        <p className="max-w-3xl text-base text-gray-600">
          Every time you commit a live buffer to history, the snapshot is preserved here with the timestamp of when it was
          saved. Use this feed to audit past scans or recover information without reprocessing documents.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            className="hover:cursor-pointer"
            variant="outline"
            onClick={handleClearHistory}
            disabled={history.length === 0}
          >
            Clear History
          </Button>
        </div>
      </div>

      <Card className="bg-white" header={<span className="font-medium text-gray-900">Saved Scans</span>}>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">No saved history yet. Capture a document and save it from the scanner.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Saved At</th>
                  <th className="px-3 py-2">Destination</th>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2">Tracking ID</th>
                  <th className="px-3 py-2">Truck Number</th>
                  <th className="px-3 py-2">Ship Date</th>
                  <th className="px-3 py-2">Expected Departure</th>
                  <th className="px-3 py-2">Origin</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, index) => (
                  <tr key={`${entry.trackingId}-${entry.savedAt}`} className="border-b border-gray-200 last:border-0">
                    <td className="px-3 py-2 text-gray-700">{formatDateTime(entry.savedAt)}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.destination || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.itemName || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.trackingId || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.truckNumber || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.shipDate || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.expectedDepartureTime || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.origin || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        className="hover:cursor-pointer"
                        variant="outline"
                        onClick={() => handleRemoveEntry(index)}
                      >
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

