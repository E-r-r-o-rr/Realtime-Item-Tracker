export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-6 text-center text-sm text-gray-500 sm:px-6 lg:px-8">
        &copy; {new Date().getFullYear()} OrderScanner Pro. All rights reserved.
      </div>
    </footer>
  );
}

