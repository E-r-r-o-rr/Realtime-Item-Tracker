import { listBookings } from '@/lib/warehouse';
import { Card } from '@/components/ui/card';
import { ORDER_FIELD_KEYS, ORDER_FIELD_LABELS } from '@/types/warehouse';

export const dynamic = 'force-static';

export default function BookingsPage() {
  const bookings = listBookings();
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Booking Table</h1>
        <p className="text-sm text-[var(--color-foreground)]/80">
          Ten seeded bookings are available for validation. Each row matches the seven required columns described in the
          project brief.
        </p>
      </header>
      <Card header={<span className="font-semibold">Current Bookings</span>}>
        <div className="overflow-x-auto text-sm">
          <table className="min-w-full table-auto">
            <thead>
              <tr className="bg-[var(--color-card)]">
                {ORDER_FIELD_KEYS.map((key) => (
                  <th key={key} className="px-3 py-2 text-left font-semibold">
                    {ORDER_FIELD_LABELS[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.trackingId} className="border-t border-[var(--color-border)]">
                  {ORDER_FIELD_KEYS.map((key) => (
                    <td key={key} className="px-3 py-2 align-top">
                      {booking[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
