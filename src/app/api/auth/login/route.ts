import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  createSession,
  createSessionCookie,
  getAllowedCredentials,
} from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { username, password } = (await request.json()) as {
      username?: string;
      password?: string;
    };

    if (!username || !password) {
      return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
    }

    const { username: allowedUsername, password: allowedPassword } = getAllowedCredentials();

    if (username !== allowedUsername || password !== allowedPassword) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }

    const sessionToken = await createSession(username);
    const cookie = createSessionCookie(sessionToken);
    const cookieStore = await cookies();
    cookieStore.set(cookie);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
}
