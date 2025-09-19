import type { Metadata } from "next";
import "@/app/globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "OrderScanner Pro",
  description: "Scan orders, review history, and manage storage in a unified workspace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-gray-50 text-gray-900 transition-colors">
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="flex-1 bg-gray-50">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
