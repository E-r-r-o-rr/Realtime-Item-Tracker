"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fallbackNavigationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (fallbackNavigationRef.current) {
        clearTimeout(fallbackNavigationRef.current);
        fallbackNavigationRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const normalizedUsername = (formData.get("username") as string | null)?.trim() ?? "";
    const normalizedPassword = (formData.get("password") as string | null) ?? "";

    if (!normalizedUsername || !normalizedPassword) {
      setError("Please provide both a username and password.");
      return;
    }

    setPending(true);
    setError(null);

    let shouldResetPending = true;

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: normalizedUsername, password: normalizedPassword }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        switch (data.error) {
          case "missing_credentials":
            setError("Please provide both a username and password.");
            break;
          case "invalid_credentials":
            setError("The provided credentials are incorrect.");
            break;
          default:
            setError("Unable to sign in with those credentials.");
            break;
        }
        return;
      }

      const nextParam = searchParams?.get("next");
      const isSafeRedirect = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//");
      const target = isSafeRedirect ? nextParam : "/";

      shouldResetPending = false;
      router.replace(target);

      if (typeof window !== "undefined") {
        fallbackNavigationRef.current = window.setTimeout(() => {
          if (window.location.pathname === "/login") {
            window.location.replace(target);
          }
        }, 1200);
      }
    } catch {
      setError("Something went wrong while signing in. Please try again.");
    } finally {
      if (shouldResetPending) {
        setPending(false);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" suppressHydrationWarning>
      <div className="space-y-2">
        <label htmlFor="username" className="text-sm font-medium text-slate-200">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-100 shadow-inner shadow-black/40 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60"
          placeholder="Enter your username"
          required
          suppressHydrationWarning
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-slate-200">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-100 shadow-inner shadow-black/40 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60"
          placeholder="Enter your password"
          required
          suppressHydrationWarning
        />
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-xs text-slate-400">
        Default credentials: <span className="font-semibold text-slate-200">admin / admin</span>
      </p>
    </form>
  );
}
