import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createExpiredSessionCookie } from "@/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(createExpiredSessionCookie());
  return NextResponse.json({ success: true });
}
