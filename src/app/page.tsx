import ScannerDashboard from "@/components/scanner/dashboard";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-gray-900">OCR Order Scanner</h1>
        <p className="max-w-3xl text-base text-gray-600">
          Keep your operations organized with a live buffer for the latest scan, a searchable history of completed runs,
          and a storage view built for warehouse coordination. Upload, validate, and route orders without leaving this
          dashboard.
        </p>
      </div>
      <ScannerDashboard />
    </div>
  );
}