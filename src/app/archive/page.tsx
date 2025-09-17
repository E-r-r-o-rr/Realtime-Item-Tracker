import { listScannedOrders } from '@/lib/warehouse';
import { Card } from '@/components/ui/card';
import { ORDER_FIELD_KEYS, ORDER_FIELD_LABELS } from '@/types/warehouse';

export const dynamic = 'force-dynamic';

export default function ArchivePage() {
  const archive = listScannedOrders(200);
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Scanned Orders Archive</h1>
        <p className="text-sm text-[var(--color-foreground)]/80">
          Every scanned ticket is stored here in chronological order. Use this table to review historical scans or audit
          validation outcomes.
        </p>
      </header>
      <Card header={<span className="font-semibold">Latest Scans</span>}>
        <div className="overflow-x-auto text-sm">
          <table className="min-w-full table-auto">
            <thead>
              <tr className="bg-[var(--color-card)]">
                <th className="px-3 py-2 text-left font-semibold">Scanned At</th>
                {ORDER_FIELD_KEYS.map((key) => (
                  <th key={key} className="px-3 py-2 text-left font-semibold">
                    {ORDER_FIELD_LABELS[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {archive.length === 0 ? (
                <tr>
                  <td colSpan={ORDER_FIELD_KEYS.length + 1} className="px-3 py-4 text-center text-[var(--color-foreground)]/70">
                    Archive will populate after the first scan.
                  </td>
                </tr>
              ) : (
                archive.map((record) => (
                  <tr key={`${record.trackingId}-${record.scannedAt}`} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2 align-top">{formatTimestamp(record.scannedAt)}</td>
                    {ORDER_FIELD_KEYS.map((key) => (
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
    </div>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
