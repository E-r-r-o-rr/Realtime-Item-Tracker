import ScannerDashboard from "@/components/scanner/dashboard";

export default function HomePage() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <section className="mb-12 text-center">
        <div className="mx-auto max-w-3xl space-y-6">
          <span className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
            <span className="h-2 w-2 rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-500" />
            OCR Control Center
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-slate-100 sm:text-5xl md:text-6xl">
            Extract supply chain intelligence with <span className="text-gradient">Realtime precision</span>
          </h1>
          <p className="text-lg text-slate-300/90">
            Drag in manifests, capture live paperwork, and instantly transform messy documents into structured data. Our
            adaptive OCR, barcode reconciliation, and spatial routing views keep every order flowing to the right dock.
          </p>
        </div>
      </section>
      <ScannerDashboard />
    </div>
  );
}