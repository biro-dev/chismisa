"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Lock, User, Eye, EyeOff } from "lucide-react";
import { loginAction } from "@/lib/actions/auth";
import { Capacitor } from "@capacitor/core";
import { registerPush } from "@/lib/push";

export function LoginForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginAction, undefined);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state?.success) {
      // Now that we're authenticated, (re)register for push so the device
      // token gets bound to this user on the server. On web this is a no-op.
      if (Capacitor.isNativePlatform()) {
        registerPush().catch((err) =>
          console.error("Post-login push re-register error:", err)
        );
      }
      router.push("/");
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {state.error}
        </div>
      )}

      <div>
        <label
          htmlFor="username"
          className="mb-1.5 block text-sm font-medium text-ink-text"
        >
          Username
        </label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            id="username"
            name="username"
            type="text"
            required
            minLength={3}
            maxLength={20}
            placeholder="e.g. siomai_girl2000"
            className="w-full rounded-xl border border-hairline bg-surface-raised py-3 pl-10 pr-4 text-sm text-ink-text placeholder:text-ink-muted outline-none transition-colors focus:border-gossip focus:ring-2 focus:ring-gossip/20 sm:py-2.5"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-ink-text"
        >
          Password
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={4}
            placeholder="••••••••"
            className="w-full rounded-xl border border-hairline bg-surface-raised py-3 pl-10 pr-12 text-sm text-ink-text placeholder:text-ink-muted outline-none transition-colors focus:border-gossip focus:ring-2 focus:ring-gossip/20 sm:py-2.5"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            tabIndex={-1}
            title={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-muted transition-colors hover:text-ink-text focus-visible:outline-none"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-gossip-deep py-3.5 text-sm font-semibold text-white shadow-lg shadow-gossip-deep/30 transition-all hover:bg-gossip disabled:cursor-not-allowed disabled:opacity-60 sm:py-3"
      >
        {pending ? "Entering..." : "Log in / Sign up"}
      </button>
    </form>
  );
}
