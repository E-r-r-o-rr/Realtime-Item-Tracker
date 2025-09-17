import type { Metadata } from 'next';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'Order & Map Retrieval',
  description: 'Upload order documents, extract key/value pairs, and retrieve floor maps.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning /* add 'dark' here if you want to force dark: className="dark" */>
      <body className="transition-colors bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
