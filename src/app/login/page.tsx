"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DEFAULT_HINT = process.env.NEXT_PUBLIC_PASSWORD_HINT || "demo-access";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [redirectTo, setRedirectTo] = useState("/");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const next = params.get("redirect");
    if (next) {
      setRedirectTo(next);
    }
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload.error === "string" ? payload.error : "Login failed";
        setStatus(message);
        return;
      }
      window.location.href = redirectTo;
    } catch (error) {
      console.error("Login failed", error);
      setStatus("Login failed. Check your network connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-3xl border border-white/10 bg-slate-900/70 p-8 shadow-xl backdrop-blur">
        <div className="space-y-2 text-center">
          <span className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-indigo-200">
            Secure workspace
          </span>
          <h1 className="text-3xl font-semibold text-slate-100">Sign in to Realtime Item Tracker</h1>
          <p className="text-sm text-slate-400">
            Enter the daily access passphrase shared during deployment. Default hint: <span className="font-semibold text-slate-200">{DEFAULT_HINT}</span>
          </p>
        </div>
        <form className="space-y-6" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-slate-300">Access password</span>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter passphrase"
              required
            />
          </label>
          <Button type="submit" className="w-full justify-center" disabled={loading}>
            {loading ? "Signing in…" : "Unlock dashboard"}
          </Button>
          <p className="text-center text-xs text-slate-400">Need access? Contact your implementation lead.</p>
          {status && <p className="text-center text-sm text-red-400">{status}</p>}
        </form>
      </div>
    </div>
  );
}
