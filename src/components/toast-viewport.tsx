"use client";

import { useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import {
  dismissToast,
  getToasts,
  subscribeToasts,
} from "@/lib/toast";

/**
 * Renders toasts returned by the shared toast store. Mounted once in the
 * root layout so toasts work on every page.
 */
export function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-2xl animate-fade-in ${
            toast.type === "success"
              ? "border-emerald-500/30 bg-[#0c1f16] text-emerald-100"
              : "border-red-500/30 bg-[#1f0c0c] text-red-100"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => dismissToast(toast.id)}
            className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}