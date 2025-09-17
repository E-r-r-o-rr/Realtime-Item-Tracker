import type { Metadata } from 'next';
import Link from 'next/link';
import '@/app/globals.css';
import { ThemeToggle } from '@/components/theme-toggle';

const navLinks = [
  { href: '/scan', label: 'Scan' },
  { href: '/current', label: 'Current Scan' },
  { href: '/bookings', label: 'Bookings' },
  { href: '/storage', label: 'Storage' },
  { href: '/archive', label: 'Archive' },
];

export const metadata: Metadata = {
  title: 'Warehouse Scanning Console',
  description:
    'Scan printed order tickets, reconcile them with bookings, and keep storage data synchronized in real time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <div className="min-h-screen bg-background text-foreground">
          <header className="border-b border-[var(--color-border)] bg-[var(--color-card)]">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
              <div className="flex items-center gap-6">
                <Link href="/" className="text-lg font-semibold hover:text-[var(--color-accent)]">
                  Realtime Item Tracker
                </Link>
                <nav className="hidden items-center gap-4 text-sm font-medium md:flex">
                  {navLinks.map((link) => (
                    <Link key={link.href} href={link.href} className="transition-colors hover:text-[var(--color-accent)]">
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </div>
              <div className="flex items-center gap-4">
                <nav className="flex items-center gap-3 text-sm font-medium md:hidden">
                  {navLinks.map((link) => (
                    <Link key={link.href} href={link.href} className="transition-colors hover:text-[var(--color-accent)]">
                      {link.label}
                    </Link>
                  ))}
                </nav>
                <ThemeToggle />
              </div>
            </div>
          </header>
          <main className="mx-auto flex max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
