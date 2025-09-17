import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { ORDER_FIELD_LABELS, ORDER_FIELD_KEYS } from '@/types/warehouse';

const fieldSummaries = [
  'Destination (Rack Number) — where the item is staged for loading.',
  'Item Name — the product description that appears on the ticket.',
  'Tracking ID — the primary key used to match bookings.',
  'Truck Number — equipment assigned to the load.',
  'Ship Date — planned pickup date for the shipment.',
  'Expected Departure Time — latest departure commitment.',
  'Origin — origin warehouse or plant.',
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold">Warehouse Scanning Console</h1>
        <p className="max-w-3xl text-base text-[var(--color-foreground)]/80">
          Use the navigation to upload or simulate scans, review live bookings and storage assignments, and monitor the
          validation buffer that refreshes every five minutes. All scans are archived automatically for traceability.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/scan"
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 font-semibold text-white transition-colors hover:bg-[var(--color-accent)]/90"
          >
            Start Scanning
          </Link>
          <Link
            href="/bookings"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 font-semibold transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            Review Booking Table
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {fieldSummaries.map((summary, index) => {
          const key = ORDER_FIELD_KEYS[index];
          return (
            <Card key={summary} header={<span className="font-semibold">{ORDER_FIELD_LABELS[key]}</span>}>
              <p className="text-sm text-[var(--color-foreground)]/80">{summary}</p>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card header={<span className="font-semibold">Scan Workflow</span>}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--color-foreground)]/80">
            <li>Upload an order ticket on the Scan page or simulate a scan using a seeded booking.</li>
            <li>The system OCRs the ticket, normalizes the seven required fields, and stores the record.</li>
            <li>Each scan is copied to the archive table and the single-row current buffer.</li>
            <li>A validation job compares the scan against bookings and storage, refreshing every five minutes.</li>
          </ol>
        </Card>
        <Card header={<span className="font-semibold">Where to Look</span>}>
          <ul className="space-y-2 text-sm text-[var(--color-foreground)]/80">
            <li>
              <strong>Bookings:</strong> seeded expectations for upcoming loads.
            </li>
            <li>
              <strong>Storage:</strong> live rack assignments with editable destination, tracking ID, and departure time.
            </li>
            <li>
              <strong>Current Scan:</strong> validation buffer that mirrors the latest scan.
            </li>
            <li>
              <strong>Archive:</strong> running history of every scanned ticket.
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
