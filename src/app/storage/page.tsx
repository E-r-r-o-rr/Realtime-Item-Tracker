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
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-gray-900">Storage &amp; Bookings</h1>
        <p className="max-w-3xl text-base text-gray-600">
          Manage the editable storage table that powers bookings. Toggle the booked state, adjust rack assignments, and keep
          expected departure times current. Edits are persisted locally so your staging data is ready for the next shift.
        </p>
      </div>

      <Card
        className="mb-8 bg-white"
        header={<span className="font-medium text-gray-900">Storage</span>}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
            <span>
              {storage.length} rows in storage • {bookings.length} booked
            </span>
            <div className="flex gap-2">
              <Button className="hover:cursor-pointer" variant="outline" onClick={handleSeed}>
                Seed 15 sample rows
              </Button>
              <Button
                className="hover:cursor-pointer"
                variant="outline"
                onClick={handleClear}
                disabled={storage.length === 0}
              >
                Clear Storage
              </Button>
            </div>
          </div>
        }
      >
        {storage.length === 0 ? (
          <p className="text-sm text-gray-500">Storage is empty. Seed sample rows or write items from the live buffer.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Booked</th>
                  <th className="px-3 py-2">Destination (Rack)</th>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2">Tracking ID</th>
                  <th className="px-3 py-2">Truck #</th>
                  <th className="px-3 py-2">Ship Date</th>
                  <th className="px-3 py-2">Expected Departure</th>
                  <th className="px-3 py-2">Origin</th>
                  <th className="px-3 py-2">Last Updated</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {storage.map((record, index) => (
                  <tr key={`${record.trackingId}-${index}`} className="border-b border-gray-200 last:border-0">
                    <td className="px-3 py-2 text-gray-700">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={record.booked}
                          onChange={(e) => toggleBooked(index, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className={`text-xs ${record.booked ? "text-green-600" : "text-gray-500"}`}>
                          {record.booked ? "Booked" : "Not booked"}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <Input
                        value={record.destination}
                        onChange={(e) => updateField(index, "destination", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-700">{record.itemName}</td>
                    <td className="px-3 py-2 text-gray-700">
                      <Input value={record.trackingId} onChange={(e) => updateField(index, "trackingId", e.target.value)} />
                    </td>
                    <td className="px-3 py-2 text-gray-700">{record.truckNumber}</td>
                    <td className="px-3 py-2 text-gray-700">{record.shipDate}</td>
                    <td className="px-3 py-2 text-gray-700">
                      <Input
                        value={record.expectedDepartureTime}
                        onChange={(e) => updateField(index, "expectedDepartureTime", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-700">{record.origin}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(record.lastUpdated)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button className="hover:cursor-pointer" variant="outline" onClick={() => removeRow(index)}>
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

      <Card className="bg-white" header={<span className="font-medium text-gray-900">Bookings</span>}>
        {bookings.length === 0 ? (
          <p className="text-sm text-gray-500">No bookings yet. Mark storage rows as booked to populate this table.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Destination (Rack)</th>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2">Tracking ID</th>
                  <th className="px-3 py-2">Truck #</th>
                  <th className="px-3 py-2">Ship Date</th>
                  <th className="px-3 py-2">Expected Departure</th>
                  <th className="px-3 py-2">Origin</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((record) => (
                  <tr key={`${record.trackingId}-${record.lastUpdated}`} className="border-b border-gray-200 last:border-0">
                    <td className="px-3 py-2 text-gray-700">{record.destination}</td>
                    <td className="px-3 py-2 text-gray-700">{record.itemName}</td>
                    <td className="px-3 py-2 text-gray-700">{record.trackingId}</td>
                    <td className="px-3 py-2 text-gray-700">{record.truckNumber}</td>
                    <td className="px-3 py-2 text-gray-700">{record.shipDate}</td>
                    <td className="px-3 py-2 text-gray-700">{record.expectedDepartureTime}</td>
                    <td className="px-3 py-2 text-gray-700">{record.origin}</td>
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

