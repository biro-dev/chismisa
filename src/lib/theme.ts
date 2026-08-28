// Theme (persisted in localStorage).
// Read via useSyncExternalStore so the saved value resolves correctly on the
// server, during hydration, and across tabs - no setState-in-effect cascade.

export const THEME_STORAGE_KEY = "chismisa-theme";
export const THEME_EVENT = "chismisa-theme-change";

export type Theme = "dark" | "light";

export function getThemeSnapshot(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : "dark";
}

export function getThemeServerSnapshot(): Theme {
  return "dark";
}

export function subscribeToTheme(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_EVENT, callback);
  };
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function toggleThemeInStore(theme: Theme): Theme {
  const next: Theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  // `storage` events only fire in other tabs - notify this one too.
  window.dispatchEvent(new Event(THEME_EVENT));
  return next;
}
