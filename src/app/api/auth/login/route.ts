import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const SESSION_COOKIE = "rt_session";
const DEFAULT_PASSWORD = "demo-access";
const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

export async function POST(request: NextRequest) {
  const { password } = await request.json().catch(() => ({ password: "" }));
  const expectedPassword = process.env.DASHBOARD_PASSWORD || DEFAULT_PASSWORD;

  if (typeof password !== "string" || password !== expectedPassword) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return response;
}
