import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Home page of the application. It introduces the purpose of the app and
 * provides navigation to the upload/scan page. A theme toggle is available
 * in the header for convenience.
 */
export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center py-20 px-4 space-y-8">
      <div className="flex w-full justify-between items-center max-w-3xl">
        <h1 className="text-3xl font-bold">Order & Map Retrieval</h1>
        <ThemeToggle />
      </div>
      <p className="text-lg text-[var(--color-textSecondary)] max-w-3xl text-center">
        Upload a shipping document or order summary, extract the key/value pairs with our
        OCR-powered pipeline, and retrieve a floor map to help you locate the order in
        the warehouse. This app is built with Next.js 15, Tailwind CSS v4 and a
        SQLite-backed microservice architecture.
      </p>
      <Link href="/upload" className="mt-4">
        <Button className='hover:cursor-pointer'>Scan a Document</Button>
      </Link>
    </main>
  );
}