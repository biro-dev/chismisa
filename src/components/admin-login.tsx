"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogIn, ShieldAlert } from "lucide-react";
import { loginAdminAction } from "@/lib/actions/admin";

export function AdminLogin() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await loginAdminAction(secret);
      if (result.error) {
        setError(result.error);
        return;
      }
      // Store secret in sessionStorage for the panel to use with API calls
      sessionStorage.setItem("admin_secret", secret);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-hairline bg-surface-raised p-8 shadow-2xl">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gossip-deep">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-ink-text">Admin Access</h1>
          <p className="text-center text-sm text-ink-muted">
            Enter the admin secret key to access the panel.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Admin secret key"
              autoFocus
              className="w-full rounded-xl border border-hairline bg-surface-raised px-4 py-3 text-sm text-ink-text placeholder:text-ink-muted outline-none transition-colors focus:border-gossip focus:ring-2 focus:ring-gossip/20"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !secret.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gossip-deep py-3 text-sm font-semibold text-white transition-colors hover:bg-gossip disabled:opacity-60"
          >
            {loading ? (
              "Verifying…"
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                Access Panel
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
