import type { CurrentScanRecord } from '@/types/warehouse';
import { ORDER_FIELD_KEYS, ORDER_FIELD_LABELS } from '@/types/warehouse';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface CurrentScanPanelProps {
  currentScan: CurrentScanRecord | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function CurrentScanPanel({ currentScan, onRefresh, refreshing }: CurrentScanPanelProps) {
  return (
    <Card header={<span className="font-semibold">Table 2 — Current Scan Buffer &amp; Validation</span>}>
      <div className="space-y-4 text-sm">
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
          <p className="font-medium">Booking Check</p>
          <p className={currentScan?.bookingMatch ? 'text-green-600' : 'text-red-600'}>
            {currentScan ? currentScan.bookingMessage : 'Awaiting scan.'}
          </p>
        </div>
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
          <p className="font-medium">Storage Check</p>
          <p className={currentScan?.storageMatch ? 'text-green-600' : 'text-amber-600'}>
            {currentScan ? currentScan.storageMessage : 'Storage validation runs when a scan is recorded.'}
          </p>
          {currentScan?.storageRowId && (
            <p className="mt-1 text-xs text-[var(--color-foreground)]/70">
              Tracking storage row: {currentScan.storageRowId}. Last refreshed {formatTimestamp(currentScan.lastRefreshed)}.
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full table-auto text-sm">
            <thead>
              <tr className="bg-[var(--color-card)]">
                <th className="px-3 py-2 text-left font-semibold">Field</th>
                <th className="px-3 py-2 text-left font-semibold">Raw Scan</th>
                <th className="px-3 py-2 text-left font-semibold">Resolved Value</th>
              </tr>
            </thead>
            <tbody>
              {currentScan ? (
                ORDER_FIELD_KEYS.map((key) => (
                  <tr key={key} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2 align-top font-medium">{ORDER_FIELD_LABELS[key]}</td>
                    <td className="px-3 py-2 align-top">{currentScan.raw[key]}</td>
                    <td className="px-3 py-2 align-top">{currentScan.resolved[key]}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-[var(--color-foreground)]/70">
                    Waiting for the first scan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {onRefresh && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-foreground)]/70">
            <Button
              type="button"
              className="hover:cursor-pointer"
              variant="outline"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh from Storage Now'}
            </Button>
            <span>Automatic validation runs every five minutes.</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
