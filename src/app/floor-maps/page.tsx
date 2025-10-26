"use client";

import { FloorMapAdmin } from "@/components/scanner/floor-map-admin";

export default function FloorMapsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 pb-16 pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-slate-100">Map administration</h1>
        <p className="text-sm text-slate-300/80">
          Upload floor layouts, manage destination tags, and annotate wayfinding points for the navigation workflow.
        </p>
      </div>
      <FloorMapAdmin />
    </div>
  );
}
