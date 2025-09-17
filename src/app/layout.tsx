import type { Metadata } from 'next';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'Warehouse Scanning Console',
  description:
    'Scan warehouse tickets, reconcile them with booking records, and monitor storage level updates in real time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="transition-colors bg-background text-foreground">{children}</body>
    </html>
  );
}
