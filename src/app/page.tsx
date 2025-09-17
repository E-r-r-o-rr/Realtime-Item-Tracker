"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  bookingSamples,
  storageSamples,
  OrderFields,
  StorageRow,
} from '@/data/orderSamples';

const emptyOrder: OrderFields = {
  destination: '',
  itemName: '',
  trackingId: '',
  truckNumber: '',
  shipDate: '',
  expectedDeparture: '',
  origin: '',
};

const columnConfig: { key: keyof OrderFields; label: string }[] = [
  { key: 'destination', label: 'Destination (Rack Number)' },
  { key: 'itemName', label: 'Item Name' },
  { key: 'trackingId', label: 'Tracking ID' },
  { key: 'truckNumber', label: 'Truck Number' },
  { key: 'shipDate', label: 'Ship Date' },
  { key: 'expectedDeparture', label: 'Expected Departure Time' },
  { key: 'origin', label: 'Origin' },
];

type EditableStorageField = 'destination' | 'trackingId' | 'expectedDeparture';

interface ScannedRecord extends OrderFields {
  scannedAt: string;
}

interface CurrentScanState {
  raw: ScannedRecord;
  resolved: OrderFields;
  bookingMatch: boolean;
  bookingMessage: string;
  storageMatch: boolean;
  storageMessage: string;
  storageRowId?: string;
  lastUpdated: string;
}

