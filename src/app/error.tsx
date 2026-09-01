"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-raised shadow-lg shadow-black/30">
        <span className="text-3xl">💬</span>
      </div>
      <h2 className="text-xl font-semibold text-ink-text">
        Something went wrong!
      </h2>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        An unexpected error occurred while loading this page. Please try again.
      </p>
      <button
        onClick={retry}
        className="mt-6 rounded-xl bg-gossip-deep px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gossip"
      >
        Try again
      </button>
    </div>
  );
}