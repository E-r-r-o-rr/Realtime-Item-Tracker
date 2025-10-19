import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

import { getFloorMapById } from "@/lib/db";

type RouteParams = { id: string };

const parseId = async (context: { params: Promise<RouteParams> }) => {
  const { id } = await context.params;
  const numericId = Number(id);
  return Number.isFinite(numericId) ? numericId : NaN;
};

const extensionToMime: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function GET(_: NextRequest, context: { params: Promise<RouteParams> }) {
  const id = await parseId(context);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid map id" }, { status: 400 });
  }
  const map = getFloorMapById(id);
  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }
  const absolutePath = path.join(process.cwd(), "data", map.imagePath);
  try {
    const data = await fs.readFile(absolutePath);
    const extension = map.imagePath.split(".").pop()?.toLowerCase() ?? "png";
    const contentType = extensionToMime[extension] ?? "application/octet-stream";
    const body = new Uint8Array(data);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (error) {
    console.error("Failed to read map image", error);
    return NextResponse.json({ error: "Map image not found" }, { status: 404 });
  }
}
