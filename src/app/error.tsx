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
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-600 to-fuchsia-600 shadow-xl shadow-purple-900/40">
        <span className="text-3xl">💬</span>
      </div>
      <h2 className="text-xl font-semibold text-zinc-200">
        Something went wrong!
      </h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        An unexpected error occurred while loading this page. Please try again.
      </p>
      <button
        onClick={retry}
        className="mt-6 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:from-purple-500 hover:to-fuchsia-500"
      >
        Try again
      </button>
    </div>
  );
}