function formatTimestamp(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function HomePage() {
  const [storageRows, setStorageRows] = useState<StorageRow[]>(() => storageSamples);
  const [manualForm, setManualForm] = useState<OrderFields>({ ...emptyOrder });
  const [selectedSample, setSelectedSample] = useState<string>('');
  const [scannedArchive, setScannedArchive] = useState<ScannedRecord[]>([]);
  const [currentScan, setCurrentScan] = useState<CurrentScanState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const bookingLookup = useMemo(() => {
    const byTracking = new Map<string, OrderFields>();
    for (const order of bookingSamples) {
      byTracking.set(order.trackingId, order);
    }
    return byTracking;
  }, []);

  const handleStorageFieldChange = (
    id: string,
    field: EditableStorageField,
    value: string,
  ) => {
    setStorageRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
    setStatusMessage(
      `Storage row ${id} updated: ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} set to ${value || '—'}.`,
    );
  };

  const refreshCurrentScan = useCallback(() => {
    setCurrentScan((prev) => {
      if (!prev) return prev;
      const now = new Date().toISOString();
      if (!prev.storageRowId) {
        return { ...prev, lastUpdated: now };
      }
      const storageRow = storageRows.find((row) => row.id === prev.storageRowId);
      if (!storageRow) {
        return {
          ...prev,
          storageMatch: false,
          storageMessage: 'Linked storage row was not found during refresh.',
          lastUpdated: now,
        };
      }
      return {
        ...prev,
        resolved: { ...storageRow },
        storageMatch: true,
        storageMessage: `Data refreshed from storage row ${storageRow.id}.`,
        lastUpdated: now,
      };
    });
  }, [storageRows]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshCurrentScan();
    }, 300000); // 5 minutes
    return () => clearInterval(interval);
  }, [refreshCurrentScan]);

  useEffect(() => {
    if (currentScan) {
      refreshCurrentScan();
    }
  }, [storageRows, refreshCurrentScan]);

  const handleScan = useCallback(
    (order: OrderFields) => {
      const now = new Date();
      const scanned: ScannedRecord = {
        ...order,
        scannedAt: now.toISOString(),
      };
      setScannedArchive((prev) => [scanned, ...prev]);

      const bookingMatch = bookingLookup.get(order.trackingId);
      let bookingMessage = 'Booked item not found in the Booking Table.';
      let storageMessage = 'Storage lookup skipped because booking was not located.';
      let resolved: OrderFields = { ...order };
      let storageRowId: string | undefined;
      let storageMatch = false;

      if (bookingMatch) {
        bookingMessage = 'Booking located and verified.';
        const storageRow = storageRows.find(
          (row) => row.truckNumber === order.truckNumber && row.shipDate === order.shipDate,
        );
        if (storageRow) {
          resolved = { ...storageRow };
          storageRowId = storageRow.id;
          storageMatch = true;
          storageMessage = `Linked to storage row ${storageRow.id}.`;
        } else {
          storageMessage = 'Storage entry not found for the scanned truck and ship date.';
        }
      }

      setCurrentScan({
        raw: scanned,
        resolved,
        bookingMatch: Boolean(bookingMatch),
        bookingMessage,
        storageMatch,
        storageMessage,
        storageRowId,
        lastUpdated: now.toISOString(),
      });

      setStatusMessage(
        !bookingMatch
          ? 'Scan saved, but the booking entry was not found.'
          : storageMatch
          ? `Scan saved. Storage row ${storageRowId} applied.`
          : 'Scan saved. Storage entry pending.',
      );
      setSelectedSample('');
      setManualForm({ ...emptyOrder });
    },
    [bookingLookup, storageRows],
  );

  const handleManualChange = (field: keyof OrderFields, value: string) => {
    setManualForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleManualScan = () => {
    const missing = Object.entries(manualForm).filter(([, value]) => !value.trim());
    if (missing.length > 0) {
      setStatusMessage('Please complete all fields before scanning a manual entry.');
      return;
    }
    handleScan(manualForm);
  };

  const handleSampleScan = () => {
    if (!selectedSample) {
      setStatusMessage('Select a booking sample to simulate a scan.');
      return;
    }
    const sample = bookingLookup.get(selectedSample);
    if (!sample) {
      setStatusMessage('The selected booking sample could not be found.');
      return;
    }
    handleScan(sample);
  };

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 lg:px-12">
      <header className="flex flex-col gap-4 pb-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Warehouse Scanning Console</h1>
          <p className="max-w-3xl text-sm text-[var(--color-textSecondary)] md:text-base">
            Scan printed order tickets, validate them against booking records, and keep storage data in sync.
            The console maintains an archive of every scan and continuously refreshes the live buffer from storage.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {statusMessage && (
        <div className="mb-6 rounded-md border border-dashed border-[var(--color-borderColor)] bg-[var(--color-backgroundSecondary)] px-4 py-3 text-sm">
          {statusMessage}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card
          header={<span className="font-semibold">Simulate a Scan with Booking Samples</span>}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <label className="flex-1 text-sm">
              <span className="mb-2 block font-medium">Booking sample</span>
              <select
                className="w-full rounded-md border border-[var(--color-borderColor)] bg-[var(--color-backgroundSecondary)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                value={selectedSample}
                onChange={(event) => setSelectedSample(event.target.value)}
              >
                <option value="">Select a booking to scan…</option>
                {bookingSamples.map((order) => (
                  <option key={order.trackingId} value={order.trackingId}>
                    {order.itemName} — {order.trackingId}
                  </option>
                ))}
              </select>
            </label>
            <Button className="hover:cursor-pointer" onClick={handleSampleScan}>
              Scan Selected Sample
            </Button>
          </div>
        </Card>

        <Card
          header={<span className="font-semibold">Manual Entry Scan</span>}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {columnConfig.map(({ key, label }) => (
              <label key={key} className="text-sm">
                <span className="mb-1 block font-medium">{label}</span>
                <Input
                  type={key === 'shipDate' ? 'date' : key === 'expectedDeparture' ? 'time' : 'text'}
                  value={manualForm[key]}
                  onChange={(event) => handleManualChange(key, event.target.value)}
                  placeholder={label}
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button className="hover:cursor-pointer" onClick={handleManualScan}>
              Scan Manual Entry
            </Button>
            <Button
              className="hover:cursor-pointer"
              variant="outline"
              type="button"
              onClick={() => setManualForm({ ...emptyOrder })}
            >
              Clear Form
            </Button>
          </div>
        </Card>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card header={<span className="font-semibold">Booking Table</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full table-auto text-sm">
              <thead>
                <tr className="bg-[var(--color-backgroundSecondary)]">
                  {columnConfig.map(({ key, label }) => (
                    <th key={key} className="px-3 py-2 text-left font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookingSamples.map((order) => (
                  <tr key={order.trackingId} className="border-t border-[var(--color-borderColor)]">
                    {columnConfig.map(({ key }) => (
                      <td key={key} className="px-3 py-2 align-top">
                        {order[key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card header={<span className="font-semibold">Storage Table (Live Updates)</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full table-auto text-sm">
              <thead>
                <tr className="bg-[var(--color-backgroundSecondary)]">
                  <th className="px-3 py-2 text-left font-semibold">Storage ID</th>
                  {columnConfig.map(({ key, label }) => (
                    <th key={key} className="px-3 py-2 text-left font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {storageRows.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--color-borderColor)]">
                    <td className="px-3 py-2 align-top font-medium">{row.id}</td>
                    {columnConfig.map(({ key }) => (
                      <td key={key} className="px-3 py-2 align-top">
                        {key === 'destination' || key === 'trackingId' || key === 'expectedDeparture' ? (
                          <Input
                            type={key === 'expectedDeparture' ? 'time' : 'text'}
                            value={row[key]}
                            onChange={(event) =>
                              handleStorageFieldChange(row.id, key as EditableStorageField, event.target.value)
                            }
                            className="min-w-[7rem]"
                          />
                        ) : (
                          row[key]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--color-textSecondary)]">
            Destination, Tracking ID, and Expected Departure Time fields accept live edits. Linked scans refresh every five minutes and whenever storage data changes.
          </p>
        </Card>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card header={<span className="font-semibold">Table 1 — Scanned Orders Archive</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full table-auto text-sm">
              <thead>
                <tr className="bg-[var(--color-backgroundSecondary)]">
                  {columnConfig.map(({ key, label }) => (
                    <th key={key} className="px-3 py-2 text-left font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scannedArchive.length === 0 ? (
                  <tr>
                    <td colSpan={columnConfig.length} className="px-3 py-4 text-center text-[var(--color-textSecondary)]">
                      Scan an order ticket to populate the archive.
                    </td>
                  </tr>
                ) : (
                  scannedArchive.map((record) => (
                    <tr
                      key={`${record.trackingId}-${record.scannedAt}`}
                      className="border-t border-[var(--color-borderColor)]"
                    >
                      {columnConfig.map(({ key }) => (
                        <td key={key} className="px-3 py-2 align-top">
                          {record[key]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card header={<span className="font-semibold">Table 2 — Current Scan Buffer & Validation</span>}>
          <div className="space-y-4">
            <div className="rounded-md border border-[var(--color-borderColor)] bg-[var(--color-backgroundSecondary)] px-3 py-2 text-sm">
              <p className="font-medium">Booking Check</p>
              <p className={currentScan?.bookingMatch ? 'text-green-600' : 'text-red-600'}>
                {currentScan ? currentScan.bookingMessage : 'Awaiting scan.'}
              </p>
            </div>
            <div className="rounded-md border border-[var(--color-borderColor)] bg-[var(--color-backgroundSecondary)] px-3 py-2 text-sm">
              <p className="font-medium">Storage Check</p>
              <p className={currentScan?.storageMatch ? 'text-green-600' : 'text-amber-600'}>
                {currentScan
                  ? currentScan.storageMessage
                  : 'Storage data will be evaluated after a scan is recorded.'}
              </p>
              {currentScan?.storageRowId && (
                <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
                  Tracking storage row: {currentScan.storageRowId}. Last updated {formatTimestamp(currentScan.lastUpdated)}.
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto text-sm">
                <thead>
                  <tr className="bg-[var(--color-backgroundSecondary)]">
                    {columnConfig.map(({ key, label }) => (
                      <th key={key} className="px-3 py-2 text-left font-semibold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentScan ? (
                    <tr className="border-t border-[var(--color-borderColor)]">
                      {columnConfig.map(({ key }) => (
                        <td key={key} className="px-3 py-2 align-top">
                          {currentScan.resolved[key]}
                        </td>
                      ))}
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={columnConfig.length} className="px-3 py-4 text-center text-[var(--color-textSecondary)]">
                        Waiting for the first scan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button className="hover:cursor-pointer" variant="outline" onClick={() => refreshCurrentScan()}>
                Refresh from Storage Now
              </Button>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Automatic refresh runs every 5 minutes and whenever storage data changes.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}
