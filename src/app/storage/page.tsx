"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  StorageRecord,
  loadStorageRecords,
  persistStorageRecords,
  seedStorageRecords,
  clearStorageRecords,
} from "@/lib/localStorage";

const formatDateTime = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

type EditableField = "destination" | "trackingId" | "expectedDepartureTime";

export default function StoragePage() {
  const [storage, setStorage] = useState<StorageRecord[]>([]);

  useEffect(() => {
    const current = loadStorageRecords();
    if (current.length === 0) {
      setStorage(seedStorageRecords(15));
    } else {
      setStorage(current);
    }
  }, []);

  const bookings = useMemo(() => storage.filter((item) => item.booked), [storage]);

  const updateStorage = (updater: (records: StorageRecord[]) => StorageRecord[]) => {
    setStorage((prev) => {
      const next = updater([...prev.map((item) => ({ ...item }))]);
      persistStorageRecords(next);
      return next;
    });
  };

  const toggleBooked = (index: number, value: boolean) => {
    updateStorage((records) => {
      if (!records[index]) return records;
      records[index].booked = value;
      records[index].lastUpdated = new Date().toISOString();
      return records;
    });
  };

  const updateField = (index: number, field: EditableField, value: string) => {
    updateStorage((records) => {
      if (!records[index]) return records;
      records[index][field] = value;
      records[index].lastUpdated = new Date().toISOString();
      return records;
    });
  };

  const removeRow = (index: number) => {
    updateStorage((records) => records.filter((_, i) => i !== index));
  };

  const handleSeed = () => {
    setStorage(seedStorageRecords(15));
  };

  const handleClear = () => {
    clearStorageRecords();
    setStorage([]);
  };

  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-10 flex flex-col gap-4">
        <h1 className="text-4xl font-semibold text-slate-100">
          Storage &amp; <span className="text-gradient">bookings</span>
        </h1>
        <p className="max-w-3xl text-base text-slate-300/90">
          Manage booking states, rack assignments, and departure timings in a glassy workspace that keeps staging and
          loading crews aligned.
        </p>
      </div>

      <Card
        className="mb-10"
        header={<span className="text-lg font-semibold text-slate-100">Storage</span>}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300/80">
            <span>
              {storage.length} rows in storage • {bookings.length} booked
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSeed}>
                Seed 15 sample rows
              </Button>
              <Button variant="outline" onClick={handleClear} disabled={storage.length === 0}>
                Clear storage
              </Button>
            </div>
          </div>
        }
      >
        {storage.length === 0 ? (
          <p className="text-sm text-slate-300/80">
            Storage is empty. Seed sample rows or write items from the live buffer to populate slots.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-left text-xs font-medium uppercase tracking-wide text-slate-300/80">
                <tr>
                  <th className="px-4 py-3">Booked</th>
                  <th className="px-4 py-3">Destination (rack)</th>
                  <th className="px-4 py-3">Item name</th>
                  <th className="px-4 py-3">Tracking ID</th>
                  <th className="px-4 py-3">Truck #</th>
                  <th className="px-4 py-3">Ship date</th>
                  <th className="px-4 py-3">Expected departure</th>
                  <th className="px-4 py-3">Origin</th>
                  <th className="px-4 py-3">Last updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {storage.map((record, index) => (
                  <tr key={`${record.trackingId}-${index}`} className="border-b border-white/10 last:border-0">
                    <td className="px-4 py-3 text-slate-200">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={record.booked}
                          onChange={(e) => toggleBooked(index, e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-transparent text-indigo-400 focus:ring-indigo-400/70"
                        />
                        <span className={`text-xs font-semibold ${record.booked ? "text-emerald-400" : "text-slate-400"}`}>
                          {record.booked ? "Booked" : "Not booked"}
                        </span>
                      </label>
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      <Input
                        value={record.destination}
                        onChange={(e) => updateField(index, "destination", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-200">{record.itemName}</td>
                    <td className="px-4 py-3 text-slate-200">
                      <Input value={record.trackingId} onChange={(e) => updateField(index, "trackingId", e.target.value)} />
                    </td>
                    <td className="px-4 py-3 text-slate-200">{record.truckNumber}</td>
                    <td className="px-4 py-3 text-slate-200">{record.shipDate}</td>
                    <td className="px-4 py-3 text-slate-200">
                      <Input
                        value={record.expectedDepartureTime}
                        onChange={(e) => updateField(index, "expectedDepartureTime", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-200">{record.origin}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatDateTime(record.lastUpdated)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" onClick={() => removeRow(index)}>
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

      <Card header={<span className="text-lg font-semibold text-slate-100">Bookings</span>}>
        {bookings.length === 0 ? (
          <p className="text-sm text-slate-300/80">No bookings yet. Mark storage rows as booked to populate this table.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-left text-xs font-medium uppercase tracking-wide text-slate-300/80">
                <tr>
                  <th className="px-4 py-3">Destination (rack)</th>
                  <th className="px-4 py-3">Item name</th>
                  <th className="px-4 py-3">Tracking ID</th>
                  <th className="px-4 py-3">Truck #</th>
                  <th className="px-4 py-3">Ship date</th>
                  <th className="px-4 py-3">Expected departure</th>
                  <th className="px-4 py-3">Origin</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((record) => (
                  <tr key={`${record.trackingId}-${record.lastUpdated}`} className="border-b border-white/10 last:border-0">
                    <td className="px-4 py-3 text-slate-200">{record.destination}</td>
                    <td className="px-4 py-3 text-slate-200">{record.itemName}</td>
                    <td className="px-4 py-3 text-slate-200">{record.trackingId}</td>
                    <td className="px-4 py-3 text-slate-200">{record.truckNumber}</td>
                    <td className="px-4 py-3 text-slate-200">{record.shipDate}</td>
                    <td className="px-4 py-3 text-slate-200">{record.expectedDepartureTime}</td>
                    <td className="px-4 py-3 text-slate-200">{record.origin}</td>
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

