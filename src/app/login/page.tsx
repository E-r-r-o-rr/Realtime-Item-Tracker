import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getSessionFromCookies } from "@/lib/auth";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const session = await getSessionFromCookies(cookieStore);
  if (session) {
    redirect("/");
  }

  return (
    <div className="relative z-10 mx-auto flex min-h-[calc(100vh-160px)] w-full max-w-md flex-col justify-center px-4 py-14 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-8 shadow-2xl shadow-indigo-950/40 backdrop-blur-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-slate-100">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-300/80">
            Sign in to access scanning, storage, and warehouse management tools.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
