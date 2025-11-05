"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface StorageRow {
  id: number;
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  originLocation: string;
  booked: boolean;
  lastUpdated: string;
}

interface BookingRow {
  id: number;
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  originLocation: string;
  createdAt: string;
}

const melbourneFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Melbourne",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

const formatDateTime = (value: string) => {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return melbourneFormatter.format(date);
  } catch {
    return value;
  }
};

type EditableField = "destination" | "trackingId" | "expectedDepartureTime";

const fieldToPayloadKey: Record<EditableField, string> = {
  destination: "destination",
  trackingId: "newTrackingId",
  expectedDepartureTime: "expectedDepartureTime",
};

interface OrderFormState {
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  originLocation: string;
  booked: boolean;
}

const initialOrderState: OrderFormState = {
  destination: "",
  itemName: "",
  trackingId: "",
  truckNumber: "",
  shipDate: "",
  expectedDepartureTime: "",
  originLocation: "",
  booked: false,
};

const requiredOrderFields: Array<Exclude<keyof OrderFormState, "booked">> = [
  "destination",
  "itemName",
  "trackingId",
  "truckNumber",
  "shipDate",
  "expectedDepartureTime",
  "originLocation",
];

export default function StoragePage() {
  const [storage, setStorage] = useState<StorageRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [newOrder, setNewOrder] = useState<OrderFormState>(initialOrderState);

  const applyPayload = useCallback(
    (payload: any, previousTrackingId?: string) => {
      if (!payload) return;
      if (Array.isArray(payload.storage)) {
        setStorage(payload.storage as StorageRow[]);
      } else if (payload.storage) {
        const updated = payload.storage as StorageRow;
        setStorage((prev) => {
          const base = previousTrackingId
            ? prev.filter((item) => item.trackingId !== previousTrackingId)
            : [...prev];
          const existingIndex = base.findIndex((item) => item.trackingId === updated.trackingId);
          if (existingIndex >= 0) {
            base[existingIndex] = updated;
          } else {
            base.unshift(updated);
          }
          return [...base];
        });
      }
      if (Array.isArray(payload.bookings)) {
        setBookings(payload.bookings as BookingRow[]);
      }
    },
    []
  );

  const fetchStorage = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/storage", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : response.statusText);
      }
      applyPayload(payload);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load storage data.");
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    fetchStorage();
  }, [fetchStorage]);

  const bookingsSubset = useMemo(() => bookings, [bookings]);

  const mutate = useCallback(
    async (input: RequestInfo, init?: RequestInit, previousTrackingId?: string) => {
      setLoading(true);
      try {
        const response = await fetch(input, init);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : response.statusText);
        }
        applyPayload(payload, previousTrackingId);
        setError(null);
        return true;
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Storage update failed.");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [applyPayload]
  );

  const handleNewOrderChange = (field: keyof OrderFormState, value: string | boolean) => {
    setNewOrder((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = {
      destination: newOrder.destination.trim(),
      itemName: newOrder.itemName.trim(),
      trackingId: newOrder.trackingId.trim(),
      truckNumber: newOrder.truckNumber.trim(),
      shipDate: newOrder.shipDate.trim(),
      expectedDepartureTime: newOrder.expectedDepartureTime.trim(),
      originLocation: newOrder.originLocation.trim(),
      booked: newOrder.booked,
    };
    const success = await mutate("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (success) {
      setNewOrder(initialOrderState);
    }
  };

  const isCreateDisabled = useMemo(
    () => loading || requiredOrderFields.some((field) => newOrder[field].trim().length === 0),
    [loading, newOrder]
  );

  const toggleBooked = (record: StorageRow, value: boolean) => {
    mutate(
      `/api/storage/${encodeURIComponent(record.trackingId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booked: value }),
      },
      record.trackingId
    );
  };

  const commitField = (record: StorageRow, field: EditableField, value: string) => {
    const trimmed = value.trim();
    let currentValue = record.destination;
    if (field === "trackingId") {
      currentValue = record.trackingId;
    } else if (field === "expectedDepartureTime") {
      currentValue = record.expectedDepartureTime;
    }
    if (trimmed === currentValue) return;
    mutate(
      `/api/storage/${encodeURIComponent(record.trackingId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldToPayloadKey[field]]: trimmed }),
      },
      record.trackingId
    );
  };

  const removeRow = (record: StorageRow) => {
    mutate(`/api/storage/${encodeURIComponent(record.trackingId)}`, { method: "DELETE" }, record.trackingId);
  };

  const handleSeed = () => {
    mutate(
      "/api/storage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed", count: 15 }),
      }
    );
  };

  const handleClear = () => {
    mutate("/api/storage", { method: "DELETE" });
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
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>

      <Card
        className="mb-10"
        header={<span className="text-lg font-semibold text-slate-100">Create new storage order</span>}
      >
        <form onSubmit={handleCreateOrder} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm text-slate-300/80">
              Destination (rack)
              <Input
                value={newOrder.destination}
                onChange={(event) => handleNewOrderChange("destination", event.target.value)}
                placeholder="e.g. Rack A3"
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-300/80">
              Item name
              <Input
                value={newOrder.itemName}
                onChange={(event) => handleNewOrderChange("itemName", event.target.value)}
                placeholder="e.g. Pallet of routers"
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-300/80">
              Tracking ID
              <Input
                value={newOrder.trackingId}
                onChange={(event) => handleNewOrderChange("trackingId", event.target.value)}
                placeholder="e.g. RT-458392"
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-300/80">
              Truck number
              <Input
                value={newOrder.truckNumber}
                onChange={(event) => handleNewOrderChange("truckNumber", event.target.value)}
                placeholder="e.g. VIC-42"
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-300/80">
              Ship date
              <Input
                value={newOrder.shipDate}
                onChange={(event) => handleNewOrderChange("shipDate", event.target.value)}
                placeholder="YYYY-MM-DD"
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-300/80">
              Expected departure time
              <Input
                value={newOrder.expectedDepartureTime}
                onChange={(event) => handleNewOrderChange("expectedDepartureTime", event.target.value)}
                placeholder="e.g. 16:45"
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-300/80 sm:col-span-2 lg:col-span-3">
              Origin location
              <Input
                value={newOrder.originLocation}
                onChange={(event) => handleNewOrderChange("originLocation", event.target.value)}
                placeholder="e.g. Melbourne DC"
                required
              />
            </label>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-3 text-sm text-slate-300/80">
              <input
                type="checkbox"
                checked={newOrder.booked}
                onChange={(event) => handleNewOrderChange("booked", event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-transparent text-indigo-400 focus:ring-indigo-400/70"
              />
              Mark as booked immediately
            </label>
            <Button type="submit" disabled={isCreateDisabled}>
              Add to storage
            </Button>
          </div>
        </form>
      </Card>

      <Card
        className="mb-10"
        header={<span className="text-lg font-semibold text-slate-100">Storage</span>}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300/80">
            <span>
              {storage.length} rows in storage • {bookingsSubset.length} booked
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSeed} disabled={loading}>
                Seed 15 sample rows
              </Button>
              <Button variant="outline" onClick={handleClear} disabled={storage.length === 0 || loading}>
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
                {storage.map((record) => (
                  <tr key={record.id} className="border-b border-white/10 last:border-0">
                    <td className="px-4 py-3 text-slate-200">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={record.booked}
                          onChange={(e) => toggleBooked(record, e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-transparent text-indigo-400 focus:ring-indigo-400/70"
                        />
                        <span className={`text-xs font-semibold ${record.booked ? "text-emerald-400" : "text-slate-400"}`}>
                          {record.booked ? "Booked" : "Not booked"}
                        </span>
                      </label>
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      <Input
                        key={`${record.id}-destination-${record.lastUpdated}`}
                        defaultValue={record.destination}
                        onBlur={(e) => commitField(record, "destination", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-200">{record.itemName}</td>
                    <td className="px-4 py-3 text-slate-200">
                      <Input
                        key={`${record.id}-tracking-${record.lastUpdated}`}
                        defaultValue={record.trackingId}
                        onBlur={(e) => commitField(record, "trackingId", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-200">{record.truckNumber}</td>
                    <td className="px-4 py-3 text-slate-200">{record.shipDate}</td>
                    <td className="px-4 py-3 text-slate-200">
                      <Input
                        key={`${record.id}-departure-${record.lastUpdated}`}
                        defaultValue={record.expectedDepartureTime}
                        onBlur={(e) => commitField(record, "expectedDepartureTime", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-200">{record.originLocation}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatDateTime(record.lastUpdated)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" onClick={() => removeRow(record)} disabled={loading}>
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
        {bookingsSubset.length === 0 ? (
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
                {bookingsSubset.map((record) => (
                  <tr key={`${record.trackingId}-${record.createdAt}`} className="border-b border-white/10 last:border-0">
                    <td className="px-4 py-3 text-slate-200">{record.destination}</td>
                    <td className="px-4 py-3 text-slate-200">{record.itemName}</td>
                    <td className="px-4 py-3 text-slate-200">{record.trackingId}</td>
                    <td className="px-4 py-3 text-slate-200">{record.truckNumber}</td>
                    <td className="px-4 py-3 text-slate-200">{record.shipDate}</td>
                    <td className="px-4 py-3 text-slate-200">{record.expectedDepartureTime}</td>
                    <td className="px-4 py-3 text-slate-200">{record.originLocation}</td>
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
