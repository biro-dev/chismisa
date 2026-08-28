"use client";

export type ToastType = "success" | "error";

export type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

// A tiny client-side toast store. Kept dependency-free so any component can
// show a toast by calling `showToast(...)`; the <ToastViewport /> renders
// them via useSyncExternalStore (same pattern as the theme store).
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function getToasts(): Toast[] {
  return toasts;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Show a toast that auto-dismisses after a few seconds. Returns its id. */
export function showToast(
  message: string,
  type: ToastType = "success"
): number {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  emit();
  setTimeout(() => dismissToast(id), 3500);
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}